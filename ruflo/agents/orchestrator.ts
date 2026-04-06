import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { SwarmSignal, WindowConfig } from "./types.js";
import { DataAgent } from "./data-agent.js";
import { StrategyAgent } from "./strategy-agent.js";
import { SentimentAgent } from "./sentiment-agent.js";
import { EvaluatorAgent } from "./evaluator-agent.js";
import { DecisionAgent } from "./decision-agent.js";
import { BridgeEmitter } from "../bridge/signal-emitter.js";
import { SignalLogger } from "./logger.js";
import { OddsScanner } from "./odds-scanner.js";
import { OddsCollector } from "./odds-collector.js";
import { glmChat } from "./glm-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

const WINDOW: WindowConfig = {
  duration: (process.env.SWARM_WINDOW as "5m" | "15m") ?? "15m",
  confidenceThreshold: parseFloat(process.env.SWARM_CONFIDENCE_THRESHOLD ?? "0.55"),
};

const WINDOW_MINUTES = WINDOW.duration === "5m" ? 5 : 15;
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
const MONITOR_INTERVAL_MS = 60 * 1000;

let currentSignal: SwarmSignal | null = null;
let windowStartTime = 0;
let currentLogId: string = "";
let minuteCount = 0;

SignalLogger.init();

let scanner: OddsScanner | null = null;
let collector: OddsCollector | null = null;
let lastWindowTs = 0;

const lastAnomalyByType: Record<string, number> = {};
const COOLDOWN_BY_TYPE: Record<string, number> = {
  ODDS_MOMENTUM:     30 * 1000,
  PRICE_SPIKE:       30 * 1000,
  LATE_CONFIRMATION: 999 * 1000,
};

async function handleAnomaly(event: any): Promise<void> {
  const now = Date.now();

  const cooldown = COOLDOWN_BY_TYPE[event.type] ?? 60000;
  const lastFired = lastAnomalyByType[event.type] ?? 0;
  if (now - lastFired < cooldown) return;
  lastAnomalyByType[event.type] = now;

  console.log(`\n[Orchestrator] Anomaly triggered GLM evaluation...`);

  try {
    const prompt = `
You are a Polymarket BTC Up/Down trader. An anomaly was detected.

Anomaly type: ${event.type}
Direction signal: ${event.direction}
Signal strength: ${event.strength.toFixed(2)}

Current state:
- BTC open price: $${event.priceOpen.toFixed(2)}
- BTC current price: $${event.btcPrice.toFixed(2)}
- Price change from open: ${event.deltaPrice.toFixed(3)}%
- Polymarket Up odds: ${(event.oddsUp * 100).toFixed(1)}%
- Polymarket Down odds: ${(event.oddsDown * 100).toFixed(1)}%
- Odds momentum (10s): ${event.deltaOdds > 0 ? "+" : ""}${(event.deltaOdds * 100).toFixed(1)}%

Should we enter this trade? Return JSON only:
{
  "enter": true or false,
  "direction": "up" or "down",
  "confidence": 0.0-1.0,
  "reasoning": "1 sentence"
}`.trim();

    const text = await glmChat(
      prompt,
      "You are a quantitative Polymarket trader. Respond with valid JSON only.",
      300,
      true
    );

    if (!text || text.trim() === "") {
      console.error("[GLM] Empty response, skipping");
      return;
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[GLM] No JSON found in response:", text.slice(0, 100));
      return;
    }

    const decision = JSON.parse(jsonMatch[0]);
    console.log(`[GLM] Enter: ${decision.enter} | ${decision.direction} | confidence: ${decision.confidence.toFixed(2)}`);
    console.log(`[GLM] Reasoning: ${decision.reasoning}`);

    if (decision.enter && decision.confidence >= WINDOW.confidenceThreshold) {
      const signal = {
        direction: decision.direction,
        confidence: decision.confidence,
        window: WINDOW.duration,
        source: "odds-scanner-v1",
        timestamp: Math.floor(Date.now() / 1000),
        metadata: {
          strategy: event.type,
          polymarketOdds: event.oddsUp,
          btcPrice: event.btcPrice,
          reasoning: decision.reasoning,
        },
      };

      await BridgeEmitter.send(signal as any);
      SignalLogger.log({
        window: WINDOW.duration,
        direction: decision.direction,
        confidence: decision.confidence,
        compositeScore: decision.confidence,
        rsi: 0,
        momentum: event.deltaPrice,
        oddsUp: event.oddsUp,
        oddsDown: event.oddsDown,
        btcPrice: event.btcPrice,
        reasoning: decision.reasoning,
      });

      console.log(`[Orchestrator] Signal sent → ${decision.direction}`);
    }

  } catch (err) {
    console.error("[Orchestrator] Anomaly handler error:", err);
  }
}

