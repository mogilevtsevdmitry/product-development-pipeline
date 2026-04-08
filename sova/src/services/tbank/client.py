"""T-Bank Invest REST API client.

Wraps the T-Bank Invest public REST API (https://invest-public-api.tinkoff.ru/rest/)
using httpx. Does NOT depend on the tinkoff-investments SDK (unavailable on Python 3.12).

Read-only for Plan 3 -- trading is deferred to Plan 6.
"""
import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://invest-public-api.tinkoff.ru/rest"


def money_value_to_decimal(mv: dict) -> Decimal:
    """Convert T-Bank MoneyValue {units, nano} dict to Decimal.

    MoneyValue format: units (int) + nano (int, 0..999_999_999).
    Example: {units: 285, nano: 500000000} -> Decimal("285.5")
    """
    units = mv.get("units", 0)
    nano = mv.get("nano", 0)
    # Handle string units (API sometimes returns strings)
    units = int(units) if isinstance(units, str) else units
    nano = int(nano) if isinstance(nano, str) else nano
    return Decimal(str(units)) + Decimal(str(nano)) / Decimal("1000000000")


def quotation_to_decimal(q: dict) -> Decimal:
    """Convert T-Bank Quotation {units, nano} dict to Decimal."""
    return money_value_to_decimal(q)


