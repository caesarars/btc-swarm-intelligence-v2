# btc-swarm-intelligence

Agentic swarm untuk analisis dan backtesting trading bot BTC di Polymarket (5m/15m).

## Stack
- **Ruflo** (TypeScript/pnpm) — orchestrator & agent swarm
- **Python/uv** — backtesting engine (VectorBT) & data agents
- **Claude API** — otak agent (claude-sonnet-4-6)
- **Bridge** — signal emitter ke btc-trading-bot di VPS Tokyo

## Arsitektur

```
btc-swarm-intelligence/
├── ruflo/              # TypeScript — Ruflo orchestrator & agents
├── backtesting/        # Python — VectorBT, strategies, results
├── data-agents/        # Python — BTC OHLCV + Polymarket fetcher
├── bridge/             # TypeScript — signal emitter ke VPS
└── docker/             # Docker config untuk Phase 2 (VPS deploy)
```

## Quick Start

### 1. Setup TypeScript (Ruflo)
```bash
cd ruflo
pnpm install
npx ruflo@latest init
```

### 2. Setup Python (backtesting + data agents)
```bash
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

### 3. Set environment variables
```bash
cp .env.example .env
# isi ANTHROPIC_API_KEY dan BOT_API_URL
```

### 4. Jalankan swarm (development)
```bash
cd ruflo
pnpm dev
```

## Phases

| Phase | Lokasi Swarm | Status |
|-------|-------------|--------|
| 1 | MacBook M2 lokal | sekarang |
| 2 | VPS Contabo Tokyo | nanti |

## Signal Format

Swarm mengirim sinyal ke btc-trading-bot via REST:

```json
{
  "direction": "up" | "down" | "skip",
  "confidence": 0.87,
  "window": "5m" | "15m",
  "source": "swarm-v1",
  "timestamp": 1712345678,
  "metadata": {
    "strategy": "momentum_rsi",
    "polymarket_odds": 0.62,
    "btc_price": 83500
  }
}
```
# btc-swarm-intelligence-v2.
# btc-swarm-intelligence-v2
