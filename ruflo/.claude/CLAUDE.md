# btc-swarm-intelligence — Ruflo config

## Project context
Agentic swarm untuk analisis BTC trading signals dan backtesting untuk Polymarket Up/Down 5m/15m markets.

## Stack
- Ruflo v3.5 (TypeScript orchestrator)
- Python/uv (backtesting + data agents)
- Z.AI GLM via OpenAI-compatible API (evaluator agent brain)
  - Default model: glm-4.5-air
  - Endpoint: https://api.z.ai/api/paas/v4
- VectorBT (backtesting engine)
- Target: VPS Contabo Tokyo (Phase 2)

## Agent roles
- **orchestrator** — koordinasi semua agent, kelola state & timing
- **data-agent** — fetch BTC price real-time dari Binance
- **strategy-agent** — RSI, momentum, volume spike indicators
- **sentiment-agent** — Polymarket odds live
- **evaluator-agent** — gabungkan sinyal via Claude API
- **decision-agent** — final Up/Down/Skip dengan confidence threshold
- **bridge** — emit signal ke btc-trading-bot VPS via HMAC-signed REST

## Rules
- NEVER hardcode API keys
- ALWAYS use confidence threshold sebelum emit signal
- NEVER eksekusi trade langsung — hanya emit signal ke bot
- Signal format harus selalu include: direction, confidence, window, timestamp, metadata
- Evaluator agent harus return valid JSON — selalu ada fallback ke "skip"
- Python files: gunakan loguru bukan print/logging
- TypeScript files: gunakan console.log dengan [AgentName] prefix

## Commands
- `make dev` — jalankan swarm lokal
- `make fetch-data` — fetch historical data
- `make backtest` — run backtesting
- `make docker-up` — deploy ke VPS (Phase 2)

## Swarm topology
Hierarchical — orchestrator sebagai queen, specialist agents sebagai workers.
