import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from decimal import Decimal
from datetime import datetime, timezone

from src.services.tbank.client import (
    TBankClient,
    money_value_to_decimal,
    quotation_to_decimal,
)


class TestMoneyValueConversion:
    def test_money_value_to_decimal_normal(self):
        mv = {"units": 285, "nano": 500000000}
        assert money_value_to_decimal(mv) == Decimal("285.5")

    def test_money_value_to_decimal_zero(self):
        mv = {"units": 0, "nano": 0}
        assert money_value_to_decimal(mv) == Decimal("0")

    def test_money_value_to_decimal_negative(self):
        mv = {"units": -28500, "nano": 0}
        assert money_value_to_decimal(mv) == Decimal("-28500")

    def test_money_value_to_decimal_small_nano(self):
        mv = {"units": 1500, "nano": 250000000}
        assert money_value_to_decimal(mv) == Decimal("1500.25")

    def test_money_value_to_decimal_missing_keys(self):
        assert money_value_to_decimal({}) == Decimal("0")

    def test_quotation_to_decimal_alias(self):
        """quotation_to_decimal should be an alias for money_value_to_decimal."""
        mv = {"units": 100, "nano": 100000000}
        assert quotation_to_decimal(mv) == Decimal("100.1")

    def test_string_units_and_nano(self):
        mv = {"units": "42", "nano": "500000000"}
        assert money_value_to_decimal(mv) == Decimal("42.5")


