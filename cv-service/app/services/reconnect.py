"""Reconnect backoff utilities (spec §4.5)."""
import random

BACKOFF = [5, 15, 30]
MAX_RECONNECT_ATTEMPTS = 3


def backoff_delay(attempt: int) -> float:
    """Return delay in seconds for reconnect attempt N (1-indexed), +- 20% jitter."""
    base = BACKOFF[min(attempt - 1, len(BACKOFF) - 1)]
    return base * (0.8 + random.random() * 0.4)
