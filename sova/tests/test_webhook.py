import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport

from src.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_webhook_endpoint_exists(client):
    """Webhook endpoint should exist and reject invalid updates."""
    resp = await client.post(
        "/bot/webhook",
        json={"update_id": 1, "message": {"message_id": 1, "date": 1, "chat": {"id": 1, "type": "private"}}},
    )
    # Should not return 404 (endpoint exists)
    assert resp.status_code != 404


async def test_health_still_works(client):
    """Ensure health endpoint still works after bot setup."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
