import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime, timezone, timedelta

from src.models.user import User
from src.models.integration import Integration
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.api.oauth_callback import zenmoney_oauth_callback

from fastapi import HTTPException

TEST_KEY = "a" * 64


@pytest.fixture
def encryption():
    return EncryptionService(TEST_KEY)


@pytest.fixture
async def user(db):
    u = User(telegram_id=700, username="oauthuser", first_name="OAuth")
    db.add(u)
    await db.commit()
    return u


async def test_oauth_callback_success(db, user):
    """OAuth callback should exchange code and store tokens."""
    mock_tokens = {
        "access_token": "zm-access",
        "refresh_token": "zm-refresh",
        "expires_in": 3600,
    }

    with patch("src.api.oauth_callback.ZenMoneyOAuth") as MockOAuth:
        mock_oauth = AsyncMock()
        mock_oauth.exchange_code.return_value = mock_tokens
        MockOAuth.return_value = mock_oauth

        with patch("src.api.oauth_callback.settings") as mock_settings:
            mock_settings.zenmoney_consumer_key = "key"
            mock_settings.zenmoney_consumer_secret = "secret"
            mock_settings.zenmoney_redirect_uri = "http://localhost/callback"
            mock_settings.encryption_key = TEST_KEY

            result = await zenmoney_oauth_callback(
                code="auth-code",
                state=str(user.telegram_id),
                db=db,
            )

    assert result["status"] == "connected"

    # Verify integration was created
    encryption = EncryptionService(TEST_KEY)
    svc = IntegrationService(db, encryption)
    integration = await svc.get(user.telegram_id, "zenmoney")
    assert integration is not None
    assert integration.status == "active"


async def test_oauth_callback_missing_code(db):
    """Should raise 400 when code is missing."""
    with pytest.raises(HTTPException) as exc_info:
        await zenmoney_oauth_callback(code=None, state="123", db=db)
    assert exc_info.value.status_code == 400
    assert "code" in exc_info.value.detail.lower()


async def test_oauth_callback_missing_state(db):
    """Should raise 400 when state is missing."""
    with pytest.raises(HTTPException) as exc_info:
        await zenmoney_oauth_callback(code="auth-code", state=None, db=db)
    assert exc_info.value.status_code == 400
    assert "state" in exc_info.value.detail.lower()


async def test_oauth_callback_invalid_state(db):
    """Should raise 400 when state is not a valid integer."""
    with pytest.raises(HTTPException) as exc_info:
        await zenmoney_oauth_callback(code="auth-code", state="not-a-number", db=db)
    assert exc_info.value.status_code == 400
    assert "state" in exc_info.value.detail.lower()


async def test_oauth_callback_exchange_failure(db, user):
    """Should raise 502 when OAuth exchange fails."""
    with patch("src.api.oauth_callback.ZenMoneyOAuth") as MockOAuth:
        mock_oauth = AsyncMock()
        mock_oauth.exchange_code.side_effect = Exception("Network error")
        MockOAuth.return_value = mock_oauth

        with patch("src.api.oauth_callback.settings") as mock_settings:
            mock_settings.zenmoney_consumer_key = "key"
            mock_settings.zenmoney_consumer_secret = "secret"
            mock_settings.zenmoney_redirect_uri = "http://localhost/callback"
            mock_settings.encryption_key = TEST_KEY

            with pytest.raises(HTTPException) as exc_info:
                await zenmoney_oauth_callback(
                    code="bad-code",
                    state=str(user.telegram_id),
                    db=db,
                )
            assert exc_info.value.status_code == 502


async def test_oauth_callback_reconnect_existing(db, user):
    """Should update tokens for existing integration."""
    # Create existing integration
    encryption = EncryptionService(TEST_KEY)
    svc = IntegrationService(db, encryption)
    existing = await svc.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="old-access",
        refresh_token="old-refresh",
        token_expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    # Disconnect it
    await svc.disconnect(user.telegram_id, "zenmoney")
    await db.refresh(existing)
    assert existing.status == "disconnected"

    mock_tokens = {
        "access_token": "new-access",
        "refresh_token": "new-refresh",
        "expires_in": 7200,
    }

    with patch("src.api.oauth_callback.ZenMoneyOAuth") as MockOAuth:
        mock_oauth = AsyncMock()
        mock_oauth.exchange_code.return_value = mock_tokens
        MockOAuth.return_value = mock_oauth

        with patch("src.api.oauth_callback.settings") as mock_settings:
            mock_settings.zenmoney_consumer_key = "key"
            mock_settings.zenmoney_consumer_secret = "secret"
            mock_settings.zenmoney_redirect_uri = "http://localhost/callback"
            mock_settings.encryption_key = TEST_KEY

            result = await zenmoney_oauth_callback(
                code="new-code",
                state=str(user.telegram_id),
                db=db,
            )

    assert result["status"] == "connected"
    await db.refresh(existing)
    assert existing.status == "active"
    assert existing.error_count == 0