class TBankClient:
    """Read-only client for T-Bank Invest REST API.

    Uses httpx.AsyncClient with Bearer token authentication.
    All methods return Python dicts parsed from JSON.
    Retries up to 3 times with exponential backoff on errors.
    """

    def __init__(
        self,
        token: str,
        sandbox: bool = True,
        base_url: str = BASE_URL,
        max_retries: int = 3,
        backoff_seconds: list[float] | None = None,
    ) -> None:
        self.token = token
        self.sandbox = sandbox
        self.base_url = base_url
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds or [1.0, 2.0, 4.0]
        self._account_id: str | None = None

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def _request(self, endpoint: str, body: dict | None = None) -> dict:
        """Make a POST request to T-Bank REST API with retry logic.

        Args:
            endpoint: REST endpoint path (e.g. "/tinkoff.public.invest.api...").
            body: JSON body dict.

        Returns:
            Parsed JSON response as dict.

        Raises:
            httpx.HTTPStatusError or Exception after all retries exhausted.
        """
        import asyncio

        url = f"{self.base_url}{endpoint}"
        last_exc: Exception | None = None

        for attempt in range(self.max_retries):
            try:
                async with httpx.AsyncClient(timeout=30.0) as http:
                    response = await http.post(
                        url, json=body or {}, headers=self._headers()
                    )
                    response.raise_for_status()
                    return response.json()
            except Exception as exc:
                last_exc = exc
                if attempt < self.max_retries - 1:
                    delay = (
                        self.backoff_seconds[attempt]
                        if attempt < len(self.backoff_seconds)
                        else self.backoff_seconds[-1]
                    )
                    logger.warning(
                        "T-Bank API request failed (attempt %d/%d): %s. Retrying in %.1fs",
                        attempt + 1,
                        self.max_retries,
                        exc,
                        delay,
                    )
                    await asyncio.sleep(delay)

        raise last_exc  # type: ignore[misc]

    async def get_accounts(self) -> list[dict]:
        """Get user accounts.

        Returns list of account dicts with 'id', 'name', 'type', 'status'.
        """
        if self.sandbox:
            data = await self._request(
                "/tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxAccounts"
            )
        else:
            data = await self._request(
                "/tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts"
            )
        return data.get("accounts", [])

    async def _resolve_account_id(self) -> str:
        """Resolve account ID, using cached value if available."""
        if self._account_id is not None:
            return self._account_id
        accounts = await self.get_accounts()
        if not accounts:
            raise ValueError("No T-Bank accounts found")
        self._account_id = accounts[0]["id"]
        return self._account_id

    async def get_portfolio(self, account_id: str | None = None) -> list[dict]:
        """Get current portfolio positions.

        Returns list of dicts with keys:
            figi, instrument_type, quantity, avg_price, current_price, currency.
        """
        acc_id = account_id or await self._resolve_account_id()

        if self.sandbox:
            endpoint = "/tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxPortfolio"
        else:
            endpoint = "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio"

        data = await self._request(endpoint, {"accountId": acc_id})

        positions = []
        for pos in data.get("positions", []):
            quantity = quotation_to_decimal(pos.get("quantity", {}))
            avg_price_data = pos.get("averagePositionPrice", {})
            current_price_data = pos.get("currentPrice", {})

            positions.append({
                "figi": pos.get("figi", ""),
                "instrument_type": pos.get("instrumentType", ""),
                "quantity": quantity,
                "avg_price": money_value_to_decimal(avg_price_data),
                "current_price": money_value_to_decimal(current_price_data),
                "currency": avg_price_data.get("currency", "rub"),
            })
        return positions

    async def get_operations(
        self,
        account_id: str | None = None,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        days_back: int = 30,
    ) -> list[dict]:
        """Get executed operations for a date range.

        Returns list of dicts with keys:
            id, figi, operation_type, quantity, price, total, date, state.
        """
        acc_id = account_id or await self._resolve_account_id()

        if to_date is None:
            to_date = datetime.now(timezone.utc)
        if from_date is None:
            from_date = to_date - timedelta(days=days_back)

        if self.sandbox:
            endpoint = "/tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxOperations"
        else:
            endpoint = "/tinkoff.public.invest.api.contract.v1.OperationsService/GetOperations"

        body = {
            "accountId": acc_id,
            "from": from_date.isoformat(),
            "to": to_date.isoformat(),
            "state": "OPERATION_STATE_EXECUTED",
        }

        data = await self._request(endpoint, body)

        result = []
        for op in data.get("operations", []):
            op_type = self._parse_operation_type(op.get("operationType", ""))
            if op_type is None:
                continue

            price_data = op.get("price", {})
            payment_data = op.get("payment", {})

            result.append({
                "id": op.get("id", ""),
                "figi": op.get("figi", ""),
                "operation_type": op_type,
                "quantity": op.get("quantity", 0),
                "price": money_value_to_decimal(price_data),
                "total": money_value_to_decimal(payment_data),
                "date": self._parse_datetime(op.get("date")),
                "state": op.get("state", ""),
            })
        return result

    async def get_instrument_by_figi(self, figi: str) -> dict:
        """Look up instrument info by FIGI.

        Returns dict with ticker, name, sector, instrumentType.
        """
        data = await self._request(
            "/tinkoff.public.invest.api.contract.v1.InstrumentsService/GetInstrumentBy",
            {"idType": "INSTRUMENT_ID_TYPE_FIGI", "id": figi},
        )
        instrument = data.get("instrument", {})
        return {
            "ticker": instrument.get("ticker", figi[:10]),
            "name": instrument.get("name"),
            "sector": instrument.get("sector"),
            "instrument_type": instrument.get("instrumentType", ""),
        }

    @staticmethod
    def _parse_operation_type(raw_type: str) -> str | None:
        """Convert T-Bank operation type enum to our type string."""
        mapping = {
            "OPERATION_TYPE_BUY": "buy",
            "OPERATION_TYPE_SELL": "sell",
            "OPERATION_TYPE_DIVIDEND": "dividend",
            "OPERATION_TYPE_COUPON": "coupon",
            "OPERATION_TYPE_BROKER_FEE": "commission",
            "OPERATION_TYPE_SERVICE_FEE": "commission",
        }
        return mapping.get(raw_type)

    @staticmethod
    def _parse_datetime(dt_str: str | None) -> datetime | None:
        """Parse ISO 8601 datetime string from T-Bank API."""
        if not dt_str:
            return None
        try:
            # Handle both 'Z' suffix and '+00:00' offset
            if dt_str.endswith("Z"):
                dt_str = dt_str[:-1] + "+00:00"
            return datetime.fromisoformat(dt_str)
        except (ValueError, TypeError):
            return None
