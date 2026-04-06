import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const PORT = parseInt(process.env.DASHBOARD_PORT ?? "3003");
const SIGNALS_PATH = resolve(__dirname, "../logs/signals.json");
const ODDS_CSV_PATH = resolve(__dirname, "../data-agents/collected/odds_5m_collected.csv");
const DASHBOARD_PATH = resolve(__dirname, "../dashboard/index.html");

function cors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: any, data: any) {
  cors(res);
  res.setHeader("Content-Type", "application/json");
  res.writeHead(200);
  res.end(JSON.stringify(data));
}

function parseOddsCSV(): any[] {
  if (!existsSync(ODDS_CSV_PATH)) return [];
  const lines = readFileSync(ODDS_CSV_PATH, "utf-8").trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).slice(-120).map(line => {  // last 120 records
    const vals = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, vals[i]]));
  });
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";

  // Dashboard HTML
  if (url === "/" || url === "/dashboard") {
    cors(res);
    res.setHeader("Content-Type", "text/html");
    res.writeHead(200);
    res.end(existsSync(DASHBOARD_PATH)
      ? readFileSync(DASHBOARD_PATH, "utf-8")
      : "<h1>Dashboard not found</h1>"
    );
    return;
  }

  // API: signals
  if (url === "/api/signals") {
    const signals = existsSync(SIGNALS_PATH)
      ? JSON.parse(readFileSync(SIGNALS_PATH, "utf-8"))
      : [];
    const resolved = signals.filter((s: any) => s.outcome !== "pending");
    const wins = resolved.filter((s: any) => s.outcome === "win");
    json(res, {
      total: signals.length,
      resolved: resolved.length,
      pending: signals.filter((s: any) => s.outcome === "pending").length,
      wins: wins.length,
      losses: resolved.length - wins.length,
      winRate: resolved.length > 0 ? wins.length / resolved.length : null,
      recent: signals.slice(-20),
    });
    return;
  }

  // API: odds history
  if (url === "/api/odds") {
    json(res, { records: parseOddsCSV() });
    return;
  }

  // API: live status (BTC price + current odds)
  if (url === "/api/status") {
    // Baca dari odds CSV record terakhir
    const records = parseOddsCSV();
    const latest = records[records.length - 1] ?? null;
    json(res, {
      timestamp: Date.now(),
      btcPrice: latest ? parseFloat(latest.btcPrice) : null,
      oddsUp: latest ? parseFloat(latest.oddsUp) : null,
      oddsDown: latest ? parseFloat(latest.oddsDown) : null,
      minuteElapsed: latest ? parseFloat(latest.minuteElapsed) : null,
    });
    return;
  }

  // 404
  cors(res);
  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`[Dashboard API] Running on http://0.0.0.0:${PORT}`);
  console.log(`[Dashboard API] Dashboard: http://0.0.0.0:${PORT}/`);
  console.log(`[Dashboard API] Signals:   http://0.0.0.0:${PORT}/api/signals`);
  console.log(`[Dashboard API] Odds:      http://0.0.0.0:${PORT}/api/odds`);
  console.log(`[Dashboard API] Status:    http://0.0.0.0:${PORT}/api/status`);
});