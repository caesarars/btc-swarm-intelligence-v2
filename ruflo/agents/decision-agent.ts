import { DecisionInput, SwarmSignal } from "./types.js";

export class DecisionAgent {
  static async decide(input: DecisionInput): Promise<SwarmSignal> {
    const { evaluation, threshold, window } = input;

    // Calculate confidence — distance dari 0.5 (neutral)
    const confidence = Math.abs(evaluation.compositeScore - 0.5) * 2;

    const direction =
      confidence >= threshold ? evaluation.direction : "skip";

    console.log(
      `[DecisionAgent] Composite: ${evaluation.compositeScore.toFixed(2)}, ` +
      `Confidence: ${confidence.toFixed(2)}, ` +
      `Threshold: ${threshold}, ` +
      `Decision: ${direction}`
    );

    return {
      direction,
      confidence,
      window,
      source: "swarm-v1",
      timestamp: Math.floor(Date.now() / 1000),
      metadata: {
        strategy: "composite_rsi_momentum_polymarket",
        polymarketOdds: evaluation.signals.sentiment,
        btcPrice: 0, // diisi oleh orchestrator
        reasoning: evaluation.reasoning,
      },
    };
  }
}
