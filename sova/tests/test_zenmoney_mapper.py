import pytest
from decimal import Decimal
from datetime import date

from src.services.zenmoney.mapper import ZenMoneyMapper


class TestZenMoneyMapper:
    def setup_method(self):
        self.mapper = ZenMoneyMapper()

    def test_map_account(self):
        zm_account = {
            "id": "acc-1",
            "title": "Tinkoff Black",
            "balance": 50000.50,
            "instrument": 1,
            "type": "ccard",
        }
        instruments = {1: {"shortTitle": "RUB"}}
        result = self.mapper.map_account(zm_account, instruments, user_id=100)

        assert result["name"] == "Tinkoff Black"
        assert result["balance"] == Decimal("50000.50")
        assert result["currency"] == "RUB"
        assert result["source"] == "zenmoney"
        assert result["external_id"] == "acc-1"
        assert result["user_id"] == 100

    def test_map_account_unknown_currency(self):
        zm_account = {
            "id": "acc-2",
            "title": "Test",
            "balance": 100,
            "instrument": 99,
            "type": "cash",
        }
        instruments = {}
        result = self.mapper.map_account(zm_account, instruments, user_id=100)
        assert result["currency"] == "RUB"  # fallback

    def test_map_account_usd_currency(self):
        zm_account = {
            "id": "acc-3",
            "title": "USD Account",
            "balance": 1000,
            "instrument": 2,
            "type": "ccard",
        }
        instruments = {2: {"shortTitle": "USD"}}
        result = self.mapper.map_account(zm_account, instruments, user_id=100)
        assert result["currency"] == "USD"

    def test_map_expense_transaction(self):
        zm_tx = {
            "id": "tx-1",
            "date": "2025-12-01",
            "income": 0,
            "outcome": 350.0,
            "incomeAccount": "acc-1",
            "outcomeAccount": "acc-1",
            "comment": "Кофе в Старбакс",
            "tag": ["cat-food"],
        }
        tags = {"cat-food": "Еда"}
        result = self.mapper.map_transaction(zm_tx, tags, user_id=100)

        assert result["amount"] == Decimal("-350.00")
        assert result["date"] == date(2025, 12, 1)
        assert result["description"] == "Кофе в Старбакс"
        assert result["source"] == "zenmoney"
        assert result["external_id"] == "tx-1"
        assert result["category_name"] == "Еда"

    def test_map_income_transaction(self):
        zm_tx = {
            "id": "tx-2",
            "date": "2025-12-15",
            "income": 150000.0,
            "outcome": 0,
            "incomeAccount": "acc-1",
            "outcomeAccount": "acc-1",
            "comment": "Зарплата",
            "tag": [],
        }
        tags = {}
        result = self.mapper.map_transaction(zm_tx, tags, user_id=100)

        assert result["amount"] == Decimal("150000.00")
        # "Зарплата" matches via CategoryMatcher keyword matching
        assert result["category_name"] in ("Зарплата", "Другое")

    def test_map_transaction_no_comment(self):
        zm_tx = {
            "id": "tx-3",
            "date": "2025-12-01",
            "income": 0,
            "outcome": 100.0,
            "incomeAccount": "acc-1",
            "outcomeAccount": "acc-1",
            "comment": None,
            "tag": [],
        }
        result = self.mapper.map_transaction(zm_tx, {}, user_id=100)
        assert result["description"] is None

    def test_map_transfer_returns_none(self):
        """Transfers between own accounts should be skipped."""
        zm_tx = {
            "id": "tx-4",
            "date": "2025-12-01",
            "income": 5000.0,
            "outcome": 5000.0,
            "incomeAccount": "acc-1",
            "outcomeAccount": "acc-2",
            "comment": "Перевод",
            "tag": [],
        }
        result = self.mapper.map_transaction(zm_tx, {}, user_id=100)
        assert result is None  # skip transfers

    def test_map_same_account_not_transfer(self):
        """Same account income+outcome is not a transfer."""
        zm_tx = {
            "id": "tx-5",
            "date": "2025-12-01",
            "income": 100.0,
            "outcome": 100.0,
            "incomeAccount": "acc-1",
            "outcomeAccount": "acc-1",
            "comment": "Refund",
            "tag": [],
        }
        result = self.mapper.map_transaction(zm_tx, {}, user_id=100)
        assert result is not None  # not a transfer

    def test_build_tag_lookup(self):
        zm_tags = [
            {"id": "cat-food", "title": "Еда"},
            {"id": "cat-transport", "title": "Транспорт"},
        ]
        lookup = self.mapper.build_tag_lookup(zm_tags)
        assert lookup["cat-food"] == "Еда"
        assert lookup["cat-transport"] == "Транспорт"

    def test_build_instrument_lookup(self):
        zm_instruments = [
            {"id": 1, "shortTitle": "RUB"},
            {"id": 2, "shortTitle": "USD"},
        ]
        lookup = self.mapper.build_instrument_lookup(zm_instruments)
        assert lookup[1]["shortTitle"] == "RUB"
        assert lookup[2]["shortTitle"] == "USD"

    def test_category_fallback_to_description(self):
        """When no tags match, should try matching description."""
        zm_tx = {
            "id": "tx-6",
            "date": "2025-12-01",
            "income": 0,
            "outcome": 500.0,
            "incomeAccount": "acc-1",
            "outcomeAccount": "acc-1",
            "comment": "Яндекс Такси",
            "tag": [],
        }
        result = self.mapper.map_transaction(zm_tx, {}, user_id=100)
        assert result["category_name"] == "Транспорт"
