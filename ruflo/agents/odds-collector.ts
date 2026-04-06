import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

const POLYMARKET_BASE = "https://gamma-api.polymarket.com";
const BINANCE_BASE = "https://data-api.binance.vision/api/v3";
const DATA_DIR = resolve(__dirname, "../../data-agents/collected");

interface OddsRecord {
  timestamp: string;
  windowTs: number;
  windowLabel: string;
  minuteElapsed: number;
  oddsUp: number;
  oddsDown: number;
  btcPrice: number;
  priceOpen: number;
  priceChangePct: number;
  volume: number;
  resolved?: "up" | "down" | null;
}

export class OddsCollector {
  private collecting = false;
  private collectInterval: NodeJS.Timeout | null = null;
  private currentWindowTs = 0;
  private priceOpen = 0;
  private window: "5m" | "15m";
  private csvPath: string;

  constructor(window: "5m" | "15m") {
    this.window = window;
    this.csvPath = resolve(DATA_DIR, `odds_${window}_collected.csv`);
    this.init();
  }

  private init(): void {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    // Buat CSV header kalau belum ada
    if (!existsSync(this.csvPath)) {
      writeFileSync(this.csvPath,
        "timestamp,windowTs,windowLabel,minuteElapsed,oddsUp,oddsDown,btcPrice,priceOpen,priceChangePct,volume\n"
      );
      console.log(`[Collector] CSV created: ${this.csvPath}`);
    } else {
      console.log(`[Collector] Appending to existing CSV: ${this.csvPath}`);
    }
  }

  startWindow(priceOpen: number, windowTs: number): void {
    this.priceOpen = priceOpen;
    this.currentWindowTs = windowTs;

    // Collect tiap 30 detik
    this.collectInterval = setInterval(() => this.collect(), 30000);
    console.log(`[Collector] Started — window: ${windowTs}, open: $${priceOpen.toFixed(0)}`);

    // Collect langsung saat window mulai
    this.collect();
  }

  stopWindow(): void {
    if (this.collectInterval) {
      clearInterval(this.collectInterval);
      this.collectInterval = null;
    }
  }

  private async collect(): Promise<void> {
    try {
      const intervalSec = this.window === "5m" ? 300 : 900;
      const slug = `btc-updown-${this.window}-${this.currentWindowTs}`;

      const [oddsRes, tickerRes] = await Promise.all([
        fetch(`${POLYMARKET_BASE}/events?slug=${slug}`),
        fetch(`${BINANCE_BASE}/ticker/24hr?symbol=BTCUSDT`),
      ]);

      if (!oddsRes.ok || !tickerRes.ok) return;

      const [oddsData, tickerData] = await Promise.all([
        oddsRes.json(),
        tickerRes.json(),
      ]);

      const market = oddsData?.[0]?.markets?.[0];
      if (!market) return;

      const outcomes: string[] = JSON.parse(market.outcomes ?? "[]");
      const prices: string[] = JSON.parse(market.outcomePrices ?? "[]");
      const upIndex = outcomes.findIndex((o: string) => o.toLowerCase() === "up");
      const oddsUp = upIndex >= 0 ? parseFloat(prices[upIndex] ?? "0.5") : 0.5;

      const btcPrice = parseFloat(tickerData.lastPrice);
      const volume = parseFloat(tickerData.volume);
      const now = Date.now();
      const minuteElapsed = (now - this.currentWindowTs * 1000) / 60000;
      const priceChangePct = ((btcPrice - this.priceOpen) / this.priceOpen) * 100;

      const record: OddsRecord = {
        timestamp: new Date(now).toISOString(),
        windowTs: this.currentWindowTs,
        windowLabel: oddsData?.[0]?.title ?? "",
        minuteElapsed: parseFloat(minuteElapsed.toFixed(2)),
        oddsUp: parseFloat(oddsUp.toFixed(4)),
        oddsDown: parseFloat((1 - oddsUp).toFixed(4)),
        btcPrice: parseFloat(btcPrice.toFixed(2)),
        priceOpen: parseFloat(this.priceOpen.toFixed(2)),
        priceChangePct: parseFloat(priceChangePct.toFixed(4)),
        volume: parseFloat(volume.toFixed(2)),
      };

      // Append ke CSV
      const row = [
        record.timestamp,
        record.windowTs,
        `"${record.windowLabel}"`,
        record.minuteElapsed,
        record.oddsUp,
        record.oddsDown,
        record.btcPrice,
        record.priceOpen,
        record.priceChangePct,
        record.volume,
      ].join(",");

      writeFileSync(this.csvPath, row + "\n", { flag: "a" });

      console.log(`[Collector] Recorded — Up: ${(oddsUp * 100).toFixed(1)}% | BTC: $${btcPrice.toFixed(0)} | min: ${minuteElapsed.toFixed(1)}`);

    } catch (err) {
      // Silent fail
    }
  }

  // Resolve outcome setelah window selesai
  async resolveWindow(windowTs: number): Promise<void> {
    try {
      await new Promise(r => setTimeout(r, 10000)); // tunggu 10 detik setelah window close

      const slug = `btc-updown-${this.window}-${windowTs}`;
      const res = await fetch(`${POLYMARKET_BASE}/events?slug=${slug}`);
      if (!res.ok) return;

      const data = await res.json();
      const market = data?.[0]?.markets?.[0];
      if (!market) return;

      const outcomes: string[] = JSON.parse(market.outcomes ?? "[]");
      const prices: string[] = JSON.parse(market.outcomePrices ?? "[]");
      const upIndex = outcomes.findIndex((o: string) => o.toLowerCase() === "up");
      const finalOddsUp = upIndex >= 0 ? parseFloat(prices[upIndex] ?? "0.5") : 0.5;

      // Resolved = odds > 0.95
      const resolved = finalOddsUp > 0.95 ? "up"
                     : finalOddsUp < 0.05 ? "down"
                     : null;

      if (resolved) {
        console.log(`[Collector] Window ${windowTs} resolved → ${resolved.toUpperCase()}`);

        // Update baris CSV yang punya windowTs ini dengan resolved outcome
        const content = readFileSync(this.csvPath, "utf-8");
        const updated = content.split("\n").map(line => {
          if (line.includes(`,${windowTs},`)) {
            return line + (line.endsWith(",") ? resolved : `,${resolved}`);
          }
          return line;
        }).join("\n");

        // Tambah header resolved kalau belum ada
        const withHeader = updated.replace(
          "timestamp,windowTs,windowLabel,minuteElapsed,oddsUp,oddsDown,btcPrice,priceOpen,priceChangePct,volume\n",
          "timestamp,windowTs,windowLabel,minuteElapsed,oddsUp,oddsDown,btcPrice,priceOpen,priceChangePct,volume,resolved\n"
        );

        writeFileSync(this.csvPath, withHeader);
      }
    } catch {
      // Silent fail
    }
  }

  getCSVPath(): string {
    return this.csvPath;
  }
}