"""Maps T-Bank Invest data to our internal model fields.

Returns dicts suitable for constructing PortfolioPosition/PortfolioOperation.
"""
from datetime import datetime, timezone
from decimal import Decimal


class TBankMapper:
    """Maps T-Bank Invest API responses to our data model fields."""

    def map_position(
        self, raw: dict, instrument_info: dict, user_id: int
    ) -> dict:
        """Map a portfolio position to PortfolioPosition fields.

        Args:
            raw: Dict from TBankClient.get_portfolio()
            instrument_info: Dict with ticker, name, sector from instrument lookup.
            user_id: User telegram_id.
        """
        return {
            "user_id": user_id,
            "ticker": instrument_info.get("ticker", "UNKNOWN"),
            "figi": raw["figi"],
            "name": instrument_info.get("name"),
            "quantity": raw["quantity"],
            "avg_price": raw["avg_price"],
            "current_price": raw["current_price"],
            "sector": instrument_info.get("sector"),
            "asset_type": self._map_asset_type(raw.get("instrument_type", "")),
            "currency": raw.get("currency", "rub").upper(),
            "updated_at": datetime.now(timezone.utc),
        }

    def map_operation(
        self, raw: dict, instrument_info: dict, user_id: int
    ) -> dict:
        """Map a portfolio operation to PortfolioOperation fields.

        Args:
            raw: Dict from TBankClient.get_operations()
            instrument_info: Dict with ticker from instrument lookup.
            user_id: User telegram_id.
        """
        return {
            "user_id": user_id,
            "ticker": instrument_info.get("ticker", "UNKNOWN"),
            "operation_type": raw["operation_type"],
            "quantity": Decimal(str(raw.get("quantity", 0))),
            "price": raw.get("price", Decimal("0")),
            "total": raw.get("total", Decimal("0")),
            "executed_at": raw.get("date"),
        }

    @staticmethod
    def _map_asset_type(instrument_type: str) -> str:
        """Map T-Bank instrument type to our asset_type."""
        mapping = {
            "share": "stock",
            "bond": "bond",
            "etf": "etf",
            "currency": "currency",
            "future": "future",
        }
        return mapping.get(instrument_type, "other")
