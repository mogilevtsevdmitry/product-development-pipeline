import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch, MagicMock

from src.models.user import User
from src.models.integration import Integration
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.token_refresh import ZenMoneyTokenRefresher

TEST_KEY = "a" * 64


@pytest.fixture
def encryption():
    return EncryptionService(TEST_KEY)


@pytest.fixture
async def user(db):
    u = User(telegram_id=800, username="refreshuser", first_name="Ref")
    db.add(u)
    await db.commit()
    return u


@pytest.fixture
async def integration_expired(db, user, encryption):
    svc = IntegrationService(db, encryption)
    return await svc.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="old-access",
        refresh_token="valid-refresh",
        token_expires_at=datetime.now(timezone.utc) - timedelta(hours=1),  # expired
    )


async def test_refresh_expired_token(db, integration_expired, encryption):
    refresher = ZenMoneyTokenRefresher(db, encryption)

    new_tokens = {
        "access_token": "new-access",
        "refresh_token": "new-refresh",
        "expires_in": 3600,
    }

    with patch("src.services.zenmoney.token_refresh.ZenMoneyOAuth") as MockOAuth:
        mock_oauth = AsyncMock()
        mock_oauth.refresh_token.return_value = new_tokens
        MockOAuth.return_value = mock_oauth

        token = await refresher.ensure_valid_token(integration_expired)

    assert token == "new-access"


async def test_valid_token_no_refresh(db, encryption):
    user = User(telegram_id=801, username="validuser", first_name="Val")
    db.add(user)
    await db.commit()

    svc = IntegrationService(db, encryption)
    integration = await svc.create(
        user_id=801,
        integration_type="zenmoney",
        access_token="still-valid",
        refresh_token="ref-tok",
        token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )

    refresher = ZenMoneyTokenRefresher(db, encryption)

    with patch("src.services.zenmoney.token_refresh.ZenMoneyOAuth") as MockOAuth:
        mock_oauth = AsyncMock()
        MockOAuth.return_value = mock_oauth

        token = await refresher.ensure_valid_token(integration)

    assert token == "still-valid"
    mock_oauth.refresh_token.assert_not_called()


async def test_refresh_failure_disconnects(db, integration_expired, encryption):
    refresher = ZenMoneyTokenRefresher(db, encryption)

    with patch("src.services.zenmoney.token_refresh.ZenMoneyOAuth") as MockOAuth:
        mock_oauth = AsyncMock()
        mock_oauth.refresh_token.side_effect = Exception("Invalid refresh token")
        MockOAuth.return_value = mock_oauth

        token = await refresher.ensure_valid_token(integration_expired)

    assert token is None
    await db.refresh(integration_expired)
    assert integration_expired.status == "disconnected"


async def test_no_refresh_token_disconnects(db, encryption):
    user = User(telegram_id=802, username="norefresh", first_name="NoRef")
    db.add(user)
    await db.commit()

    svc = IntegrationService(db, encryption)
    integration = await svc.create(
        user_id=802,
        integration_type="zenmoney",
        access_token="some-access",
        refresh_token=None,  # No refresh token
        token_expires_at=datetime.now(timezone.utc) - timedelta(hours=1),  # expired
    )

    refresher = ZenMoneyTokenRefresher(db, encryption)
    token = await refresher.ensure_valid_token(integration)

    assert token is None
    await db.refresh(integration)
    assert integration.status == "disconnected"
