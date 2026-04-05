"""
BTC OHLCV fetcher dari Binance.
Simpan data ke backtesting/data/ untuk dipakai VectorBT.
"""

import os
import json
import time
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd
from binance.client import Client
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent.parent / ".env")

DATA_DIR = Path(__file__).parent.parent / "backtesting" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def get_client() -> Client:
    api_key = os.getenv("BINANCE_API_KEY", "")
    api_secret = os.getenv("BINANCE_API_SECRET", "")
    return Client(api_key, api_secret)


def fetch_ohlcv(
    symbol: str = "BTCUSDT",
    interval: str = "1m",
    days_back: int = 30,
) -> pd.DataFrame:
    """
    Fetch historical OHLCV dari Binance.
    interval: 1m, 5m, 15m, 1h, dll
    """
    client = get_client()
    start = datetime.utcnow() - timedelta(days=days_back)
    start_str = start.strftime("%d %b %Y %H:%M:%S")

    logger.info(f"Fetching {symbol} {interval} data from {start_str}...")

    klines = client.get_historical_klines(
        symbol=symbol,
        interval=interval,
        start_str=start_str,
    )

    df = pd.DataFrame(klines, columns=[
        "timestamp", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "trades",
        "taker_buy_base", "taker_buy_quote", "ignore",
    ])

    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df = df.set_index("timestamp")

    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)

    df = df[["open", "high", "low", "close", "volume"]]
    logger.info(f"Fetched {len(df)} candles")
    return df


def save_ohlcv(df: pd.DataFrame, filename: str) -> Path:
    path = DATA_DIR / filename
    df.to_csv(path)
    logger.info(f"Saved to {path}")
    return path


if __name__ == "__main__":
    # Fetch 1m data untuk 5m/15m backtesting
    df_1m = fetch_ohlcv(interval="1m", days_back=60)
    save_ohlcv(df_1m, "btc_1m_60d.csv")

    # Fetch 5m data
    df_5m = fetch_ohlcv(interval="5m", days_back=90)
    save_ohlcv(df_5m, "btc_5m_90d.csv")

    # Fetch 15m data
    df_15m = fetch_ohlcv(interval="15m", days_back=180)
    save_ohlcv(df_15m, "btc_15m_180d.csv")

    logger.info("All data fetched and saved!")