// ── DECISION cycle ─────────────────────────────────────
async function decisionCycle(): Promise<void> {
  console.log(`\n[Orchestrator] DECISION cycle — window: ${WINDOW.duration}`);

  try {
    const [marketData, sentimentData] = await Promise.all([
      DataAgent.fetch(),
      SentimentAgent.fetchPolymarketOdds(WINDOW.duration),
    ]);

    const strategySignals = await StrategyAgent.analyze(marketData);
    const evaluation = await EvaluatorAgent.evaluate({
      marketData,
      strategySignals,
      sentimentData,
    });

    const signal = await DecisionAgent.decide({
      evaluation,
      threshold: WINDOW.confidenceThreshold,
      window: WINDOW.duration,
    });

    currentSignal = signal;
    console.log(`[Orchestrator] Signal: ${signal.direction} (confidence: ${signal.confidence.toFixed(2)})`);

    if (signal.direction !== "skip") {
      await BridgeEmitter.send(signal);
      currentLogId = SignalLogger.log({
        window: signal.window,
        direction: signal.direction,
        confidence: signal.confidence,
        compositeScore: evaluation.compositeScore,
        rsi: strategySignals.rsi,
        momentum: strategySignals.momentum,
        oddsUp: sentimentData.polymarketOddsUp,
        oddsDown: sentimentData.polymarketOddsDown,
        btcPrice: marketData.price,
        reasoning: evaluation.reasoning,
      });
      console.log(`[Orchestrator] Signal sent to VPS bot`);
    } else {
      console.log(`[Orchestrator] Skipping — confidence below threshold`);
    }
  } catch (err) {
    console.error("[Orchestrator] Decision cycle error:", err);
  }
}

// ── MONITOR cycle ──────────────────────────────────────
async function monitorCycle(): Promise<void> {
  console.log(`\n[Orchestrator] MONITOR cycle (min ${minuteCount}/${WINDOW_MINUTES})`);

  try {
    const [marketData, sentimentData] = await Promise.all([
      DataAgent.fetch(),
      SentimentAgent.fetchPolymarketOdds(WINDOW.duration),
    ]);

    const priceChange = ((marketData.price - marketData.priceOpen) / marketData.priceOpen * 100);
    console.log(`[Monitor] BTC: $${marketData.price.toFixed(0)} (${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(3)}%)`);
    console.log(`[Monitor] Polymarket Up: ${(sentimentData.polymarketOddsUp * 100).toFixed(1)}% | Down: ${(sentimentData.polymarketOddsDown * 100).toFixed(1)}%`);

    if (currentSignal && currentSignal.direction !== "skip") {
      const oddsForDirection = currentSignal.direction === "up"
        ? sentimentData.polymarketOddsUp
        : sentimentData.polymarketOddsDown;

      if (oddsForDirection < 0.35) {
        console.warn(`[Monitor] ⚠️ Odds berubah drastis! ${currentSignal.direction} sekarang hanya ${(oddsForDirection * 100).toFixed(1)}%`);
      }

      const actualDir = sentimentData.polymarketOddsUp > 0.95 ? "up"
                      : sentimentData.polymarketOddsDown > 0.95 ? "down"
                      : null;
      if (actualDir && currentLogId) {
        SignalLogger.resolve(currentLogId, actualDir, currentSignal.direction);
        currentLogId = "";
      }
    }
  } catch (err) {
    console.error("[Orchestrator] Monitor cycle error:", err);
  }
}

// ── Sync ke window boundary ────────────────────────────
function msUntilNextWindow(): number {
  const now = Date.now();
  const nextWindow = Math.ceil(now / WINDOW_MS) * WINDOW_MS;
  return nextWindow - now;
}

// ── Main loop ──────────────────────────────────────────
async function startWindowCycle(): Promise<void> {
  // Stop window sebelumnya
  if (scanner) scanner.stopWindow();
  if (collector) {
    collector.stopWindow();
    // Resolve outcome window yang baru selesai
    if (lastWindowTs > 0) collector.resolveWindow(lastWindowTs);
  }

  const intervalSec = WINDOW_MINUTES * 60;
  const now = Math.floor(Date.now() / 1000);
  const windowTs = Math.floor(now / intervalSec) * intervalSec;
  lastWindowTs = windowTs;

  // Reset state
  currentSignal = null;
  currentLogId = "";
  minuteCount = 0;

  // Reset cooldown ODDS_MOMENTUM & PRICE_SPIKE tiap window baru
  // LATE_CONFIRMATION tetap per-window via lateConfirmationFired di scanner
  delete lastAnomalyByType["ODDS_MOMENTUM"];
  delete lastAnomalyByType["PRICE_SPIKE"];
  delete lastAnomalyByType["LATE_CONFIRMATION"];

  // Fetch open price
  let priceOpen = 0;
  try {
    const res = await fetch("https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT");
    const data = await res.json();
    priceOpen = parseFloat(data.price);
  } catch {
    console.error("[Orchestrator] Failed to fetch open price");
    return;
  }

  console.log(`\n[Orchestrator] New window — ${WINDOW.duration} | open: $${priceOpen.toFixed(0)} | ts: ${windowTs}`);

  // Start scanner
  scanner = new OddsScanner(WINDOW.duration, handleAnomaly);
  await scanner.startWindow(priceOpen, windowTs);

  // Start collector (B — data collection)
  if (!collector) collector = new OddsCollector(WINDOW.duration);
  collector.startWindow(priceOpen, windowTs);

  // Summary tiap 10 signal
  const logCount = SignalLogger.read().length;
  if (logCount > 0 && logCount % 10 === 0) SignalLogger.summary();
}

// ── Bootstrap ──────────────────────────────────────────
const firstDelay = msUntilNextWindow();
const firstDelayMin = Math.round(firstDelay / 1000);

console.log(`[Orchestrator] Starting — window: ${WINDOW.duration}, threshold: ${WINDOW.confidenceThreshold}`);
console.log(`[Orchestrator] Syncing to next Polymarket window in ${firstDelayMin}s...`);

startWindowCycle();
setTimeout(() => {
  startWindowCycle();
  setInterval(startWindowCycle, WINDOW_MS);
}, firstDelay);