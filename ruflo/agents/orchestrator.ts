import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { SwarmSignal, WindowConfig } from "./types.js";
import { DataAgent } from "./data-agent.js";
import { StrategyAgent } from "./strategy-agent.js";
import { SentimentAgent } from "./sentiment-agent.js";
import { EvaluatorAgent } from "./evaluator-agent.js";
import { DecisionAgent } from "./decision-agent.js";
import { BridgeEmitter } from "../bridge/signal-emitter.js"
import { SignalLogger } from "./logger.js";



const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

const WINDOW: WindowConfig = {
  duration: (process.env.SWARM_WINDOW as "5m" | "15m") ?? "15m",
  confidenceThreshold: parseFloat(process.env.SWARM_CONFIDENCE_THRESHOLD ?? "0.55"),
};

const WINDOW_MINUTES = WINDOW.duration === "5m" ? 5 : 15;
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
const MONITOR_INTERVAL_MS = 60 * 1000; // tiap 1 menit

let currentSignal: SwarmSignal | null = null;
let windowStartTime = 0;
let currentLogId: string = "";
let minuteCount = 0;

SignalLogger.init();

// ── DECISION cycle (menit 1-2) ─────────────────────────
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

// ── MONITOR cycle (menit 3-5) ──────────────────────────
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

    // Alert kalau odds berubah drastis vs signal awal
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
      if (actualDir) {
        SignalLogger.resolve(currentLogId, actualDir, currentSignal.direction);
        currentLogId = ""
      }
    }
  } catch (err) {
    console.error("[Orchestrator] Monitor cycle error:", err);
  }
}

// ── Sync ke Polymarket window boundary ─────────────────
function msUntilNextWindow(): number {
  const now = Date.now();
  const nextWindow = Math.ceil(now / WINDOW_MS) * WINDOW_MS;
  return nextWindow - now;
}

// ── Main loop ──────────────────────────────────────────
async function startWindowCycle(): Promise<void> {
  windowStartTime = Date.now();
  minuteCount = 0;
  currentSignal = null;

  // Menit 1 — decision
  minuteCount = 1;
  await decisionCycle();

  if (SignalLogger.read().length % 10 === 0) {
    SignalLogger.summary();
  }

  // Menit 2 — decision kedua (konfirmasi)
  setTimeout(async () => {
    minuteCount = 2;
    if (currentSignal?.direction === "skip") {
      await decisionCycle(); // coba lagi kalau menit 1 skip
    } else {
      await monitorCycle();  // monitor kalau sudah ada signal
    }
  }, MONITOR_INTERVAL_MS);

  // Menit 3-N — monitor only
  for (let min = 3; min <= WINDOW_MINUTES; min++) {
    setTimeout(async () => {
      minuteCount = min;
      await monitorCycle();
    }, MONITOR_INTERVAL_MS * (min - 1));
  }
}

// ── Bootstrap ──────────────────────────────────────────
const firstDelay = msUntilNextWindow();
const firstDelayMin = Math.round(firstDelay / 1000);

console.log(`[Orchestrator] Starting — window: ${WINDOW.duration}, threshold: ${WINDOW.confidenceThreshold}`);
console.log(`[Orchestrator] Syncing to next Polymarket window in ${firstDelayMin}s...`);

// Langsung jalan sekali untuk test, lalu sync ke window boundary
startWindowCycle();
setTimeout(() => {
  startWindowCycle();
  setInterval(startWindowCycle, WINDOW_MS);
}, firstDelay);