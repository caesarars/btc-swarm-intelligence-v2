import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, "../../logs/signals.json");
const LOG_DIR = resolve(__dirname, "../../logs");

interface SignalLog {
  id: string;
  timestamp: string;
  window: string;
  direction: string;
  confidence: number;
  compositeScore: number;
  rsi: number;
  momentum: number;
  oddsUp: number;
  oddsDown: number;
  btcPrice: number;
  reasoning: string;
  outcome?: "win" | "loss" | "pending";
  actualDirection?: "up" | "down";
  resolvedAt?: string;
}

export class SignalLogger {
  static init(): void {
    // Buat folder logs kalau belum ada
    if (!existsSync(LOG_DIR)) {
      import("fs").then(fs => fs.mkdirSync(LOG_DIR, { recursive: true }));
    }
    if (!existsSync(LOG_PATH)) {
      writeFileSync(LOG_PATH, JSON.stringify([], null, 2));
    }
  }

  static log(entry: Omit<SignalLog, "id" | "timestamp">): string {
    const logs = SignalLogger.read();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newEntry: SignalLog = {
      id,
      timestamp: new Date().toISOString(),
      ...entry,
      outcome: "pending",
    };
    logs.push(newEntry);
    writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2));
    console.log(`[Logger] Signal logged — id: ${id}`);
    return id;
  }

  static resolve(id: string, actualDirection: "up" | "down", predictedDirection: string): void {
    const logs = SignalLogger.read();
    const entry = logs.find(l => l.id === id);
    if (!entry) return;

    entry.outcome = actualDirection === predictedDirection ? "win" : "loss";
    entry.actualDirection = actualDirection;
    entry.resolvedAt = new Date().toISOString();

    writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2));
    console.log(`[Logger] Resolved ${id} → ${entry.outcome.toUpperCase()} (predicted: ${predictedDirection}, actual: ${actualDirection})`);
  }

  static read(): SignalLog[] {
    if (!existsSync(LOG_PATH)) return [];
    return JSON.parse(readFileSync(LOG_PATH, "utf-8"));
  }

  static summary(): void {
    const logs = SignalLogger.read();
    const resolved = logs.filter(l => l.outcome !== "pending");
    const wins = resolved.filter(l => l.outcome === "win").length;
    const pending = logs.filter(l => l.outcome === "pending").length;

    console.log(`\n${"=".repeat(40)}`);
    console.log(`  SIGNAL LOG SUMMARY`);
    console.log(`${"=".repeat(40)}`);
    console.log(`  Total signals  : ${logs.length}`);
    console.log(`  Resolved       : ${resolved.length}`);
    console.log(`  Pending        : ${pending}`);
    console.log(`  Win rate       : ${resolved.length > 0 ? (wins / resolved.length * 100).toFixed(1) : "N/A"}%`);
    console.log(`  Wins / Losses  : ${wins} / ${resolved.length - wins}`);
    console.log(`${"=".repeat(40)}\n`);
  }
}