import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from src.services.zenmoney.client import ZenMoneyClient
from src.services.zenmoney.oauth import ZenMoneyOAuth


class TestZenMoneyOAuth:
    def test_build_auth_url(self):
        oauth = ZenMoneyOAuth(
            consumer_key="test-key",
            consumer_secret="test-secret",
            redirect_uri="http://localhost:8000/api/oauth/zenmoney/callback",
        )
        url = oauth.build_auth_url(state="user-123")
        assert "test-key" in url
        assert "user-123" in url
        assert "redirect_uri=http" in url
        assert "zenmoney" in url
        assert "https://api.zenmoney.ru/oauth2/authorize" in url

    def test_build_auth_url_without_state(self):
        oauth = ZenMoneyOAuth(
            consumer_key="test-key",
            consumer_secret="test-secret",
            redirect_uri="http://localhost:8000/callback",
        )
        url = oauth.build_auth_url()
        assert "state" not in url
        assert "test-key" in url

    @pytest.mark.asyncio
    async def test_exchange_code_for_tokens(self):
        oauth = ZenMoneyOAuth(
            consumer_key="key",
            consumer_secret="secret",
            redirect_uri="http://localhost/callback",
        )
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "access_token": "zm-access-token",
            "token_type": "bearer",
            "refresh_token": "zm-refresh-token",
            "expires_in": 3600,
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            tokens = await oauth.exchange_code("auth-code-123")

        assert tokens["access_token"] == "zm-access-token"
        assert tokens["refresh_token"] == "zm-refresh-token"
        assert "expires_in" in tokens

    @pytest.mark.asyncio
    async def test_refresh_access_token(self):
        oauth = ZenMoneyOAuth(
            consumer_key="key",
            consumer_secret="secret",
            redirect_uri="http://localhost/callback",
        )
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "access_token": "new-access",
            "refresh_token": "new-refresh",
            "expires_in": 3600,
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            tokens = await oauth.refresh_token("old-refresh-token")

        assert tokens["access_token"] == "new-access"


class TestZenMoneyClient:
    @pytest.mark.asyncio
    async def test_diff_sync(self):
        client = ZenMoneyClient(access_token="test-token")
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "serverTimestamp": 1700000000,
            "instrument": [],
            "account": [
                {
                    "id": "acc-1",
                    "title": "Tinkoff Black",
                    "balance": 50000.0,
                    "instrument": 1,
                    "type": "ccard",
                },
            ],
            "transaction": [
                {
                    "id": "tx-1",
                    "date": "2025-12-01",
                    "income": 0,
                    "outcome": 350.0,
                    "incomeAccount": "acc-1",
                    "outcomeAccount": "acc-1",
                    "comment": "Кофе",
                    "tag": ["cat-food"],
                },
            ],
            "tag": [
                {"id": "cat-food", "title": "Еда"},
            ],
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            data = await client.diff(server_timestamp=0)

        assert data["serverTimestamp"] == 1700000000
        assert len(data["account"]) == 1
        assert len(data["transaction"]) == 1
        assert data["account"][0]["title"] == "Tinkoff Black"

    @pytest.mark.asyncio
    async def test_diff_with_retry_on_500(self):
        client = ZenMoneyClient(access_token="test-token")

        ok_response = MagicMock()
        ok_response.status_code = 200
        ok_response.json.return_value = {
            "serverTimestamp": 100,
            "account": [],
            "transaction": [],
            "tag": [],
            "instrument": [],
        }
        ok_response.raise_for_status = MagicMock()

        call_count = 0

        async def mock_post(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                raise Exception("Server Error")
            return ok_response

        with patch("httpx.AsyncClient.post", side_effect=mock_post):
            data = await client.diff(server_timestamp=0, max_retries=3, backoff_seconds=[0, 0, 0])

        assert data["serverTimestamp"] == 100
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_diff_raises_after_all_retries_exhausted(self):
        client = ZenMoneyClient(access_token="test-token")

        async def mock_post(*args, **kwargs):
            raise Exception("Persistent Error")

        with patch("httpx.AsyncClient.post", side_effect=mock_post):
            with pytest.raises(Exception, match="Persistent Error"):
                await client.diff(server_timestamp=0, max_retries=2, backoff_seconds=[0, 0])
