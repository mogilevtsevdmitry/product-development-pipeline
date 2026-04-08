"""ZenMoney HTTP API client.

Uses the diff endpoint for incremental sync.
API docs: https://github.com/zenmoney/ZenPlugins/wiki/ZenMoney-API
"""
import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

ZENMONEY_API_URL = "https://api.zenmoney.ru/v8/diff"

# Default retry backoff: 30s, 2m, 10m (from spec)
DEFAULT_BACKOFF = [30, 120, 600]


class ZenMoneyClient:
    """HTTP client for ZenMoney diff API."""

    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    async def diff(
        self,
        server_timestamp: int = 0,
        max_retries: int = 3,
        backoff_seconds: list[int] | None = None,
    ) -> dict:
        """Fetch diff from ZenMoney API.

        Args:
            server_timestamp: Last known server timestamp. 0 for full import.
            max_retries: Number of retry attempts on failure.
            backoff_seconds: Wait times between retries. Defaults to [30, 120, 600].

        Returns:
            Dict with keys: serverTimestamp, account, transaction, tag, instrument, etc.

        Raises:
            Exception: After all retries exhausted.
        """
        if backoff_seconds is None:
            backoff_seconds = DEFAULT_BACKOFF

        last_error = None
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        ZENMONEY_API_URL,
                        headers={
                            "Authorization": f"Bearer {self.access_token}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "currentClientTimestamp": server_timestamp,
                            "serverTimestamp": server_timestamp,
                        },
                    )
                    response.raise_for_status()
                    return response.json()
            except Exception as e:
                last_error = e
                logger.warning(
                    "ZenMoney API error (attempt %d/%d): %s",
                    attempt + 1,
                    max_retries,
                    str(e),
                )
                if attempt < max_retries - 1:
                    wait = backoff_seconds[min(attempt, len(backoff_seconds) - 1)]
                    await asyncio.sleep(wait)

        raise last_error  # type: ignore[misc]
