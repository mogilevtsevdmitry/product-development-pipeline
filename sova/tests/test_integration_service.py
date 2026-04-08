import pytest
from datetime import datetime, timezone, timedelta

from src.models.user import User
from src.models.integration import Integration
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService

TEST_KEY = "a" * 64


@pytest.fixture
def encryption():
    return EncryptionService(TEST_KEY)


@pytest.fixture
async def user(db):
    u = User(telegram_id=100, username="iuser", first_name="Int")
    db.add(u)
    await db.commit()
    return u


@pytest.fixture
def service(db, encryption):
    return IntegrationService(db, encryption)


async def test_create_integration(service, user):
    integration = await service.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="access-123",
        refresh_token="refresh-456",
        token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    assert integration.type == "zenmoney"
    assert integration.status == "active"
    assert integration.access_token_encrypted is not None
    assert integration.refresh_token_encrypted is not None
    assert integration.error_count == 0


async def test_get_integration(service, user):
    await service.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="tok",
    )
    result = await service.get(user.telegram_id, "zenmoney")
    assert result is not None
    assert result.type == "zenmoney"


async def test_get_nonexistent_returns_none(service, user):
    result = await service.get(user.telegram_id, "zenmoney")
    assert result is None


async def test_get_access_token_decrypted(service, user):
    await service.create(
        user_id=user.telegram_id,
        integration_type="tbank_invest",
        access_token="my-tbank-token",
    )
    token = await service.get_access_token(user.telegram_id, "tbank_invest")
    assert token == "my-tbank-token"


async def test_update_tokens(service, user):
    integration = await service.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="old",
        refresh_token="old-ref",
    )
    new_expires = datetime.now(timezone.utc) + timedelta(hours=2)
    await service.update_tokens(
        integration.id,
        access_token="new-access",
        refresh_token="new-refresh",
        expires_at=new_expires,
    )
    token = await service.get_access_token(user.telegram_id, "zenmoney")
    assert token == "new-access"


async def test_record_sync_success(service, user):
    integration = await service.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="tok",
    )
    # Simulate previous errors
    integration.error_count = 3
    integration.last_error = "timeout"
    integration.status = "error"
    await service.db.commit()

    await service.record_sync_success(integration.id)

    updated = await service.get(user.telegram_id, "zenmoney")
    assert updated.error_count == 0
    assert updated.last_error is None
    assert updated.status == "active"
    assert updated.last_synced_at is not None


async def test_record_sync_error(service, user):
    integration = await service.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="tok",
    )
    await service.record_sync_error(integration.id, "API timeout")

    updated = await service.get(user.telegram_id, "zenmoney")
    assert updated.error_count == 1
    assert updated.last_error == "API timeout"
    assert updated.status == "active"  # still active after 1 error


async def test_record_sync_error_marks_error_after_3(service, user):
    integration = await service.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="tok",
    )
    for i in range(3):
        await service.record_sync_error(integration.id, f"error {i}")

    updated = await service.get(user.telegram_id, "zenmoney")
    assert updated.error_count == 3
    assert updated.status == "error"


async def test_disconnect(service, user):
    await service.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="tok",
    )
    await service.disconnect(user.telegram_id, "zenmoney")
    updated = await service.get(user.telegram_id, "zenmoney")
    assert updated.status == "disconnected"


async def test_list_user_integrations(service, user):
    await service.create(user_id=user.telegram_id, integration_type="zenmoney", access_token="t1")
    await service.create(user_id=user.telegram_id, integration_type="tbank_invest", access_token="t2")
    integrations = await service.list_for_user(user.telegram_id)
    assert len(integrations) == 2
    types = {i.type for i in integrations}
    assert types == {"zenmoney", "tbank_invest"}
