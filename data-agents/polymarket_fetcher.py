"""
Polymarket historical odds fetcher untuk BTC Up/Down 5m dan 15m.
"""

import os
import time
from pathlib import Path
from datetime import datetime, timedelta
import pandas as pd
import requests
from loguru import logger
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = "https://gamma-api.polymarket.com"
DATA_DIR = Path(__file__).parent.parent / "backtesting" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def fetch_btc_markets(window: str = "15m", limit: int = 100) -> list[dict]:
    """
    Fetch resolved BTC Up/Down markets dari Polymarket.
    window: '5m' atau '15m'
    """
    tag = "5-min" if window == "5m" else "15-min"
    url = f"{BASE_URL}/markets"
    params = {
        "tag": f"bitcoin,{tag}",
        "resolved": "true",
        "limit": limit,
    }

    logger.info(f"Fetching Polymarket BTC {window} resolved markets...")
    res = requests.get(url, params=params, timeout=10)
    res.raise_for_status()
    data = res.json()

    markets = data.get("markets", data) if isinstance(data, dict) else data
    logger.info(f"Found {len(markets)} resolved markets")
    return markets


def parse_markets_to_df(markets: list[dict]) -> pd.DataFrame:
    """
    Parse market data jadi DataFrame yang bisa dipakai backtesting.
    """
    rows = []
    for m in markets:
        try:
            outcomes = m.get("outcomes", m.get("tokens", []))
            up_outcome = next(
                (o for o in outcomes if "up" in str(o.get("outcome", o.get("title", ""))).lower()),
                None
            )
            if not up_outcome:
                continue

            rows.append({
                "market_id": m.get("id", ""),
                "start_time": m.get("startDate", m.get("start_date", "")),
                "end_time": m.get("endDate", m.get("end_date", "")),
                "resolution": m.get("resolution", ""),
                "outcome_up": up_outcome.get("outcome", ""),
                "final_odds_up": float(up_outcome.get("price", 0.5)),
                "resolved_up": str(m.get("resolvedOutcome", "")).lower() == "up",
            })
        except Exception as e:
            logger.warning(f"Skipping market {m.get('id')}: {e}")

    df = pd.DataFrame(rows)
    if not df.empty and "start_time" in df.columns:
        df["start_time"] = pd.to_datetime(df["start_time"])
        df = df.set_index("start_time").sort_index()

    return df


def save_odds(df: pd.DataFrame, window: str) -> Path:
    path = DATA_DIR / f"polymarket_btc_{window}_odds.csv"
    df.to_csv(path)
    logger.info(f"Saved {len(df)} records to {path}")
    return path


if __name__ == "__main__":
    for w in ["5m", "15m"]:
        markets = fetch_btc_markets(window=w, limit=200)
        df = parse_markets_to_df(markets)
        if not df.empty:
            save_odds(df, w)
            logger.info(f"Win rate 'Up' for {w}: {df['resolved_up'].mean():.2%}")
        else:
            logger.warning(f"No data for {w}")
        time.sleep(1)

    logger.info("Polymarket data fetch complete!")
