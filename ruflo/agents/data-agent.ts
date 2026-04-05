import { MarketData, OHLCV } from "./types.js";

const BINANCE_BASE = "https://data-api.binance.vision/api/v3";
const SYMBOL = "BTCUSDT";

export class DataAgent {
  static async fetch(): Promise<MarketData> {
    console.log("[DataAgent] Fetching BTC market data...");

    const [ticker, klines] = await Promise.all([
      DataAgent.fetchTicker(),
      DataAgent.fetchKlines(),
    ]);

    return {
      symbol: SYMBOL,
      price: parseFloat(ticker.lastPrice),
      priceOpen: parseFloat(ticker.openPrice),
      volume: parseFloat(ticker.volume),
      timestamp: Date.now(),
      ohlcv: klines,
    };
  }

  private static async fetchTicker(): Promise<any> {
    const res = await fetch(`${BINANCE_BASE}/ticker/24hr?symbol=${SYMBOL}`);
    if (!res.ok) throw new Error(`Binance ticker error: ${res.status}`);
    return res.json();
  }

  private static async fetchKlines(interval = "1m", limit = 30): Promise<OHLCV[]> {
    const url = `${BINANCE_BASE}/klines?symbol=${SYMBOL}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);
    const raw: any[][] = await res.json();

    return raw.map((k) => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      timestamp: k[0],
    }));
  }
}
