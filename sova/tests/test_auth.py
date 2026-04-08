import hashlib
import hmac
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from src.main import app

import pytest

@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

def make_telegram_auth_data(bot_token: str, data: dict) -> dict:
    check_data = sorted(f"{k}={v}" for k, v in data.items() if k != "hash")
    check_string = "\n".join(check_data)
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    hash_value = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
    return {**data, "hash": hash_value}

BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"

@patch("src.api.auth.time")
@patch("src.api.auth.settings")
async def test_telegram_auth_valid(mock_settings, mock_time, client):
    mock_settings.bot_token = BOT_TOKEN
    mock_time.time.return_value = 1712534400 + 100

    auth_data = make_telegram_auth_data(BOT_TOKEN, {
        "id": "123456789",
        "first_name": "Dmitry",
        "username": "dmitry",
        "auth_date": "1712534400",
    })

    resp = await client.post("/api/auth/telegram", json=auth_data)
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["telegram_id"] == 123456789

@patch("src.api.auth.settings")
async def test_telegram_auth_invalid_hash(mock_settings, client):
    mock_settings.bot_token = BOT_TOKEN

    resp = await client.post("/api/auth/telegram", json={
        "id": "123456789",
        "first_name": "Dmitry",
        "username": "dmitry",
        "auth_date": "1712534400",
        "hash": "invalid_hash",
    })
    assert resp.status_code == 401
