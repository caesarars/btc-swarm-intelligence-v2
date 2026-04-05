import { glmChat, GLM_MODEL } from "./glm-client.js";
import { AgentEvalInput, EvaluationResult } from "./types.js";

export class EvaluatorAgent {
  static async evaluate(input: AgentEvalInput): Promise<EvaluationResult> {
    console.log(`[EvaluatorAgent] Evaluating signals via Z.AI GLM (${GLM_MODEL})...`);

    const prompt = `
You are a crypto trading signal evaluator for Polymarket BTC Up/Down markets.
Analyze these inputs and return a JSON evaluation.

## Market Data
- BTC Price: $${input.marketData.price.toFixed(2)}
- Price at window open: $${input.marketData.priceOpen.toFixed(2)}
- Price change: ${((input.marketData.price - input.marketData.priceOpen) / input.marketData.priceOpen * 100).toFixed(3)}%
- 24h Volume: ${input.marketData.volume.toFixed(0)} BTC

## Technical Signals
- RSI(21): ${input.strategySignals.rsi.toFixed(1)}
- Momentum(5): ${input.strategySignals.momentum.toFixed(2)}
- Trend: ${input.strategySignals.trendDirection} (strength: ${input.strategySignals.trendStrength.toFixed(2)})
- Volume spike: ${input.strategySignals.volumeSpike}

## Strategy Context
- Bullish zone: RSI 55-70 AND momentum positive → compositeScore > 0.6
- Bearish zone: RSI 30-45 AND momentum negative → compositeScore < 0.4
- Outside these zones = weak signal → compositeScore near 0.5

## Polymarket Sentiment (${input.sentimentData.window})
- Up odds: ${(input.sentimentData.polymarketOddsUp * 100).toFixed(1)}%
- Down odds: ${(input.sentimentData.polymarketOddsDown * 100).toFixed(1)}%

Return ONLY valid JSON, no markdown, no explanation:
{
  "compositeScore": <0.0-1.0>,
  "direction": <"up" | "down">,
  "signals": { "technical": <0.0-1.0>, "sentiment": <0.0-1.0>, "volume": <0.0-1.0> },
  "reasoning": "<1 sentence max>"
}`.trim();
      const text = await glmChat(
        prompt,
        "You are a quantitative trading evaluator. Always respond with valid JSON only.",
        2000,
        true
      );

      // Sekarang tidak perlu regex lagi, langsung parse
      try {
        const parsed: EvaluationResult = JSON.parse(text);
        console.log(`[EvaluatorAgent] Score: ${parsed.compositeScore.toFixed(2)} → ${parsed.direction}`);
        return parsed;
      } catch {
        console.error("[EvaluatorAgent] Parse error:", text.slice(0, 150));
        return {
          compositeScore: 0.5,
          direction: "skip",
          signals: { technical: 0.5, sentiment: 0.5, volume: 0.5 },
          reasoning: "Parse error — defaulting to skip",
        };
      }
  }
}
