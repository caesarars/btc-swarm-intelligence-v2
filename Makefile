.PHONY: setup setup-ts setup-py dev backtest fetch-data clean

# ── Setup ──────────────────────────────────────────────
setup: setup-ts setup-py
	@echo "\n✅ Setup complete! Copy .env.example to .env and fill in your keys."

setup-ts:
	@echo "📦 Installing TypeScript deps (pnpm)..."
	cd ruflo && pnpm install
	@echo "🤖 Initializing Ruflo..."
	cd ruflo && npx ruflo@latest init || true

setup-py:
	@echo "🐍 Setting up Python environment (uv)..."
	uv venv
	uv pip install -r requirements.txt

# ── Development ────────────────────────────────────────
dev:
	@echo "🚀 Starting swarm in dev mode..."
	cd ruflo && pnpm dev

# ── Data ───────────────────────────────────────────────
fetch-data:
	@echo "📡 Fetching BTC historical data from Binance..."
	uv run python data-agents/btc_fetcher.py
	@echo "📡 Fetching Polymarket historical odds..."
	uv run python data-agents/polymarket_fetcher.py

# ── Backtesting ────────────────────────────────────────
backtest:
	@echo "🔬 Running backtest (5m + 15m)..."
	uv run python backtesting/strategies/composite_strategy.py

backtest-5m:
	uv run python -c "from backtesting.strategies.composite_strategy import run_backtest; run_backtest('5m')"

backtest-15m:
	uv run python -c "from backtesting.strategies.composite_strategy import run_backtest; run_backtest('15m')"

# ── Docker (Phase 2) ───────────────────────────────────
docker-build:
	docker build -f docker/Dockerfile.swarm -t btc-swarm .

docker-up:
	docker compose -f docker/docker-compose.yml up -d

docker-logs:
	docker compose -f docker/docker-compose.yml logs -f swarm

docker-down:
	docker compose -f docker/docker-compose.yml down

# ── Utils ──────────────────────────────────────────────
clean:
	rm -rf ruflo/dist ruflo/node_modules .venv
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

env:
	cp .env.example .env
	@echo "✏️  Edit .env dengan API keys kamu"
