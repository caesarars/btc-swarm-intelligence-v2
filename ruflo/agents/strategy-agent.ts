import { MarketData, StrategySignals, OHLCV } from "./types.js";

export class StrategyAgent {
  static async analyze(data: MarketData): Promise<StrategySignals> {
    console.log("[StrategyAgent] Running technical analysis...");

    const closes = data.ohlcv.map((c) => c.close);
    const volumes = data.ohlcv.map((c) => c.volume);

    const rsi = StrategyAgent.calcRSI(closes, 21);
    const momentum = StrategyAgent.calcMomentum(closes, 5);
    const volumeSpike = StrategyAgent.detectVolumeSpike(volumes);
    const trendDirection = momentum > 0 ? "up" : "down";
    const trendStrength = Math.min(Math.abs(momentum) / 1000, 1);

    console.log(`[StrategyAgent] RSI: ${rsi.toFixed(1)}, Momentum: ${momentum.toFixed(2)}, VolumeSpike: ${volumeSpike}`);

    return { rsi, momentum, volumeSpike, trendDirection, trendStrength };
  }

  // RSI (Relative Strength Index)
  private static calcRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;

    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  // Price momentum
  private static calcMomentum(closes: number[], period: number): number {
    if (closes.length < period) return 0;
    const current = closes[closes.length - 1];
    const past = closes[closes.length - 1 - period];
    return current - past;
  }

  // Volume spike detection (current vs average)
  private static detectVolumeSpike(volumes: number[], multiplier = 1.5): boolean {
    if (volumes.length < 5) return false;
    const recent = volumes[volumes.length - 1];
    const avg = volumes.slice(-10, -1).reduce((a, b) => a + b, 0) / 9;
    return recent > avg * multiplier;
  }
}
