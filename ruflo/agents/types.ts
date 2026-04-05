export type Direction = "up" | "down" | "skip";
export type WindowDuration = "5m" | "15m";

export interface WindowConfig {
  duration: WindowDuration;
  confidenceThreshold: number;
}

export interface MarketData {
  symbol: string;
  price: number;
  priceOpen: number;        // harga awal window
  volume: number;
  timestamp: number;
  ohlcv: OHLCV[];
}

export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface StrategySignals {
  rsi: number;              // 0-100
  momentum: number;         // positif = bullish
  volumeSpike: boolean;
  trendDirection: Direction;
  trendStrength: number;    // 0-1
}

export interface SentimentData {
  polymarketOddsUp: number; // 0-1
  polymarketOddsDown: number;
  window: WindowDuration;
  timestamp: number;
}

export interface EvaluationResult {
  compositeScore: number;   // 0-1
  direction: Direction;
  signals: {
    technical: number;
    sentiment: number;
    volume: number;
  };
  reasoning: string;
}

export interface SwarmSignal {
  direction: Direction;
  confidence: number;
  window: WindowDuration;
  source: string;
  timestamp: number;
  metadata: {
    strategy: string;
    polymarketOdds: number;
    btcPrice: number;
    reasoning: string;
  };
}

export interface AgentEvalInput {
  marketData: MarketData;
  strategySignals: StrategySignals;
  sentimentData: SentimentData;
}

export interface DecisionInput {
  evaluation: EvaluationResult;
  threshold: number;
  window: WindowDuration;
}
