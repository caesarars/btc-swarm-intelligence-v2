import { WindowDuration } from "./types.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

const POLYMARKET_BASE = "https://gamma-api.polymarket.com";


interface OddsSnapshot {
  timestamp: number;
  oddsUp: number;
  oddsDown: number;
  btcPrice: number;
}

interface AnomalyEvent {
  type: "ODDS_MOMENTUM" | "PRICE_SPIKE" | "LATE_CONFIRMATION";
  direction: "up" | "down";
  strength: number;       // 0-1
  oddsUp: number;
  oddsDown: number;
  btcPrice: number;
  priceOpen: number;
  deltaOdds: number;      // perubahan odds dalam window waktu
  deltaPrice: number;     // perubahan harga %
  timestamp: number;
}

export class OddsScanner {
  private history: OddsSnapshot[] = [];
  private priceOpen: number = 0;
  private scanInterval: NodeJS.Timeout | null = null;
  private onAnomaly: (event: AnomalyEvent) => Promise<void>;
  private window: WindowDuration;
  private lateConfirmationFired = false;
  private windowTs: number = 0;

  // Thresholds
  private readonly ODDS_DELTA_THRESHOLD = 0.06;   // 6% perubahan odds dalam 10 detik
  private readonly PRICE_SPIKE_THRESHOLD = 0.12;  // 0.12% price move
  private readonly LATE_ENTRY_MINUTE = 3;         // mulai scan serius di menit ke-3
  private readonly CONFIRMED_ODDS = 0.62;         // odds > 62% = strong signal

  constructor(window: WindowDuration, onAnomaly: (event: AnomalyEvent) => Promise<void>) {
    this.window = window;
    this.onAnomaly = onAnomaly;
  }

  // Start scanning untuk window baru
  async startWindow(priceOpen: number, windowTs: number): Promise<void> {
    this.priceOpen = priceOpen;
    this.lateConfirmationFired = false;
    this.windowTs = windowTs;
    this.history = [];

    console.log(`[OddsScanner] Window started — open: $${priceOpen.toFixed(0)}`);

    // Scan tiap 2 detik
    this.scanInterval = setInterval(() => this.scan(), 300);
  }

  stopWindow(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    console.log(`[OddsScanner] Window ended — scanned ${this.history.length} snapshots`);
  }

  private async scan(): Promise<void> {
    try {
      const snapshot = await this.fetchSnapshot();
      if (!snapshot) return;

      this.history.push(snapshot);

      // Minimalkan log — hanya print tiap 10 scan
      if (this.history.length % 10 === 0) {
        console.log(`[Scanner] Up: ${(snapshot.oddsUp * 100).toFixed(1)}% | BTC: $${snapshot.btcPrice.toFixed(0)}`);
      }

      // Detect anomali
      const anomaly = this.detectAnomaly(snapshot);
      if (anomaly) {
        console.log(`[Scanner] ANOMALY detected: ${anomaly.type} → ${anomaly.direction} (strength: ${anomaly.strength.toFixed(2)})`);
        await this.onAnomaly(anomaly);
      }

    } catch (err) {
      // Silent fail — scanner tidak boleh crash
    }
  }

  private async fetchSnapshot(): Promise<OddsSnapshot | null> {
    try {
      const intervalSec = this.window === "5m" ? 300 : 900;
      const slug = `btc-updown-${this.window}-${this.windowTs}`;
      const [oddsRes, priceRes] = await Promise.all([
        fetch(`${POLYMARKET_BASE}/events?slug=${slug}`),
        fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT`),
      ]);

      if (!oddsRes.ok || !priceRes.ok) return null;

      const [oddsData, priceData] = await Promise.all([
        oddsRes.json(),
        priceRes.json(),
      ]);

      const market = oddsData?.[0]?.markets?.[0];
      if (!market) return null;

      const outcomes: string[] = JSON.parse(market.outcomes ?? "[]");
      const prices: string[] = JSON.parse(market.outcomePrices ?? "[]");
      const upIndex = outcomes.findIndex((o: string) => o.toLowerCase() === "up");
      const oddsUp = upIndex >= 0 ? parseFloat(prices[upIndex] ?? "0.5") : 0.5;

      return {
        timestamp: Date.now(),
        oddsUp,
        oddsDown: 1 - oddsUp,
        btcPrice: parseFloat(priceData.price),
      };
    } catch {
      return null;
    }
  }

  private detectAnomaly(current: OddsSnapshot): AnomalyEvent | null {
    const now = Date.now();
    const windowMinutes = this.window === "5m" ? 5 : 15;
    const windowMs = windowMinutes * 60 * 1000;
    const elapsed = now - (this.windowTs * 1000);
    const minuteElapsed = elapsed / 60000;

    // Hitung delta odds (vs 10 detik lalu = 5 snapshots lalu)
    const lookback = Math.min(5, this.history.length - 1);
    if (lookback < 2) return null;

    const past = this.history[this.history.length - 1 - lookback];
    const deltaOdds = current.oddsUp - past.oddsUp;
    const deltaPrice = ((current.btcPrice - this.priceOpen) / this.priceOpen) * 100;

    // 1. ODDS MOMENTUM — odds bergerak cepat
    if (Math.abs(deltaOdds) > this.ODDS_DELTA_THRESHOLD) {
      const direction = deltaOdds > 0 ? "up" : "down";
      return {
        type: "ODDS_MOMENTUM",
        direction,
        strength: Math.min(Math.abs(deltaOdds) / 0.15, 1),
        oddsUp: current.oddsUp,
        oddsDown: current.oddsDown,
        btcPrice: current.btcPrice,
        priceOpen: this.priceOpen,
        deltaOdds,
        deltaPrice,
        timestamp: now,
      };
    }

    // 2. PRICE SPIKE — harga BTC spike signifikan dari open
    if (Math.abs(deltaPrice) > this.PRICE_SPIKE_THRESHOLD) {
      const direction = deltaPrice > 0 ? "up" : "down";
      return {
        type: "PRICE_SPIKE",
        direction,
        strength: Math.min(Math.abs(deltaPrice) / 0.3, 1),
        oddsUp: current.oddsUp,
        oddsDown: current.oddsDown,
        btcPrice: current.btcPrice,
        priceOpen: this.priceOpen,
        deltaOdds,
        deltaPrice,
        timestamp: now,
      };
    }

    // 3. LATE CONFIRMATION — di menit 3+, odds sudah confirmed ke satu arah
    if (minuteElapsed >= this.LATE_ENTRY_MINUTE && !this.lateConfirmationFired) {
        if (current.oddsUp > this.CONFIRMED_ODDS) {
            this.lateConfirmationFired = true;  // ← tambah ini
            return {
            type: "LATE_CONFIRMATION",
            direction: "up",
            strength: (current.oddsUp - 0.5) * 2,
            oddsUp: current.oddsUp,
            oddsDown: current.oddsDown,
            btcPrice: current.btcPrice,
            priceOpen: this.priceOpen,
            deltaOdds,
            deltaPrice,
            timestamp: now,
            };
        }
        if (current.oddsDown > this.CONFIRMED_ODDS) {
            this.lateConfirmationFired = true;  // ← tambah ini
            return {
            type: "LATE_CONFIRMATION",
            direction: "down",
            strength: (current.oddsDown - 0.5) * 2,
            oddsUp: current.oddsUp,
            oddsDown: current.oddsDown,
            btcPrice: current.btcPrice,
            priceOpen: this.priceOpen,
            deltaOdds,
            deltaPrice,
            timestamp: now,
            };
        }
        }

    return null;
  }

  getHistory(): OddsSnapshot[] {
    return this.history;
  }
}