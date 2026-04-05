"""
Backtesting strategy untuk Polymarket BTC Up/Down menggunakan VectorBT.

Strategy: RSI + Momentum + Polymarket odds composite
"""

from pathlib import Path
import pandas as pd
import numpy as np
import vectorbt as vbt
import pandas_ta as ta
from loguru import logger

DATA_DIR = Path(__file__).parent.parent / "backtesting" / "data"
RESULTS_DIR = Path(__file__).parent.parent / "backtesting" / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


def load_data(window: str = "15m") -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load BTC OHLCV dan Polymarket odds."""
    ohlcv_file = DATA_DIR / f"btc_{window}_90d.csv" if window == "5m" else DATA_DIR / f"btc_{window}_180d.csv"
    odds_file = DATA_DIR / f"polymarket_btc_{window}_odds.csv"

    if not ohlcv_file.exists():
        raise FileNotFoundError(f"Run data-agents/btc_fetcher.py first: {ohlcv_file}")
    if not odds_file.exists():
        raise FileNotFoundError(f"Run data-agents/polymarket_fetcher.py first: {odds_file}")

    ohlcv = pd.read_csv(ohlcv_file, index_col=0, parse_dates=True)
    odds = pd.read_csv(odds_file, index_col=0, parse_dates=True)

    logger.info(f"Loaded {len(ohlcv)} OHLCV candles, {len(odds)} Polymarket windows")
    return ohlcv, odds


def compute_signals(
    ohlcv: pd.DataFrame,
    rsi_period: int = 14,
    momentum_period: int = 10,
    rsi_upper: float = 60.0,
    rsi_lower: float = 40.0,
) -> pd.DataFrame:
    """Compute technical signals."""
    df = ohlcv.copy()

    # RSI
    df["rsi"] = ta.rsi(df["close"], length=rsi_period)

    # Momentum
    df["momentum"] = df["close"].diff(momentum_period)

    # Volume spike (1.5x avg)
    df["vol_avg"] = df["volume"].rolling(10).mean()
    df["vol_spike"] = df["volume"] > df["vol_avg"] * 1.5

    # Signal: 1 = Up, -1 = Down, 0 = Skip
    df["signal"] = 0
    df.loc[(df["rsi"] > rsi_upper) & (df["momentum"] > 0), "signal"] = 1
    df.loc[(df["rsi"] < rsi_lower) & (df["momentum"] < 0), "signal"] = -1

    return df


def run_backtest(
    window: str = "15m",
    rsi_period: int = 14,
    momentum_period: int = 10,
    rsi_upper: float = 60.0,
    rsi_lower: float = 40.0,
    confidence_threshold: float = 0.70,
) -> dict:
    """
    Jalankan backtest dan return metrics.
    Simulasi Polymarket: profit/loss per window berdasarkan direction vs actual.
    """
    ohlcv, odds = load_data(window)
    signals_df = compute_signals(ohlcv, rsi_period, momentum_period, rsi_upper, rsi_lower)

    results = []

    for idx, odds_row in odds.iterrows():
        # Find matching OHLCV window
        window_minutes = 5 if window == "5m" else 15
        window_start = idx
        window_end = idx + pd.Timedelta(minutes=window_minutes)

        # Get signal at start of window
        try:
            signal_at_open = signals_df.loc[
                (signals_df.index >= window_start) &
                (signals_df.index < window_start + pd.Timedelta(minutes=1)),
                "signal"
            ].iloc[0]
        except IndexError:
            continue

        if signal_at_open == 0:
            continue  # skip — no signal

        # Actual outcome from Polymarket resolution
        actual_up = odds_row.get("resolved_up", False)
        predicted_up = signal_at_open == 1
        correct = predicted_up == actual_up

        # Polymarket payout: bet 1 unit, win ~1 unit jika benar (minus fee ~2%)
        pnl = 0.98 if correct else -1.0

        results.append({
            "timestamp": idx,
            "signal": "up" if predicted_up else "down",
            "actual": "up" if actual_up else "down",
            "correct": correct,
            "pnl": pnl,
            "odds_up": odds_row.get("final_odds_up", 0.5),
        })

    if not results:
        logger.warning("No matching windows found for backtest")
        return {}

    df_results = pd.DataFrame(results)
    total_trades = len(df_results)
    wins = df_results["correct"].sum()
    total_pnl = df_results["pnl"].sum()
    win_rate = wins / total_trades if total_trades > 0 else 0

    metrics = {
        "window": window,
        "total_trades": int(total_trades),
        "win_rate": round(float(win_rate), 4),
        "total_pnl": round(float(total_pnl), 4),
        "avg_pnl_per_trade": round(float(df_results["pnl"].mean()), 4),
        "params": {
            "rsi_period": rsi_period,
            "momentum_period": momentum_period,
            "rsi_upper": rsi_upper,
            "rsi_lower": rsi_lower,
            "confidence_threshold": confidence_threshold,
        },
    }

    logger.info(f"Backtest results ({window}):")
    logger.info(f"  Trades: {total_trades}, Win rate: {win_rate:.1%}, Total PnL: {total_pnl:.2f}")

    # Save results
    import json
    out_path = RESULTS_DIR / f"backtest_{window}_results.json"
    with open(out_path, "w") as f:
        json.dump(metrics, f, indent=2)
    logger.info(f"Results saved to {out_path}")

    return metrics


if __name__ == "__main__":
    for w in ["5m", "15m"]:
        try:
            run_backtest(window=w)
        except FileNotFoundError as e:
            logger.error(e)