class TestTBankClient:
    @pytest.mark.asyncio
    async def test_get_accounts(self):
        client = TBankClient(token="test-token", sandbox=True, backoff_seconds=[0])
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "accounts": [
                {"id": "acc-1", "name": "Test Account", "type": "ACCOUNT_TYPE_TINKOFF"},
            ]
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            accounts = await client.get_accounts()

        assert len(accounts) == 1
        assert accounts[0]["id"] == "acc-1"

    @pytest.mark.asyncio
    async def test_get_portfolio_returns_positions(self):
        client = TBankClient(token="test-token", sandbox=True, backoff_seconds=[0])

        portfolio_response = MagicMock()
        portfolio_response.status_code = 200
        portfolio_response.json.return_value = {
            "positions": [
                {
                    "figi": "BBG004730N88",
                    "instrumentType": "share",
                    "quantity": {"units": 10, "nano": 0},
                    "averagePositionPrice": {"units": 285, "nano": 0, "currency": "rub"},
                    "currentPrice": {"units": 290, "nano": 500000000},
                },
            ]
        }
        portfolio_response.raise_for_status = MagicMock()

        accounts_response = MagicMock()
        accounts_response.status_code = 200
        accounts_response.json.return_value = {
            "accounts": [{"id": "acc-1"}]
        }
        accounts_response.raise_for_status = MagicMock()

        call_count = 0

        async def mock_post(url, **kwargs):
            nonlocal call_count
            call_count += 1
            if "GetSandboxAccounts" in url:
                return accounts_response
            return portfolio_response

        with patch("httpx.AsyncClient.post", side_effect=mock_post):
            positions = await client.get_portfolio()

        assert len(positions) == 1
        assert positions[0]["figi"] == "BBG004730N88"
        assert positions[0]["quantity"] == Decimal("10")
        assert positions[0]["avg_price"] == Decimal("285")
        assert positions[0]["current_price"] == Decimal("290.5")
        assert positions[0]["currency"] == "rub"

    @pytest.mark.asyncio
    async def test_get_operations_returns_list(self):
        client = TBankClient(token="test-token", sandbox=True, backoff_seconds=[0])
        client._account_id = "acc-1"  # pre-set to avoid extra call

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "operations": [
                {
                    "id": "op-1",
                    "figi": "BBG004730N88",
                    "operationType": "OPERATION_TYPE_BUY",
                    "quantity": 10,
                    "price": {"units": 285, "nano": 0},
                    "payment": {"units": -28500, "nano": 0},
                    "date": "2025-12-01T10:00:00Z",
                    "state": "OPERATION_STATE_EXECUTED",
                },
            ]
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            ops = await client.get_operations(days_back=30)

        assert len(ops) == 1
        assert ops[0]["figi"] == "BBG004730N88"
        assert ops[0]["operation_type"] == "buy"
        assert ops[0]["quantity"] == 10
        assert ops[0]["total"] == Decimal("-28500")

    @pytest.mark.asyncio
    async def test_get_operations_filters_unknown_types(self):
        """Operations with unknown types should be filtered out."""
        client = TBankClient(token="test-token", sandbox=True, backoff_seconds=[0])
        client._account_id = "acc-1"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "operations": [
                {
                    "id": "op-1",
                    "figi": "BBG004730N88",
                    "operationType": "OPERATION_TYPE_BUY",
                    "quantity": 10,
                    "price": {"units": 285, "nano": 0},
                    "payment": {"units": -28500, "nano": 0},
                    "date": "2025-12-01T10:00:00Z",
                    "state": "OPERATION_STATE_EXECUTED",
                },
                {
                    "id": "op-2",
                    "figi": "BBG004730N88",
                    "operationType": "OPERATION_TYPE_TAX",
                    "quantity": 0,
                    "price": {"units": 0, "nano": 0},
                    "payment": {"units": -50, "nano": 0},
                    "date": "2025-12-02T10:00:00Z",
                    "state": "OPERATION_STATE_EXECUTED",
                },
            ]
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            ops = await client.get_operations(days_back=30)

        # TAX should be filtered out
        assert len(ops) == 1
        assert ops[0]["operation_type"] == "buy"

    @pytest.mark.asyncio
    async def test_retry_on_error(self):
        """Client should retry on transient errors."""
        client = TBankClient(
            token="test-token",
            sandbox=True,
            max_retries=3,
            backoff_seconds=[0, 0, 0],
        )
        client._account_id = "acc-1"

        ok_response = MagicMock()
        ok_response.status_code = 200
        ok_response.json.return_value = {"positions": []}
        ok_response.raise_for_status = MagicMock()

        call_count = 0

        async def mock_post(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                raise Exception("Server Error")
            return ok_response

        with patch("httpx.AsyncClient.post", side_effect=mock_post):
            positions = await client.get_portfolio()

        assert positions == []
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_raises_after_all_retries_exhausted(self):
        """Should raise after all retries are exhausted."""
        client = TBankClient(
            token="test-token",
            sandbox=True,
            max_retries=2,
            backoff_seconds=[0, 0],
        )
        client._account_id = "acc-1"

        async def mock_post(*args, **kwargs):
            raise Exception("Persistent Error")

        with patch("httpx.AsyncClient.post", side_effect=mock_post):
            with pytest.raises(Exception, match="Persistent Error"):
                await client.get_portfolio()

    @pytest.mark.asyncio
    async def test_get_instrument_by_figi(self):
        client = TBankClient(token="test-token", sandbox=True, backoff_seconds=[0])

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "instrument": {
                "ticker": "SBER",
                "name": "Sberbank",
                "sector": "financial",
                "instrumentType": "share",
            }
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            info = await client.get_instrument_by_figi("BBG004730N88")

        assert info["ticker"] == "SBER"
        assert info["name"] == "Sberbank"
        assert info["sector"] == "financial"

    @pytest.mark.asyncio
    async def test_get_portfolio_empty_accounts(self):
        """get_portfolio should return [] if no accounts."""
        client = TBankClient(token="test-token", sandbox=True, backoff_seconds=[0])

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"accounts": []}
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            with pytest.raises(ValueError, match="No T-Bank accounts found"):
                await client.get_portfolio()

    def test_parse_operation_type_mapping(self):
        assert TBankClient._parse_operation_type("OPERATION_TYPE_BUY") == "buy"
        assert TBankClient._parse_operation_type("OPERATION_TYPE_SELL") == "sell"
        assert TBankClient._parse_operation_type("OPERATION_TYPE_DIVIDEND") == "dividend"
        assert TBankClient._parse_operation_type("OPERATION_TYPE_COUPON") == "coupon"
        assert TBankClient._parse_operation_type("OPERATION_TYPE_BROKER_FEE") == "commission"
        assert TBankClient._parse_operation_type("OPERATION_TYPE_SERVICE_FEE") == "commission"
        assert TBankClient._parse_operation_type("OPERATION_TYPE_TAX") is None

    def test_parse_datetime(self):
        dt = TBankClient._parse_datetime("2025-12-01T10:00:00Z")
        assert dt == datetime(2025, 12, 1, 10, 0, 0, tzinfo=timezone.utc)

        assert TBankClient._parse_datetime(None) is None
        assert TBankClient._parse_datetime("") is None
