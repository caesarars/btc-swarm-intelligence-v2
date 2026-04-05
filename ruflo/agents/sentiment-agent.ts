import { SentimentData, WindowDuration } from "./types.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const POLYMARKET_BASE = "https://gamma-api.polymarket.com";

export class SentimentAgent {
  static async fetchPolymarketOdds(window: WindowDuration): Promise<SentimentData> {
    console.log(`[SentimentAgent] Fetching Polymarket odds for BTC ${window}...`);

    try {
      const market = await SentimentAgent.fetchCurrentMarket(window);

      if (!market) {
        console.warn("[SentimentAgent] No active market found, using neutral 0.5");
        return SentimentAgent.neutral(window);
      }

      // outcomes dan outcomePrices adalah string JSON array
      const outcomes: string[] = JSON.parse(market.outcomes ?? "[]");
      const prices: string[] = JSON.parse(market.outcomePrices ?? "[]");

      const upIndex = outcomes.findIndex((o: string) => o.toLowerCase() === "up");
      const oddsUp = upIndex >= 0 ? parseFloat(prices[upIndex] ?? "0.5") : 0.5;
      const oddsDown = 1 - oddsUp;

      console.log(`[SentimentAgent] Market: "${market.question}"`);
      console.log(`[SentimentAgent] Up: ${(oddsUp * 100).toFixed(1)}% | Down: ${(oddsDown * 100).toFixed(1)}%`);

      return {
        polymarketOddsUp: oddsUp,
        polymarketOddsDown: oddsDown,
        window,
        timestamp: Date.now(),
      };
    } catch (err) {
      console.error("[SentimentAgent] Error:", err);
      return SentimentAgent.neutral(window);
    }
  }

  private static async fetchCurrentMarket(window: WindowDuration): Promise<any | null> {
    const intervalSec = window === "5m" ? 300 : 900;
    const now = Math.floor(Date.now() / 1000);
    const currentWindowTs = Math.floor(now / intervalSec) * intervalSec;
    const tag = window === "5m" ? "5m" : "15m";
    const slug = `btc-updown-${tag}-${currentWindowTs}`;

    console.log(`[SentimentAgent] Fetching slug: ${slug}`);

    const res = await fetch(`${POLYMARKET_BASE}/events?slug=${slug}`);
    if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`);

    const events: any[] = await res.json();
    if (!events || events.length === 0) return null;

    const markets: any[] = events[0]?.markets ?? [];
    return markets.length > 0 ? markets[0] : null;
  }

  private static neutral(window: WindowDuration): SentimentData {
    return {
      polymarketOddsUp: 0.5,
      polymarketOddsDown: 0.5,
      window,
      timestamp: Date.now(),
    };
  }
}