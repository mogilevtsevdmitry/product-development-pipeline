import pytest
from decimal import Decimal
from datetime import datetime, timezone

from src.services.tbank.mapper import TBankMapper


class TestTBankMapper:
    def setup_method(self):
        self.mapper = TBankMapper()

    def test_map_position(self):
        raw = {
            "figi": "BBG004730N88",
            "instrument_type": "share",
            "quantity": Decimal("10"),
            "avg_price": Decimal("285.00"),
            "current_price": Decimal("290.50"),
            "currency": "rub",
        }
        instrument_info = {
            "ticker": "SBER",
            "name": "Sberbank",
            "sector": "financial",
        }
        result = self.mapper.map_position(raw, instrument_info, user_id=100)

        assert result["ticker"] == "SBER"
        assert result["figi"] == "BBG004730N88"
        assert result["name"] == "Sberbank"
        assert result["quantity"] == Decimal("10")
        assert result["avg_price"] == Decimal("285.00")
        assert result["current_price"] == Decimal("290.50")
        assert result["sector"] == "financial"
        assert result["asset_type"] == "stock"
        assert result["currency"] == "RUB"
        assert result["user_id"] == 100

    def test_map_position_missing_instrument_info(self):
        raw = {
            "figi": "BBG000BVPV84",
            "instrument_type": "bond",
            "quantity": Decimal("5"),
            "avg_price": Decimal("950.00"),
            "current_price": Decimal("960.00"),
            "currency": "rub",
        }
        instrument_info = {}
        result = self.mapper.map_position(raw, instrument_info, user_id=200)

        assert result["ticker"] == "UNKNOWN"
        assert result["name"] is None
        assert result["sector"] is None
        assert result["asset_type"] == "bond"

    def test_map_operation_buy(self):
        raw = {
            "id": "op-1",
            "figi": "BBG004730N88",
            "operation_type": "buy",
            "quantity": 10,
            "price": Decimal("285.00"),
            "total": Decimal("-28500.00"),
            "date": datetime(2025, 12, 1, 10, 0, 0, tzinfo=timezone.utc),
        }
        instrument_info = {"ticker": "SBER"}
        result = self.mapper.map_operation(raw, instrument_info, user_id=100)

        assert result["ticker"] == "SBER"
        assert result["operation_type"] == "buy"
        assert result["quantity"] == Decimal("10")
        assert result["price"] == Decimal("285.00")
        assert result["total"] == Decimal("-28500.00")
        assert result["user_id"] == 100
        assert result["executed_at"] == datetime(2025, 12, 1, 10, 0, 0, tzinfo=timezone.utc)

    def test_map_operation_dividend(self):
        raw = {
            "id": "op-2",
            "figi": "BBG004730N88",
            "operation_type": "dividend",
            "quantity": 0,
            "price": Decimal("0"),
            "total": Decimal("1200.00"),
            "date": datetime(2025, 12, 15, tzinfo=timezone.utc),
        }
        instrument_info = {"ticker": "SBER"}
        result = self.mapper.map_operation(raw, instrument_info, user_id=100)
        assert result["operation_type"] == "dividend"
        assert result["total"] == Decimal("1200.00")

    def test_map_operation_missing_fields(self):
        raw = {
            "id": "op-3",
            "figi": "BBG000BVPV84",
            "operation_type": "sell",
        }
        instrument_info = {"ticker": "GAZP"}
        result = self.mapper.map_operation(raw, instrument_info, user_id=100)

        assert result["ticker"] == "GAZP"
        assert result["operation_type"] == "sell"
        assert result["quantity"] == Decimal("0")
        assert result["price"] == Decimal("0")
        assert result["total"] == Decimal("0")
        assert result["executed_at"] is None

    def test_instrument_type_mapping(self):
        assert self.mapper._map_asset_type("share") == "stock"
        assert self.mapper._map_asset_type("bond") == "bond"
        assert self.mapper._map_asset_type("etf") == "etf"
        assert self.mapper._map_asset_type("currency") == "currency"
        assert self.mapper._map_asset_type("future") == "future"
        assert self.mapper._map_asset_type("unknown") == "other"
        assert self.mapper._map_asset_type("") == "other"

    def test_map_position_updated_at_is_set(self):
        """updated_at should be set to approximately now."""
        raw = {
            "figi": "BBG004730N88",
            "instrument_type": "share",
            "quantity": Decimal("1"),
            "avg_price": Decimal("100"),
            "current_price": Decimal("110"),
            "currency": "rub",
        }
        instrument_info = {"ticker": "SBER", "name": "Sberbank", "sector": "financial"}
        result = self.mapper.map_position(raw, instrument_info, user_id=1)

        assert result["updated_at"] is not None
        assert isinstance(result["updated_at"], datetime)
        assert result["updated_at"].tzinfo is not None
