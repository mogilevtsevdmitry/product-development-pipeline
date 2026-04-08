# Sova Plan 3: Integrations (ZenMoney + T-Bank Invest)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ZenMoney OAuth integration and T-Bank Invest read-only integration — encrypted token storage, sync services with diff-based updates, data mapping, category matching, deduplication, bot handlers for connecting integrations, and a cron worker with APScheduler for periodic sync jobs.

**Architecture:** Encryption service wraps `cryptography` Fernet (AES-128-CBC under the hood, derived from ENCRYPTION_KEY). ZenMoney uses OAuth 2.0 with httpx for HTTP calls. T-Bank Invest uses `tinkoff-investments` gRPC SDK. Sync services are idempotent — upsert by `(user_id, source, external_id)`. Cron Worker runs APScheduler with async jobs. All external API calls go through dedicated client classes for testability.

**Tech Stack:** Python 3.12, FastAPI, aiogram 3, SQLAlchemy 2.0 (async), httpx, tinkoff-investments, cryptography, APScheduler, pytest, aiosqlite

**Spec:** `docs/superpowers/specs/2026-04-08-sova-financial-assistant-design.md` (sections 5, 7, 8)

**Depends on:** Plan 1 (Foundation), Plan 2 (Telegram Bot Core)

---

## File Structure

```
sova/
├── src/
│   ├── config.py                              # ADD: zenmoney_consumer_key, zenmoney_consumer_secret
│   ├── services/
│   │   ├── encryption_service.py              # NEW: AES token encrypt/decrypt
│   │   ├── integration_service.py             # NEW: CRUD for integrations, status management
│   │   ├── zenmoney/
│   │   │   ├── __init__.py
│   │   │   ├── client.py                      # NEW: ZenMoney HTTP API client (httpx)
│   │   │   ├── oauth.py                       # NEW: OAuth 2.0 flow helpers
│   │   │   ├── sync.py                        # NEW: Diff-based sync service
│   │   │   └── mapper.py                      # NEW: ZenMoney → our models mapping
│   │   ├── tbank/
│   │   │   ├── __init__.py
│   │   │   ├── client.py                      # NEW: T-Bank Invest gRPC client wrapper
│   │   │   ├── sync.py                        # NEW: Portfolio + operations sync
│   │   │   └── mapper.py                      # NEW: T-Bank → our models mapping
│   │   └── category_matcher.py                # NEW: Keyword-based category matching (reuses expense_parser)
│   ├── api/
│   │   ├── router.py                          # MODIFY: add oauth callback route
│   │   └── oauth_callback.py                  # NEW: GET /api/oauth/zenmoney/callback
│   ├── bot/
│   │   ├── handlers/
│   │   │   ├── settings.py                    # MODIFY: replace integrations stub with real handlers
│   │   │   └── integrations.py                # NEW: connect ZenMoney, connect T-Bank, status
│   │   └── keyboards/
│   │       └── common.py                      # MODIFY: add integration keyboards
│   └── workers/
│       └── cron_worker.py                     # MODIFY: implement APScheduler with sync jobs
├── tests/
│   ├── test_encryption_service.py             # NEW
│   ├── test_integration_service.py            # NEW
│   ├── test_zenmoney_client.py                # NEW
│   ├── test_zenmoney_sync.py                  # NEW
│   ├── test_zenmoney_mapper.py                # NEW
│   ├── test_tbank_client.py                   # NEW
│   ├── test_tbank_sync.py                     # NEW
│   ├── test_tbank_mapper.py                   # NEW
│   ├── test_category_matcher.py               # NEW
│   ├── test_oauth_callback.py                 # NEW
│   └── test_cron_worker.py                    # NEW
└── pyproject.toml                             # MODIFY: add tinkoff-investments, apscheduler
```

---

### Task 1: Add Dependencies

**Files:**
- Modify: `sova/pyproject.toml`
- Modify: `sova/src/config.py`
- Modify: `sova/.env.example`

- [ ] **Step 1: Update pyproject.toml with new dependencies**

```toml
# sova/pyproject.toml — add to [project] dependencies list:
    "tinkoff-investments>=0.2.0",
    "apscheduler>=3.10.0",
```

Full `[project]` dependencies section should be:

```toml
[project]
name = "sova"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "aiogram>=3.13.0",
    "sqlalchemy[asyncio]>=2.0.35",
    "asyncpg>=0.30.0",
    "alembic>=1.14.0",
    "redis>=5.2.0",
    "arq>=0.26.0",
    "pydantic-settings>=2.6.0",
    "cryptography>=43.0.0",
    "httpx>=0.27.0",
    "tinkoff-investments>=0.2.0",
    "apscheduler>=3.10.0",
]
```

- [ ] **Step 2: Add ZenMoney config fields to config.py**

```python
# sova/src/config.py
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://sova:sova@localhost:5432/sova"
    redis_url: str = "redis://localhost:6379/0"
    bot_token: str = ""
    anthropic_api_key: str = ""
    app_base_url: str = "http://localhost:8000"
    encryption_key: str = ""
    webhook_path: str = "/bot/webhook"

    # ZenMoney OAuth 2.0
    zenmoney_consumer_key: str = ""
    zenmoney_consumer_secret: str = ""
    zenmoney_redirect_uri: str = ""  # e.g. https://sova.app/api/oauth/zenmoney/callback

    # T-Bank Invest
    tbank_sandbox: bool = True  # use sandbox by default

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
```

- [ ] **Step 3: Update .env.example**

Add to `sova/.env.example`:

```bash
# ZenMoney OAuth 2.0
ZENMONEY_CONSUMER_KEY=your-zenmoney-consumer-key
ZENMONEY_CONSUMER_SECRET=your-zenmoney-consumer-secret
ZENMONEY_REDIRECT_URI=http://localhost:8000/api/oauth/zenmoney/callback

# T-Bank Invest
TBANK_SANDBOX=true
```

- [ ] **Step 4: Install updated dependencies**

```bash
cd sova && source .venv/bin/activate && pip install -e ".[dev]"
```

Expected: installs `tinkoff-investments`, `apscheduler` successfully.

- [ ] **Step 5: Verify imports work**

```bash
cd sova && source .venv/bin/activate && python -c "from tinkoff.invest import Client; from apscheduler.schedulers.asyncio import AsyncIOScheduler; print('OK')"
```

Expected: prints `OK`

- [ ] **Step 6: Commit**

```bash
git add sova/pyproject.toml sova/src/config.py sova/.env.example
git commit -m "feat(sova): add tinkoff-investments, apscheduler deps and ZenMoney config"
```

---

### Task 2: Encryption Service

**Files:**
- Create: `sova/src/services/encryption_service.py`
- Create: `sova/tests/test_encryption_service.py`

- [ ] **Step 1: Write failing tests for encryption service**

```python
# sova/tests/test_encryption_service.py
import pytest
from src.services.encryption_service import EncryptionService


@pytest.fixture
def encryption():
    # 32-byte hex key for testing
    test_key = "a" * 64  # 32 bytes in hex
    return EncryptionService(test_key)


def test_encrypt_decrypt_roundtrip(encryption):
    plaintext = "my-secret-token-12345"
    encrypted = encryption.encrypt(plaintext)
    assert isinstance(encrypted, bytes)
    assert encrypted != plaintext.encode()
    decrypted = encryption.decrypt(encrypted)
    assert decrypted == plaintext


def test_encrypt_produces_different_ciphertexts(encryption):
    """Each encryption should produce different ciphertext (random IV)."""
    plaintext = "same-token"
    enc1 = encryption.encrypt(plaintext)
    enc2 = encryption.encrypt(plaintext)
    assert enc1 != enc2


def test_decrypt_wrong_key():
    key1 = "a" * 64
    key2 = "b" * 64
    svc1 = EncryptionService(key1)
    svc2 = EncryptionService(key2)

    encrypted = svc1.encrypt("secret")
    with pytest.raises(Exception):
        svc2.decrypt(encrypted)


def test_encrypt_empty_string(encryption):
    encrypted = encryption.encrypt("")
    decrypted = encryption.decrypt(encrypted)
    assert decrypted == ""


def test_encrypt_unicode(encryption):
    plaintext = "Тестовый-токен-🦉"
    encrypted = encryption.encrypt(plaintext)
    decrypted = encryption.decrypt(encrypted)
    assert decrypted == plaintext


def test_invalid_key_raises():
    with pytest.raises(ValueError, match="ENCRYPTION_KEY"):
        EncryptionService("")


def test_short_key_raises():
    with pytest.raises(ValueError, match="ENCRYPTION_KEY"):
        EncryptionService("tooshort")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_encryption_service.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement encryption service**

```python
# sova/src/services/encryption_service.py
"""Token encryption/decryption using Fernet (AES-128-CBC + HMAC-SHA256).

Fernet derives a 256-bit key from the provided key material using URL-safe
base64 encoding. We accept a 32-byte hex-encoded ENCRYPTION_KEY from env,
convert it to 32 bytes, then base64-encode for Fernet.
"""
import base64

from cryptography.fernet import Fernet, InvalidToken


class EncryptionService:
    """Encrypt and decrypt integration tokens.

    Accepts a hex-encoded key (64 hex chars = 32 bytes).
    Uses Fernet which provides AES-128-CBC encryption with HMAC-SHA256 auth.
    Each encrypt() call uses a random IV, so ciphertexts differ for same input.
    """

    def __init__(self, hex_key: str) -> None:
        if not hex_key or len(hex_key) < 32:
            raise ValueError(
                "ENCRYPTION_KEY must be at least 32 hex characters (16 bytes). "
                "Got empty or too short key."
            )
        # Take first 32 bytes (64 hex chars) and convert to Fernet key
        raw_bytes = bytes.fromhex(hex_key[:64].ljust(64, "0"))
        # Fernet requires exactly 32 bytes, url-safe base64 encoded
        self._fernet = Fernet(base64.urlsafe_b64encode(raw_bytes[:32]))

    def encrypt(self, plaintext: str) -> bytes:
        """Encrypt a plaintext string. Returns encrypted bytes."""
        return self._fernet.encrypt(plaintext.encode("utf-8"))

    def decrypt(self, ciphertext: bytes) -> str:
        """Decrypt ciphertext bytes. Returns plaintext string.

        Raises cryptography.fernet.InvalidToken on wrong key or corrupted data.
        """
        return self._fernet.decrypt(ciphertext).decode("utf-8")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_encryption_service.py -v
```

Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sova/src/services/encryption_service.py sova/tests/test_encryption_service.py
git commit -m "feat(sova): add EncryptionService for token encryption (Fernet/AES)"
```

---

### Task 3: Integration Service (CRUD + Status Management)

**Files:**
- Create: `sova/src/services/integration_service.py`
- Create: `sova/tests/test_integration_service.py`

- [ ] **Step 1: Write failing tests**

```python
# sova/tests/test_integration_service.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_integration_service.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement integration service**

```python
# sova/src/services/integration_service.py
"""Integration CRUD and status management service."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.integration import Integration
from src.services.encryption_service import EncryptionService

MAX_ERRORS_BEFORE_STATUS_CHANGE = 3


class IntegrationService:
    def __init__(self, db: AsyncSession, encryption: EncryptionService) -> None:
        self.db = db
        self.encryption = encryption

    async def create(
        self,
        user_id: int,
        integration_type: str,
        access_token: str,
        refresh_token: str | None = None,
        token_expires_at: datetime | None = None,
        sync_from_date=None,
    ) -> Integration:
        """Create a new integration with encrypted tokens."""
        integration = Integration(
            user_id=user_id,
            type=integration_type,
            access_token_encrypted=self.encryption.encrypt(access_token),
            refresh_token_encrypted=(
                self.encryption.encrypt(refresh_token) if refresh_token else None
            ),
            token_expires_at=token_expires_at,
            sync_from_date=sync_from_date,
            status="active",
        )
        self.db.add(integration)
        await self.db.commit()
        await self.db.refresh(integration)
        return integration

    async def get(self, user_id: int, integration_type: str) -> Integration | None:
        """Get integration by user_id and type."""
        result = await self.db.execute(
            select(Integration).where(
                Integration.user_id == user_id,
                Integration.type == integration_type,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, integration_id: uuid.UUID) -> Integration | None:
        """Get integration by its UUID."""
        result = await self.db.execute(
            select(Integration).where(Integration.id == integration_id)
        )
        return result.scalar_one_or_none()

    async def get_access_token(self, user_id: int, integration_type: str) -> str | None:
        """Get decrypted access token for an integration."""
        integration = await self.get(user_id, integration_type)
        if integration is None or integration.access_token_encrypted is None:
            return None
        return self.encryption.decrypt(integration.access_token_encrypted)

    async def get_refresh_token(self, integration_id: uuid.UUID) -> str | None:
        """Get decrypted refresh token."""
        integration = await self.get_by_id(integration_id)
        if integration is None or integration.refresh_token_encrypted is None:
            return None
        return self.encryption.decrypt(integration.refresh_token_encrypted)

    async def update_tokens(
        self,
        integration_id: uuid.UUID,
        access_token: str,
        refresh_token: str | None = None,
        expires_at: datetime | None = None,
    ) -> None:
        """Update encrypted tokens after OAuth refresh."""
        integration = await self.get_by_id(integration_id)
        if integration is None:
            return
        integration.access_token_encrypted = self.encryption.encrypt(access_token)
        if refresh_token is not None:
            integration.refresh_token_encrypted = self.encryption.encrypt(refresh_token)
        if expires_at is not None:
            integration.token_expires_at = expires_at
        await self.db.commit()

    async def record_sync_success(self, integration_id: uuid.UUID) -> None:
        """Record a successful sync — reset error state."""
        integration = await self.get_by_id(integration_id)
        if integration is None:
            return
        integration.last_synced_at = datetime.now(timezone.utc)
        integration.error_count = 0
        integration.last_error = None
        integration.status = "active"
        await self.db.commit()

    async def record_sync_error(self, integration_id: uuid.UUID, error_msg: str) -> None:
        """Record a sync error. After 3 consecutive errors, mark status as 'error'."""
        integration = await self.get_by_id(integration_id)
        if integration is None:
            return
        integration.error_count += 1
        integration.last_error = error_msg
        if integration.error_count >= MAX_ERRORS_BEFORE_STATUS_CHANGE:
            integration.status = "error"
        await self.db.commit()

    async def disconnect(self, user_id: int, integration_type: str) -> None:
        """Mark integration as disconnected."""
        integration = await self.get(user_id, integration_type)
        if integration is None:
            return
        integration.status = "disconnected"
        integration.access_token_encrypted = None
        integration.refresh_token_encrypted = None
        await self.db.commit()

    async def list_for_user(self, user_id: int) -> list[Integration]:
        """List all integrations for a user."""
        result = await self.db.execute(
            select(Integration).where(Integration.user_id == user_id)
        )
        return list(result.scalars().all())

    async def get_active_integrations_by_type(
        self, integration_type: str
    ) -> list[Integration]:
        """Get all active integrations of a given type (for cron sync)."""
        result = await self.db.execute(
            select(Integration).where(
                Integration.type == integration_type,
                Integration.status == "active",
            )
        )
        return list(result.scalars().all())
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_integration_service.py -v
```

Expected: all 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sova/src/services/integration_service.py sova/tests/test_integration_service.py
git commit -m "feat(sova): add IntegrationService with CRUD, encryption, error tracking"
```

---

### Task 4: Category Matcher Service

**Files:**
- Create: `sova/src/services/category_matcher.py`
- Create: `sova/tests/test_category_matcher.py`

- [ ] **Step 1: Write failing tests**

```python
# sova/tests/test_category_matcher.py
import pytest
from sqlalchemy import select

from src.models.user import User
from src.models.category import Category
from src.services.category_matcher import CategoryMatcher


@pytest.fixture
async def user(db):
    u = User(telegram_id=300, username="cmuser", first_name="CM")
    db.add(u)
    await db.commit()
    return u


@pytest.fixture
async def categories(db, user):
    """Seed system categories."""
    cats = []
    for name, icon, cat_type in [
        ("Еда", "🍔", "expense"),
        ("Транспорт", "🚗", "expense"),
        ("Развлечения", "🎭", "expense"),
        ("Здоровье", "💊", "expense"),
        ("Одежда", "👕", "expense"),
        ("Жильё", "🏠", "expense"),
        ("Связь", "📱", "expense"),
        ("Образование", "📚", "expense"),
        ("Красота", "💇", "expense"),
        ("Другое", "📦", "expense"),
        ("Зарплата", "💰", "income"),
    ]:
        cat = Category(name=name, icon=icon, type=cat_type)
        db.add(cat)
        cats.append(cat)
    await db.commit()
    return cats


def test_match_known_keyword(categories):
    matcher = CategoryMatcher()
    assert matcher.match("Кофе Хауз") == "Еда"
    assert matcher.match("Яндекс Такси") == "Транспорт"
    assert matcher.match("Netflix") == "Развлечения"
    assert matcher.match("Аптека Горздрав") == "Здоровье"


def test_match_unknown_falls_to_other(categories):
    matcher = CategoryMatcher()
    assert matcher.match("Что-то непонятное") == "Другое"


def test_match_case_insensitive(categories):
    matcher = CategoryMatcher()
    assert matcher.match("КОФЕ") == "Еда"
    assert matcher.match("Метро") == "Транспорт"


def test_match_zenmoney_category_name(categories):
    """ZenMoney categories often match ours directly."""
    matcher = CategoryMatcher()
    # Direct name match
    assert matcher.match_zenmoney_category("Еда") == "Еда"
    assert matcher.match_zenmoney_category("Транспорт") == "Транспорт"


def test_match_zenmoney_unknown_category(categories):
    matcher = CategoryMatcher()
    assert matcher.match_zenmoney_category("Хобби и увлечения") == "Другое"


def test_match_zenmoney_partial(categories):
    matcher = CategoryMatcher()
    # "Рестораны и кафе" should match "Еда" via keywords
    assert matcher.match_zenmoney_category("Рестораны и кафе") == "Еда"
    assert matcher.match_zenmoney_category("Автомобиль") == "Транспорт"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_category_matcher.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement category matcher**

```python
# sova/src/services/category_matcher.py
"""Keyword-based category matching.

Reuses keyword database from expense_parser for consistency.
Used for mapping ZenMoney categories and transaction descriptions
to our internal category system.

AI-based mapping is deferred to Plan 5.
"""
from src.services.expense_parser import CATEGORY_KEYWORDS, _KEYWORD_TO_CATEGORY

# Additional mappings for ZenMoney category names → our categories
_ZENMONEY_CATEGORY_MAP: dict[str, str] = {
    # Direct matches
    "Еда": "Еда",
    "Продукты": "Еда",
    "Рестораны": "Еда",
    "Рестораны и кафе": "Еда",
    "Кафе и рестораны": "Еда",
    "Фастфуд": "Еда",
    "Транспорт": "Транспорт",
    "Автомобиль": "Транспорт",
    "Такси": "Транспорт",
    "Общественный транспорт": "Транспорт",
    "Бензин": "Транспорт",
    "Развлечения": "Развлечения",
    "Кино": "Развлечения",
    "Отдых и развлечения": "Развлечения",
    "Здоровье": "Здоровье",
    "Медицина": "Здоровье",
    "Аптека": "Здоровье",
    "Спорт": "Здоровье",
    "Фитнес": "Здоровье",
    "Одежда": "Одежда",
    "Одежда и обувь": "Одежда",
    "Жильё": "Жильё",
    "Аренда": "Жильё",
    "ЖКХ": "Жильё",
    "Коммунальные услуги": "Жильё",
    "Ремонт": "Жильё",
    "Связь": "Связь",
    "Интернет": "Связь",
    "Телефон": "Связь",
    "Образование": "Образование",
    "Книги": "Образование",
    "Красота": "Красота",
    "Красота и здоровье": "Красота",
    "Зарплата": "Зарплата",
    "Доход": "Зарплата",
}


class CategoryMatcher:
    """Match transaction descriptions or external category names to our categories."""

    def match(self, description: str) -> str:
        """Match a transaction description to a category using keywords.

        Uses the same keyword database as expense_parser.
        Returns category name string (e.g. "Еда", "Транспорт").
        Falls back to "Другое" if no match.
        """
        desc_lower = description.lower().strip()

        # Exact keyword match
        if desc_lower in _KEYWORD_TO_CATEGORY:
            return _KEYWORD_TO_CATEGORY[desc_lower]

        # Substring match — check if any keyword is contained in description
        for keyword, category in _KEYWORD_TO_CATEGORY.items():
            if keyword in desc_lower:
                return category

        return "Другое"

    def match_zenmoney_category(self, zm_category_name: str) -> str:
        """Match a ZenMoney category name to our category.

        First tries direct mapping, then keyword-based fallback.
        Returns category name string.
        """
        # Direct mapping lookup
        if zm_category_name in _ZENMONEY_CATEGORY_MAP:
            return _ZENMONEY_CATEGORY_MAP[zm_category_name]

        # Try keyword-based matching on the category name itself
        return self.match(zm_category_name)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_category_matcher.py -v
```

Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sova/src/services/category_matcher.py sova/tests/test_category_matcher.py
git commit -m "feat(sova): add CategoryMatcher for keyword-based category mapping"
```

---

### Task 5: ZenMoney API Client

**Files:**
- Create: `sova/src/services/zenmoney/__init__.py`
- Create: `sova/src/services/zenmoney/client.py`
- Create: `sova/src/services/zenmoney/oauth.py`
- Create: `sova/tests/test_zenmoney_client.py`

- [ ] **Step 1: Write failing tests for ZenMoney client**

```python
# sova/tests/test_zenmoney_client.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime, timezone

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
        assert "http://localhost:8000/api/oauth/zenmoney/callback" in url
        assert "https://api.zenmoney.ru/oauth2/authorize" in url

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

        error_response = MagicMock()
        error_response.status_code = 500
        error_response.raise_for_status.side_effect = Exception("Server Error")

        ok_response = MagicMock()
        ok_response.status_code = 200
        ok_response.json.return_value = {"serverTimestamp": 100, "account": [], "transaction": [], "tag": [], "instrument": []}
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_zenmoney_client.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Create __init__.py**

```python
# sova/src/services/zenmoney/__init__.py
```

- [ ] **Step 4: Implement ZenMoney OAuth helper**

```python
# sova/src/services/zenmoney/oauth.py
"""ZenMoney OAuth 2.0 flow helpers.

ZenMoney API docs: https://github.com/zenmoney/ZenPlugins/wiki/ZenMoney-API
OAuth endpoint: https://api.zenmoney.ru/oauth2/authorize
Token endpoint: https://api.zenmoney.ru/oauth2/token
"""
import urllib.parse

import httpx


ZENMONEY_AUTH_URL = "https://api.zenmoney.ru/oauth2/authorize"
ZENMONEY_TOKEN_URL = "https://api.zenmoney.ru/oauth2/token"


class ZenMoneyOAuth:
    """Handles ZenMoney OAuth 2.0 authorization code flow."""

    def __init__(
        self,
        consumer_key: str,
        consumer_secret: str,
        redirect_uri: str,
    ) -> None:
        self.consumer_key = consumer_key
        self.consumer_secret = consumer_secret
        self.redirect_uri = redirect_uri

    def build_auth_url(self, state: str | None = None) -> str:
        """Build the OAuth authorization URL that the user should visit.

        Args:
            state: Opaque value for CSRF protection (e.g. user telegram_id).
        """
        params = {
            "response_type": "code",
            "client_id": self.consumer_key,
            "redirect_uri": self.redirect_uri,
        }
        if state:
            params["state"] = state
        return f"{ZENMONEY_AUTH_URL}?{urllib.parse.urlencode(params)}"

    async def exchange_code(self, code: str) -> dict:
        """Exchange authorization code for access + refresh tokens.

        Returns dict with: access_token, refresh_token, expires_in, token_type.
        Raises httpx.HTTPStatusError on failure.
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                ZENMONEY_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": self.consumer_key,
                    "client_secret": self.consumer_secret,
                    "redirect_uri": self.redirect_uri,
                },
            )
            response.raise_for_status()
            return response.json()

    async def refresh_token(self, refresh_token_value: str) -> dict:
        """Refresh an expired access token using the refresh token.

        Returns dict with: access_token, refresh_token, expires_in.
        Raises httpx.HTTPStatusError on failure.
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                ZENMONEY_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token_value,
                    "client_id": self.consumer_key,
                    "client_secret": self.consumer_secret,
                },
            )
            response.raise_for_status()
            return response.json()
```

- [ ] **Step 5: Implement ZenMoney API client**

```python
# sova/src/services/zenmoney/client.py
"""ZenMoney HTTP API client.

Uses the diff endpoint for incremental sync.
API docs: https://github.com/zenmoney/ZenPlugins/wiki/ZenMoney-API
"""
import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

ZENMONEY_API_URL = "https://api.zenmoney.ru/v8/diff"

# Default retry backoff: 30s, 2m, 10m (from spec)
DEFAULT_BACKOFF = [30, 120, 600]


class ZenMoneyClient:
    """HTTP client for ZenMoney diff API."""

    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    async def diff(
        self,
        server_timestamp: int = 0,
        max_retries: int = 3,
        backoff_seconds: list[int] | None = None,
    ) -> dict:
        """Fetch diff from ZenMoney API.

        Args:
            server_timestamp: Last known server timestamp. 0 for full import.
            max_retries: Number of retry attempts on failure.
            backoff_seconds: Wait times between retries. Defaults to [30, 120, 600].

        Returns:
            Dict with keys: serverTimestamp, account, transaction, tag, instrument, etc.

        Raises:
            Exception: After all retries exhausted.
        """
        if backoff_seconds is None:
            backoff_seconds = DEFAULT_BACKOFF

        last_error = None
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        ZENMONEY_API_URL,
                        headers={
                            "Authorization": f"Bearer {self.access_token}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "currentClientTimestamp": server_timestamp,
                            "serverTimestamp": server_timestamp,
                        },
                    )
                    response.raise_for_status()
                    return response.json()
            except Exception as e:
                last_error = e
                logger.warning(
                    "ZenMoney API error (attempt %d/%d): %s",
                    attempt + 1,
                    max_retries,
                    str(e),
                )
                if attempt < max_retries - 1:
                    wait = backoff_seconds[min(attempt, len(backoff_seconds) - 1)]
                    await asyncio.sleep(wait)

        raise last_error  # type: ignore[misc]
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_zenmoney_client.py -v
```

Expected: all 5 tests PASS

- [ ] **Step 7: Commit**

```bash
git add sova/src/services/zenmoney/ sova/tests/test_zenmoney_client.py
git commit -m "feat(sova): add ZenMoney OAuth helper and HTTP API client with retries"
```

---

### Task 6: ZenMoney Data Mapper

**Files:**
- Create: `sova/src/services/zenmoney/mapper.py`
- Create: `sova/tests/test_zenmoney_mapper.py`

- [ ] **Step 1: Write failing tests**

```python
# sova/tests/test_zenmoney_mapper.py
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
        zm_account = {"id": "acc-2", "title": "Test", "balance": 100, "instrument": 99, "type": "cash"}
        instruments = {}
        result = self.mapper.map_account(zm_account, instruments, user_id=100)
        assert result["currency"] == "RUB"  # fallback

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
        assert result["category_name"] == "Другое"  # no tag, fallback

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_zenmoney_mapper.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement mapper**

```python
# sova/src/services/zenmoney/mapper.py
"""Maps ZenMoney API data to our internal model fields.

Does NOT create ORM objects directly — returns dicts suitable for
constructing Account/Transaction models. This keeps the mapper
testable without a database.
"""
from datetime import date
from decimal import Decimal

from src.services.category_matcher import CategoryMatcher


class ZenMoneyMapper:
    """Maps ZenMoney API responses to our data model fields."""

    def __init__(self) -> None:
        self._category_matcher = CategoryMatcher()

    def build_tag_lookup(self, zm_tags: list[dict]) -> dict[str, str]:
        """Build tag_id → title lookup from ZenMoney tags."""
        return {tag["id"]: tag["title"] for tag in zm_tags}

    def build_instrument_lookup(self, zm_instruments: list[dict]) -> dict[int, dict]:
        """Build instrument_id → instrument dict lookup."""
        return {inst["id"]: inst for inst in zm_instruments}

    def map_account(
        self, zm_account: dict, instruments: dict[int, dict], user_id: int
    ) -> dict:
        """Map a ZenMoney account to our Account model fields.

        Returns dict with keys: user_id, name, currency, balance, source, external_id.
        """
        instrument_id = zm_account.get("instrument")
        currency = "RUB"
        if instrument_id and instrument_id in instruments:
            currency = instruments[instrument_id].get("shortTitle", "RUB")

        return {
            "user_id": user_id,
            "name": zm_account["title"],
            "currency": currency,
            "balance": Decimal(str(zm_account.get("balance", 0))),
            "source": "zenmoney",
            "external_id": str(zm_account["id"]),
        }

    def map_transaction(
        self, zm_tx: dict, tags: dict[str, str], user_id: int
    ) -> dict | None:
        """Map a ZenMoney transaction to our Transaction model fields.

        Returns None for transfers (income > 0 AND outcome > 0 with different accounts).
        Returns dict with keys: user_id, amount, currency, date, description,
            source, external_id, category_name.
        """
        income = zm_tx.get("income", 0) or 0
        outcome = zm_tx.get("outcome", 0) or 0
        income_account = zm_tx.get("incomeAccount")
        outcome_account = zm_tx.get("outcomeAccount")

        # Skip transfers between own accounts
        if income > 0 and outcome > 0 and income_account != outcome_account:
            return None

        # Determine amount: negative for expenses, positive for income
        if outcome > 0:
            amount = Decimal(str(-abs(outcome)))
        else:
            amount = Decimal(str(abs(income)))

        # Resolve category from tags
        tag_ids = zm_tx.get("tag") or []
        category_name = "Другое"
        if tag_ids and isinstance(tag_ids, list):
            for tag_id in tag_ids:
                if tag_id in tags:
                    category_name = self._category_matcher.match_zenmoney_category(
                        tags[tag_id]
                    )
                    break

        # If no category from tags, try matching description
        comment = zm_tx.get("comment")
        if category_name == "Другое" and comment:
            category_name = self._category_matcher.match(comment)

        return {
            "user_id": user_id,
            "amount": amount,
            "currency": "RUB",
            "date": date.fromisoformat(zm_tx["date"]),
            "description": comment,
            "source": "zenmoney",
            "external_id": str(zm_tx["id"]),
            "category_name": category_name,
        }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_zenmoney_mapper.py -v
```

Expected: all 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sova/src/services/zenmoney/mapper.py sova/tests/test_zenmoney_mapper.py
git commit -m "feat(sova): add ZenMoney data mapper with category matching"
```

---

### Task 7: ZenMoney Sync Service

**Files:**
- Create: `sova/src/services/zenmoney/sync.py`
- Create: `sova/tests/test_zenmoney_sync.py`

- [ ] **Step 1: Write failing tests**

```python
# sova/tests/test_zenmoney_sync.py
import pytest
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import select

from src.models.user import User
from src.models.account import Account
from src.models.category import Category
from src.models.transaction import Transaction
from src.models.integration import Integration
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.sync import ZenMoneySyncService

TEST_KEY = "a" * 64


@pytest.fixture
def encryption():
    return EncryptionService(TEST_KEY)


@pytest.fixture
async def user(db):
    u = User(telegram_id=500, username="syncuser", first_name="Sync")
    db.add(u)
    await db.commit()
    return u


@pytest.fixture
async def categories(db):
    for name, icon, cat_type in [
        ("Еда", "🍔", "expense"),
        ("Транспорт", "🚗", "expense"),
        ("Другое", "📦", "expense"),
    ]:
        db.add(Category(name=name, icon=icon, type=cat_type))
    await db.commit()


@pytest.fixture
async def integration(db, user, encryption):
    svc = IntegrationService(db, encryption)
    return await svc.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="zm-token",
        refresh_token="zm-refresh",
    )


def _make_diff_response():
    return {
        "serverTimestamp": 1700000000,
        "instrument": [{"id": 1, "shortTitle": "RUB"}],
        "account": [
            {"id": "acc-1", "title": "Tinkoff Black", "balance": 50000.0, "instrument": 1, "type": "ccard"},
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
            {
                "id": "tx-2",
                "date": "2025-12-01",
                "income": 0,
                "outcome": 600.0,
                "incomeAccount": "acc-1",
                "outcomeAccount": "acc-1",
                "comment": "Такси",
                "tag": ["cat-transport"],
            },
        ],
        "tag": [
            {"id": "cat-food", "title": "Еда"},
            {"id": "cat-transport", "title": "Транспорт"},
        ],
    }


async def test_full_sync_creates_accounts_and_transactions(db, user, integration, encryption, categories):
    sync_svc = ZenMoneySyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.diff.return_value = _make_diff_response()

    with patch("src.services.zenmoney.sync.ZenMoneyClient", return_value=mock_client):
        await sync_svc.sync(integration)

    # Check accounts created
    result = await db.execute(select(Account).where(Account.user_id == user.telegram_id))
    accounts = list(result.scalars().all())
    assert len(accounts) == 1
    assert accounts[0].name == "Tinkoff Black"
    assert accounts[0].external_id == "acc-1"

    # Check transactions created
    result = await db.execute(
        select(Transaction).where(Transaction.user_id == user.telegram_id).order_by(Transaction.external_id)
    )
    transactions = list(result.scalars().all())
    assert len(transactions) == 2
    assert transactions[0].external_id == "tx-1"
    assert transactions[0].amount == Decimal("-350.00")
    assert transactions[1].external_id == "tx-2"
    assert transactions[1].amount == Decimal("-600.00")


async def test_incremental_sync_skips_existing(db, user, integration, encryption, categories):
    """Second sync with same data should not duplicate."""
    sync_svc = ZenMoneySyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.diff.return_value = _make_diff_response()

    with patch("src.services.zenmoney.sync.ZenMoneyClient", return_value=mock_client):
        await sync_svc.sync(integration)
        await sync_svc.sync(integration)  # second sync

    result = await db.execute(select(Transaction).where(Transaction.user_id == user.telegram_id))
    transactions = list(result.scalars().all())
    assert len(transactions) == 2  # no duplicates


async def test_sync_updates_existing_account_balance(db, user, integration, encryption, categories):
    sync_svc = ZenMoneySyncService(db, encryption)

    resp1 = _make_diff_response()
    resp2 = _make_diff_response()
    resp2["account"][0]["balance"] = 45000.0  # balance changed

    mock_client = AsyncMock()
    mock_client.diff.side_effect = [resp1, resp2]

    with patch("src.services.zenmoney.sync.ZenMoneyClient", return_value=mock_client):
        await sync_svc.sync(integration)
        await sync_svc.sync(integration)

    result = await db.execute(select(Account).where(Account.user_id == user.telegram_id))
    account = result.scalar_one()
    assert account.balance == Decimal("45000.00")


async def test_sync_records_error_on_api_failure(db, user, integration, encryption, categories):
    sync_svc = ZenMoneySyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.diff.side_effect = Exception("API timeout")

    with patch("src.services.zenmoney.sync.ZenMoneyClient", return_value=mock_client):
        await sync_svc.sync(integration)

    # Integration should have error recorded
    await db.refresh(integration)
    assert integration.error_count == 1
    assert "API timeout" in integration.last_error
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_zenmoney_sync.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement sync service**

```python
# sova/src/services/zenmoney/sync.py
"""ZenMoney diff-based sync service.

Handles full initial import and incremental updates.
Uses upsert logic for idempotent syncing.
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account
from src.models.category import Category
from src.models.integration import Integration
from src.models.transaction import Transaction
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.client import ZenMoneyClient
from src.services.zenmoney.mapper import ZenMoneyMapper

logger = logging.getLogger(__name__)


class ZenMoneySyncService:
    """Synchronize ZenMoney data into local database."""

    def __init__(self, db: AsyncSession, encryption: EncryptionService) -> None:
        self.db = db
        self.encryption = encryption
        self.mapper = ZenMoneyMapper()
        self._integration_service = IntegrationService(db, encryption)

    async def sync(self, integration: Integration) -> None:
        """Run one sync cycle for a ZenMoney integration.

        1. Decrypt access token
        2. Call ZenMoney diff API (full if first sync, incremental otherwise)
        3. Map and upsert accounts
        4. Map and upsert transactions
        5. Update integration last_synced_at
        """
        try:
            access_token = self.encryption.decrypt(integration.access_token_encrypted)
            client = ZenMoneyClient(access_token=access_token)

            # Use server_timestamp=0 for first sync, otherwise use a stored timestamp
            # For simplicity, we use last_synced_at epoch or 0
            server_timestamp = 0
            if integration.last_synced_at:
                server_timestamp = int(integration.last_synced_at.timestamp())

            data = await client.diff(server_timestamp=server_timestamp)

            # Build lookups
            instruments = self.mapper.build_instrument_lookup(data.get("instrument", []))
            tags = self.mapper.build_tag_lookup(data.get("tag", []))

            # Upsert accounts
            for zm_account in data.get("account", []):
                mapped = self.mapper.map_account(zm_account, instruments, integration.user_id)
                await self._upsert_account(mapped)

            # Upsert transactions
            for zm_tx in data.get("transaction", []):
                mapped = self.mapper.map_transaction(zm_tx, tags, integration.user_id)
                if mapped is None:
                    continue  # skip transfers
                await self._upsert_transaction(mapped)

            await self.db.commit()

            # Record success
            await self._integration_service.record_sync_success(integration.id)
            logger.info("ZenMoney sync completed for user %d", integration.user_id)

        except Exception as e:
            await self.db.rollback()
            await self._integration_service.record_sync_error(
                integration.id, str(e)[:500]
            )
            logger.error(
                "ZenMoney sync failed for user %d: %s",
                integration.user_id,
                str(e),
            )

    async def _upsert_account(self, data: dict) -> Account:
        """Insert or update account by (user_id, source, external_id)."""
        result = await self.db.execute(
            select(Account).where(
                Account.user_id == data["user_id"],
                Account.source == data["source"],
                Account.external_id == data["external_id"],
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.name = data["name"]
            existing.balance = data["balance"]
            existing.currency = data["currency"]
            return existing
        else:
            account = Account(**data)
            self.db.add(account)
            return account

    async def _upsert_transaction(self, data: dict) -> Transaction:
        """Insert or update transaction by (user_id, source, external_id).

        Handles deduplication: if a transaction with the same external_id
        already exists, update it. Otherwise create new.
        """
        category_name = data.pop("category_name", "Другое")

        result = await self.db.execute(
            select(Transaction).where(
                Transaction.user_id == data["user_id"],
                Transaction.source == data["source"],
                Transaction.external_id == data["external_id"],
            )
        )
        existing = result.scalar_one_or_none()

        # Resolve category
        category = await self._find_category(category_name)
        category_id = category.id if category else None

        if existing:
            existing.amount = data["amount"]
            existing.description = data.get("description")
            existing.category_id = category_id
            return existing
        else:
            tx = Transaction(
                **data,
                category_id=category_id,
            )
            self.db.add(tx)
            return tx

    async def _find_category(self, name: str) -> Category | None:
        """Find system category by name."""
        result = await self.db.execute(
            select(Category).where(Category.name == name, Category.user_id.is_(None))
        )
        return result.scalar_one_or_none()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_zenmoney_sync.py -v
```

Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sova/src/services/zenmoney/sync.py sova/tests/test_zenmoney_sync.py
git commit -m "feat(sova): add ZenMoney sync service with idempotent upsert"
```

---

### Task 8: T-Bank Invest Client & Mapper

**Files:**
- Create: `sova/src/services/tbank/__init__.py`
- Create: `sova/src/services/tbank/client.py`
- Create: `sova/src/services/tbank/mapper.py`
- Create: `sova/tests/test_tbank_client.py`
- Create: `sova/tests/test_tbank_mapper.py`

- [ ] **Step 1: Write failing tests for T-Bank client wrapper**

```python
# sova/tests/test_tbank_client.py
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from decimal import Decimal
from datetime import datetime, timezone

from src.services.tbank.client import TBankClient


class TestTBankClient:
    def test_quotation_to_decimal(self):
        """Test conversion of protobuf Quotation to Decimal."""
        from src.services.tbank.client import quotation_to_decimal
        q = MagicMock()
        q.units = 285
        q.nano = 500000000  # 0.5
        assert quotation_to_decimal(q) == Decimal("285.5")

    def test_quotation_to_decimal_zero(self):
        from src.services.tbank.client import quotation_to_decimal
        q = MagicMock()
        q.units = 0
        q.nano = 0
        assert quotation_to_decimal(q) == Decimal("0")

    def test_money_to_decimal(self):
        from src.services.tbank.client import money_to_decimal
        m = MagicMock()
        m.units = 1500
        m.nano = 250000000
        assert money_to_decimal(m) == Decimal("1500.25")

    @pytest.mark.asyncio
    async def test_get_portfolio_returns_positions(self):
        client = TBankClient(token="test-token", sandbox=True)

        mock_position = MagicMock()
        mock_position.figi = "BBG004730N88"
        mock_position.instrument_type = "share"
        mock_position.quantity.units = 10
        mock_position.quantity.nano = 0
        mock_position.average_position_price.units = 285
        mock_position.average_position_price.nano = 0
        mock_position.average_position_price.currency = "rub"
        mock_position.current_price.units = 290
        mock_position.current_price.nano = 500000000

        mock_portfolio = MagicMock()
        mock_portfolio.positions = [mock_position]

        with patch.object(client, "_get_portfolio_raw", new_callable=AsyncMock, return_value=mock_portfolio):
            positions = await client.get_portfolio()

        assert len(positions) == 1
        assert positions[0]["figi"] == "BBG004730N88"
        assert positions[0]["quantity"] == Decimal("10")
        assert positions[0]["avg_price"] == Decimal("285")
        assert positions[0]["current_price"] == Decimal("290.5")

    @pytest.mark.asyncio
    async def test_get_operations_returns_list(self):
        client = TBankClient(token="test-token", sandbox=True)

        mock_op = MagicMock()
        mock_op.id = "op-1"
        mock_op.figi = "BBG004730N88"
        mock_op.operation_type.name = "OPERATION_TYPE_BUY"
        mock_op.quantity = 10
        mock_op.price.units = 285
        mock_op.price.nano = 0
        mock_op.payment.units = -28500
        mock_op.payment.nano = 0
        mock_op.date = datetime(2025, 12, 1, 10, 0, 0, tzinfo=timezone.utc)
        mock_op.state.name = "OPERATION_STATE_EXECUTED"

        with patch.object(client, "_get_operations_raw", new_callable=AsyncMock, return_value=[mock_op]):
            ops = await client.get_operations(days_back=30)

        assert len(ops) == 1
        assert ops[0]["figi"] == "BBG004730N88"
        assert ops[0]["operation_type"] == "buy"
        assert ops[0]["quantity"] == 10
```

- [ ] **Step 2: Write failing tests for T-Bank mapper**

```python
# sova/tests/test_tbank_mapper.py
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
        # Instrument info from SDK
        instrument_info = {
            "ticker": "SBER",
            "name": "Сбербанк",
            "sector": "financial",
        }
        result = self.mapper.map_position(raw, instrument_info, user_id=100)

        assert result["ticker"] == "SBER"
        assert result["figi"] == "BBG004730N88"
        assert result["name"] == "Сбербанк"
        assert result["quantity"] == Decimal("10")
        assert result["avg_price"] == Decimal("285.00")
        assert result["current_price"] == Decimal("290.50")
        assert result["sector"] == "financial"
        assert result["asset_type"] == "stock"
        assert result["currency"] == "RUB"
        assert result["user_id"] == 100

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

    def test_instrument_type_mapping(self):
        assert self.mapper._map_asset_type("share") == "stock"
        assert self.mapper._map_asset_type("bond") == "bond"
        assert self.mapper._map_asset_type("etf") == "etf"
        assert self.mapper._map_asset_type("currency") == "currency"
        assert self.mapper._map_asset_type("future") == "future"
        assert self.mapper._map_asset_type("unknown") == "other"
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_tbank_client.py tests/test_tbank_mapper.py -v
```

Expected: FAIL

- [ ] **Step 4: Create __init__.py**

```python
# sova/src/services/tbank/__init__.py
```

- [ ] **Step 5: Implement T-Bank client wrapper**

```python
# sova/src/services/tbank/client.py
"""T-Bank Invest gRPC client wrapper.

Wraps tinkoff-investments SDK for portfolio and operations sync.
Read-only for Plan 3 — trading is deferred to Plan 6.
"""
import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal

logger = logging.getLogger(__name__)


def quotation_to_decimal(q) -> Decimal:
    """Convert protobuf Quotation (units + nano) to Decimal."""
    return Decimal(str(q.units)) + Decimal(str(q.nano)) / Decimal("1000000000")


def money_to_decimal(m) -> Decimal:
    """Convert protobuf MoneyValue (units + nano) to Decimal."""
    return Decimal(str(m.units)) + Decimal(str(m.nano)) / Decimal("1000000000")


class TBankClient:
    """Read-only wrapper for T-Bank Invest gRPC API.

    Uses tinkoff-investments Python SDK.
    In sandbox mode, uses SandboxService for testing.
    """

    def __init__(self, token: str, sandbox: bool = True) -> None:
        self.token = token
        self.sandbox = sandbox

    async def _get_portfolio_raw(self):
        """Get raw portfolio response from T-Bank SDK.

        Separated for easy mocking in tests.
        """
        from tinkoff.invest import AsyncClient
        async with AsyncClient(self.token, sandbox_token=self.token if self.sandbox else None) as client:
            if self.sandbox:
                accounts = await client.sandbox.get_sandbox_accounts()
            else:
                accounts = await client.users.get_accounts()

            if not accounts.accounts:
                return None

            account_id = accounts.accounts[0].id
            if self.sandbox:
                return await client.sandbox.get_sandbox_portfolio(account_id=account_id)
            else:
                return await client.operations.get_portfolio(account_id=account_id)

    async def get_portfolio(self) -> list[dict]:
        """Get current portfolio positions.

        Returns list of dicts with keys: figi, instrument_type, quantity,
            avg_price, current_price, currency.
        """
        portfolio = await self._get_portfolio_raw()
        if portfolio is None:
            return []

        positions = []
        for pos in portfolio.positions:
            positions.append({
                "figi": pos.figi,
                "instrument_type": pos.instrument_type,
                "quantity": quotation_to_decimal(pos.quantity),
                "avg_price": quotation_to_decimal(pos.average_position_price),
                "current_price": quotation_to_decimal(pos.current_price),
                "currency": getattr(pos.average_position_price, "currency", "rub"),
            })
        return positions

    async def _get_operations_raw(self, from_dt: datetime, to_dt: datetime):
        """Get raw operations from T-Bank SDK. Separated for mocking."""
        from tinkoff.invest import AsyncClient
        from tinkoff.invest.schemas import OperationState

        async with AsyncClient(self.token, sandbox_token=self.token if self.sandbox else None) as client:
            if self.sandbox:
                accounts = await client.sandbox.get_sandbox_accounts()
            else:
                accounts = await client.users.get_accounts()

            if not accounts.accounts:
                return []

            account_id = accounts.accounts[0].id
            if self.sandbox:
                resp = await client.sandbox.get_sandbox_operations(
                    account_id=account_id, from_=from_dt, to=to_dt,
                    state=OperationState.OPERATION_STATE_EXECUTED,
                )
            else:
                resp = await client.operations.get_operations(
                    account_id=account_id, from_=from_dt, to=to_dt,
                    state=OperationState.OPERATION_STATE_EXECUTED,
                )
            return resp.operations

    async def get_operations(self, days_back: int = 30) -> list[dict]:
        """Get executed operations for the last N days.

        Returns list of dicts with keys: id, figi, operation_type,
            quantity, price, total, date.
        """
        to_dt = datetime.now(timezone.utc)
        from_dt = to_dt - timedelta(days=days_back)

        operations = await self._get_operations_raw(from_dt, to_dt)

        result = []
        for op in operations:
            op_type = self._parse_operation_type(op.operation_type.name if hasattr(op.operation_type, 'name') else str(op.operation_type))
            if op_type is None:
                continue

            result.append({
                "id": str(op.id),
                "figi": op.figi,
                "operation_type": op_type,
                "quantity": op.quantity if hasattr(op, 'quantity') else 0,
                "price": quotation_to_decimal(op.price) if hasattr(op, 'price') else Decimal("0"),
                "total": money_to_decimal(op.payment) if hasattr(op, 'payment') else Decimal("0"),
                "date": op.date if hasattr(op, 'date') else None,
            })
        return result

    @staticmethod
    def _parse_operation_type(raw_type: str) -> str | None:
        """Convert T-Bank operation type enum to our type string."""
        mapping = {
            "OPERATION_TYPE_BUY": "buy",
            "OPERATION_TYPE_SELL": "sell",
            "OPERATION_TYPE_DIVIDEND": "dividend",
            "OPERATION_TYPE_COUPON": "coupon",
            "OPERATION_TYPE_BROKER_FEE": "commission",
            "OPERATION_TYPE_SERVICE_FEE": "commission",
        }
        return mapping.get(raw_type)
```

- [ ] **Step 6: Implement T-Bank mapper**

```python
# sova/src/services/tbank/mapper.py
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
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_tbank_client.py tests/test_tbank_mapper.py -v
```

Expected: all 9 tests PASS

- [ ] **Step 8: Commit**

```bash
git add sova/src/services/tbank/ sova/tests/test_tbank_client.py sova/tests/test_tbank_mapper.py
git commit -m "feat(sova): add T-Bank Invest client wrapper and data mapper"
```

---

### Task 9: T-Bank Sync Service

**Files:**
- Create: `sova/src/services/tbank/sync.py`
- Create: `sova/tests/test_tbank_sync.py`

- [ ] **Step 1: Write failing tests**

```python
# sova/tests/test_tbank_sync.py
import pytest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import select

from src.models.user import User
from src.models.integration import Integration
from src.models.portfolio import PortfolioPosition, PortfolioOperation
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.tbank.sync import TBankSyncService

TEST_KEY = "a" * 64


@pytest.fixture
def encryption():
    return EncryptionService(TEST_KEY)


@pytest.fixture
async def user(db):
    u = User(telegram_id=600, username="tbuser", first_name="TB")
    db.add(u)
    await db.commit()
    return u


@pytest.fixture
async def integration(db, user, encryption):
    svc = IntegrationService(db, encryption)
    return await svc.create(
        user_id=user.telegram_id,
        integration_type="tbank_invest",
        access_token="tb-token",
    )


def _make_positions():
    return [
        {
            "figi": "BBG004730N88",
            "instrument_type": "share",
            "quantity": Decimal("10"),
            "avg_price": Decimal("285.00"),
            "current_price": Decimal("290.50"),
            "currency": "rub",
        },
    ]


def _make_operations():
    return [
        {
            "id": "op-1",
            "figi": "BBG004730N88",
            "operation_type": "buy",
            "quantity": 10,
            "price": Decimal("285.00"),
            "total": Decimal("-28500.00"),
            "date": datetime(2025, 12, 1, 10, 0, 0, tzinfo=timezone.utc),
        },
        {
            "id": "op-2",
            "figi": "BBG004730N88",
            "operation_type": "dividend",
            "quantity": 0,
            "price": Decimal("0"),
            "total": Decimal("1200.00"),
            "date": datetime(2025, 12, 15, tzinfo=timezone.utc),
        },
    ]


def _make_instrument_info():
    return {
        "BBG004730N88": {"ticker": "SBER", "name": "Сбербанк", "sector": "financial"},
    }


async def test_sync_creates_positions(db, user, integration, encryption):
    sync_svc = TBankSyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.get_portfolio.return_value = _make_positions()
    mock_client.get_operations.return_value = _make_operations()

    with patch("src.services.tbank.sync.TBankClient", return_value=mock_client):
        with patch.object(sync_svc, "_get_instrument_info", new_callable=AsyncMock, return_value=_make_instrument_info()):
            await sync_svc.sync(integration)

    result = await db.execute(select(PortfolioPosition).where(PortfolioPosition.user_id == user.telegram_id))
    positions = list(result.scalars().all())
    assert len(positions) == 1
    assert positions[0].ticker == "SBER"
    assert positions[0].quantity == Decimal("10")
    assert positions[0].avg_price == Decimal("285.00")
    assert positions[0].current_price == Decimal("290.50")


async def test_sync_creates_operations(db, user, integration, encryption):
    sync_svc = TBankSyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.get_portfolio.return_value = _make_positions()
    mock_client.get_operations.return_value = _make_operations()

    with patch("src.services.tbank.sync.TBankClient", return_value=mock_client):
        with patch.object(sync_svc, "_get_instrument_info", new_callable=AsyncMock, return_value=_make_instrument_info()):
            await sync_svc.sync(integration)

    result = await db.execute(
        select(PortfolioOperation).where(PortfolioOperation.user_id == user.telegram_id)
    )
    operations = list(result.scalars().all())
    assert len(operations) == 2
    assert operations[0].operation_type == "buy"
    assert operations[1].operation_type == "dividend"


async def test_sync_updates_existing_positions(db, user, integration, encryption):
    """Second sync should update positions, not duplicate."""
    sync_svc = TBankSyncService(db, encryption)

    mock_client = AsyncMock()
    positions1 = _make_positions()
    positions2 = _make_positions()
    positions2[0]["current_price"] = Decimal("295.00")

    mock_client.get_portfolio.side_effect = [positions1, positions2]
    mock_client.get_operations.return_value = []

    with patch("src.services.tbank.sync.TBankClient", return_value=mock_client):
        with patch.object(sync_svc, "_get_instrument_info", new_callable=AsyncMock, return_value=_make_instrument_info()):
            await sync_svc.sync(integration)
            await sync_svc.sync(integration)

    result = await db.execute(select(PortfolioPosition).where(PortfolioPosition.user_id == user.telegram_id))
    positions = list(result.scalars().all())
    assert len(positions) == 1
    assert positions[0].current_price == Decimal("295.00")


async def test_sync_records_error_on_failure(db, user, integration, encryption):
    sync_svc = TBankSyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.get_portfolio.side_effect = Exception("gRPC error")

    with patch("src.services.tbank.sync.TBankClient", return_value=mock_client):
        await sync_svc.sync(integration)

    await db.refresh(integration)
    assert integration.error_count == 1
    assert "gRPC error" in integration.last_error
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_tbank_sync.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement T-Bank sync service**

```python
# sova/src/services/tbank/sync.py
"""T-Bank Invest portfolio and operations sync service.

Read-only for Plan 3 — syncs portfolio positions and operations.
Uses upsert logic for idempotent syncing.
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.integration import Integration
from src.models.portfolio import PortfolioPosition, PortfolioOperation
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.tbank.client import TBankClient
from src.services.tbank.mapper import TBankMapper
from src.config import settings

logger = logging.getLogger(__name__)


class TBankSyncService:
    """Synchronize T-Bank Invest data into local database."""

    def __init__(self, db: AsyncSession, encryption: EncryptionService) -> None:
        self.db = db
        self.encryption = encryption
        self.mapper = TBankMapper()
        self._integration_service = IntegrationService(db, encryption)

    async def sync(self, integration: Integration) -> None:
        """Run one sync cycle for a T-Bank Invest integration.

        1. Decrypt API token
        2. Fetch portfolio positions
        3. Fetch recent operations
        4. Map and upsert positions (replace all)
        5. Upsert operations (deduplicate)
        6. Update integration status
        """
        try:
            token = self.encryption.decrypt(integration.access_token_encrypted)
            client = TBankClient(token=token, sandbox=settings.tbank_sandbox)

            # Fetch data
            raw_positions = await client.get_portfolio()
            raw_operations = await client.get_operations(days_back=30)

            # Resolve instrument info (ticker, name, sector)
            figis = {p["figi"] for p in raw_positions}
            figis.update(op["figi"] for op in raw_operations)
            instrument_info = await self._get_instrument_info(token, figis)

            # Upsert positions — delete old, insert fresh
            await self._replace_positions(
                integration.user_id, raw_positions, instrument_info
            )

            # Upsert operations — insert only new
            await self._upsert_operations(
                integration.user_id, raw_operations, instrument_info
            )

            await self.db.commit()
            await self._integration_service.record_sync_success(integration.id)
            logger.info("T-Bank sync completed for user %d", integration.user_id)

        except Exception as e:
            await self.db.rollback()
            await self._integration_service.record_sync_error(
                integration.id, str(e)[:500]
            )
            logger.error(
                "T-Bank sync failed for user %d: %s",
                integration.user_id,
                str(e),
            )

    async def _get_instrument_info(
        self, token: str, figis: set[str]
    ) -> dict[str, dict]:
        """Resolve FIGIs to instrument info (ticker, name, sector).

        Uses T-Bank InstrumentsService. Caches could be added later.
        """
        info = {}
        try:
            from tinkoff.invest import AsyncClient
            async with AsyncClient(token) as client:
                for figi in figis:
                    try:
                        resp = await client.instruments.get_instrument_by(
                            id_type=1,  # FIGI
                            id=figi,
                        )
                        inst = resp.instrument
                        info[figi] = {
                            "ticker": inst.ticker,
                            "name": inst.name,
                            "sector": inst.sector,
                        }
                    except Exception:
                        info[figi] = {"ticker": figi[:10], "name": None, "sector": None}
        except Exception as e:
            logger.warning("Failed to resolve instruments: %s", e)
            for figi in figis:
                info.setdefault(figi, {"ticker": figi[:10], "name": None, "sector": None})
        return info

    async def _replace_positions(
        self,
        user_id: int,
        raw_positions: list[dict],
        instrument_info: dict[str, dict],
    ) -> None:
        """Replace all portfolio positions for a user.

        Delete existing → insert fresh. Simpler than upsert for positions
        since we always get the full portfolio snapshot.
        """
        # Delete existing positions
        await self.db.execute(
            delete(PortfolioPosition).where(PortfolioPosition.user_id == user_id)
        )

        # Insert new positions
        for raw in raw_positions:
            figi = raw["figi"]
            info = instrument_info.get(figi, {"ticker": "UNKNOWN", "name": None, "sector": None})
            mapped = self.mapper.map_position(raw, info, user_id)
            position = PortfolioPosition(**mapped)
            self.db.add(position)

    async def _upsert_operations(
        self,
        user_id: int,
        raw_operations: list[dict],
        instrument_info: dict[str, dict],
    ) -> None:
        """Insert only new operations (deduplicate by ticker + type + date + total)."""
        for raw in raw_operations:
            figi = raw["figi"]
            info = instrument_info.get(figi, {"ticker": "UNKNOWN"})
            mapped = self.mapper.map_operation(raw, info, user_id)

            # Simple dedup: check if operation with same attributes exists
            result = await self.db.execute(
                select(PortfolioOperation).where(
                    PortfolioOperation.user_id == user_id,
                    PortfolioOperation.ticker == mapped["ticker"],
                    PortfolioOperation.operation_type == mapped["operation_type"],
                    PortfolioOperation.executed_at == mapped["executed_at"],
                    PortfolioOperation.total == mapped["total"],
                )
            )
            if result.scalar_one_or_none() is None:
                self.db.add(PortfolioOperation(**mapped))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_tbank_sync.py -v
```

Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sova/src/services/tbank/sync.py sova/tests/test_tbank_sync.py
git commit -m "feat(sova): add T-Bank Invest sync service with position/operation upsert"
```

---

### Task 10: OAuth Callback API Endpoint

**Files:**
- Create: `sova/src/api/oauth_callback.py`
- Modify: `sova/src/api/router.py`
- Create: `sova/tests/test_oauth_callback.py`

- [ ] **Step 1: Write failing tests**

```python
# sova/tests/test_oauth_callback.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient

from src.main import app
from src.models.user import User
from src.models.integration import Integration


@pytest.fixture
async def user(db):
    u = User(telegram_id=700, username="oauthuser", first_name="OAuth")
    db.add(u)
    await db.commit()
    return u


async def test_oauth_callback_success(db, user):
    mock_tokens = {
        "access_token": "zm-access",
        "refresh_token": "zm-refresh",
        "expires_in": 3600,
    }

    with patch("src.api.oauth_callback.ZenMoneyOAuth") as MockOAuth:
        mock_oauth = AsyncMock()
        mock_oauth.exchange_code.return_value = mock_tokens
        MockOAuth.return_value = mock_oauth

        with patch("src.api.oauth_callback.get_db") as mock_get_db:
            mock_get_db.return_value = db

            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get(
                    "/api/oauth/zenmoney/callback",
                    params={"code": "auth-code", "state": str(user.telegram_id)},
                )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "connected"


async def test_oauth_callback_missing_code():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/api/oauth/zenmoney/callback")
    assert response.status_code == 400


async def test_oauth_callback_invalid_state():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get(
            "/api/oauth/zenmoney/callback",
            params={"code": "auth-code", "state": "not-a-number"},
        )
    assert response.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_oauth_callback.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement OAuth callback endpoint**

```python
# sova/src/api/oauth_callback.py
"""OAuth callback endpoint for ZenMoney integration.

Handles the redirect after user authorizes ZenMoney access.
Exchanges auth code for tokens, encrypts and stores them.
"""
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Query, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.oauth import ZenMoneyOAuth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/oauth", tags=["oauth"])


@router.get("/zenmoney/callback")
async def zenmoney_oauth_callback(
    code: str = Query(default=None),
    state: str = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Handle ZenMoney OAuth callback.

    Args:
        code: Authorization code from ZenMoney.
        state: User's telegram_id (passed during auth URL generation).
    """
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    if not state:
        raise HTTPException(status_code=400, detail="Missing state parameter")

    try:
        user_id = int(state)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    # Exchange code for tokens
    oauth = ZenMoneyOAuth(
        consumer_key=settings.zenmoney_consumer_key,
        consumer_secret=settings.zenmoney_consumer_secret,
        redirect_uri=settings.zenmoney_redirect_uri,
    )

    try:
        tokens = await oauth.exchange_code(code)
    except Exception as e:
        logger.error("ZenMoney OAuth exchange failed: %s", e)
        raise HTTPException(status_code=502, detail="Failed to exchange authorization code")

    # Store encrypted tokens
    encryption = EncryptionService(settings.encryption_key)
    integration_service = IntegrationService(db, encryption)

    # Check if integration already exists
    existing = await integration_service.get(user_id, "zenmoney")
    if existing:
        # Update tokens
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))
        await integration_service.update_tokens(
            existing.id,
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token"),
            expires_at=expires_at,
        )
        # Re-activate if was disconnected
        existing.status = "active"
        existing.error_count = 0
        await db.commit()
    else:
        await integration_service.create(
            user_id=user_id,
            integration_type="zenmoney",
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token"),
            token_expires_at=datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600)),
        )

    return {
        "status": "connected",
        "message": "ZenMoney подключён! Вернитесь в Telegram-бот.",
    }
```

- [ ] **Step 4: Update api/router.py to include OAuth routes**

```python
# sova/src/api/router.py
from fastapi import APIRouter
from src.api.health import router as health_router
from src.api.auth import router as auth_router
from src.api.oauth_callback import router as oauth_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(oauth_router)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_oauth_callback.py -v
```

Expected: all 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add sova/src/api/oauth_callback.py sova/src/api/router.py sova/tests/test_oauth_callback.py
git commit -m "feat(sova): add ZenMoney OAuth callback endpoint"
```

---

### Task 11: Bot Integration Handlers

**Files:**
- Create: `sova/src/bot/handlers/integrations.py`
- Modify: `sova/src/bot/handlers/settings.py`
- Modify: `sova/src/bot/keyboards/common.py`
- Modify: `sova/src/bot/setup.py`

- [ ] **Step 1: Add integration keyboards to common.py**

Add to `sova/src/bot/keyboards/common.py`:

```python
def integrations_keyboard(
    zm_status: str | None = None,
    tb_status: str | None = None,
) -> InlineKeyboardMarkup:
    """Integration management keyboard.

    Args:
        zm_status: ZenMoney integration status (None=not connected, active, error, disconnected)
        tb_status: T-Bank integration status
    """
    buttons = []

    # ZenMoney
    if zm_status == "active":
        buttons.append([InlineKeyboardButton(text="✅ ZenMoney подключён", callback_data="integration:zm_status")])
    elif zm_status == "error":
        buttons.append([InlineKeyboardButton(text="⚠️ ZenMoney (ошибка)", callback_data="integration:zm_reconnect")])
    else:
        buttons.append([InlineKeyboardButton(text="🏦 Подключить ZenMoney", callback_data="integration:zm_connect")])

    # T-Bank
    if tb_status == "active":
        buttons.append([InlineKeyboardButton(text="✅ T-Bank Invest подключён", callback_data="integration:tb_status")])
    elif tb_status == "error":
        buttons.append([InlineKeyboardButton(text="⚠️ T-Bank Invest (ошибка)", callback_data="integration:tb_reconnect")])
    else:
        buttons.append([InlineKeyboardButton(text="💳 Подключить T-Bank Invest", callback_data="integration:tb_connect")])

    buttons.append([InlineKeyboardButton(text="◀️ Назад", callback_data="menu:settings")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)
```

- [ ] **Step 2: Create integrations handler**

```python
# sova/src/bot/handlers/integrations.py
"""Bot handlers for integration management (ZenMoney, T-Bank Invest)."""
from aiogram import Router, F
from aiogram.types import CallbackQuery, Message
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.oauth import ZenMoneyOAuth
from src.bot.keyboards.common import integrations_keyboard, settings_keyboard

router = Router(name="integrations")


class TBankTokenState(StatesGroup):
    waiting_token = State()


async def _get_integration_statuses(db: AsyncSession, user_id: int) -> tuple[str | None, str | None]:
    """Get current integration statuses for a user."""
    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)

    zm = await svc.get(user_id, "zenmoney")
    tb = await svc.get(user_id, "tbank_invest")

    zm_status = zm.status if zm else None
    tb_status = tb.status if tb else None
    return zm_status, tb_status


# --- Show integrations ---

@router.callback_query(F.data == "settings:integrations")
async def on_integrations(callback: CallbackQuery, db: AsyncSession) -> None:
    """Show integration status and connect buttons."""
    zm_status, tb_status = await _get_integration_statuses(db, callback.from_user.id)

    text = "🏦 *Интеграции:*\n\n"
    if zm_status == "active":
        text += "✅ ZenMoney — подключён\n"
    elif zm_status == "error":
        text += "⚠️ ZenMoney — ошибка синхронизации\n"
    else:
        text += "⬜ ZenMoney — не подключён\n"

    if tb_status == "active":
        text += "✅ T-Bank Invest — подключён\n"
    elif tb_status == "error":
        text += "⚠️ T-Bank Invest — ошибка синхронизации\n"
    else:
        text += "⬜ T-Bank Invest — не подключён\n"

    await callback.message.edit_text(
        text,
        reply_markup=integrations_keyboard(zm_status, tb_status),
    )
    await callback.answer()


# --- ZenMoney Connect ---

@router.callback_query(F.data.in_({"integration:zm_connect", "integration:zm_reconnect", "integration:zenmoney"}))
async def on_zm_connect(callback: CallbackQuery, db: AsyncSession) -> None:
    """Start ZenMoney OAuth flow — send authorization URL."""
    oauth = ZenMoneyOAuth(
        consumer_key=settings.zenmoney_consumer_key,
        consumer_secret=settings.zenmoney_consumer_secret,
        redirect_uri=settings.zenmoney_redirect_uri,
    )
    auth_url = oauth.build_auth_url(state=str(callback.from_user.id))

    await callback.message.edit_text(
        "🏦 *Подключение ZenMoney*\n\n"
        "1. Нажми на ссылку ниже\n"
        "2. Авторизуйся в ZenMoney\n"
        "3. Разреши доступ для Совы\n"
        "4. Вернись в бот — всё подключится автоматически\n\n"
        f"[🔗 Подключить ZenMoney]({auth_url})",
        parse_mode="Markdown",
    )
    await callback.answer()


# --- T-Bank Connect ---

@router.callback_query(F.data.in_({"integration:tb_connect", "integration:tb_reconnect", "integration:tbank"}))
async def on_tb_connect(callback: CallbackQuery, state: FSMContext, db: AsyncSession) -> None:
    """Start T-Bank token input flow."""
    await callback.message.edit_text(
        "💳 *Подключение T-Bank Invest*\n\n"
        "1. Откройте приложение T-Bank Инвестиции\n"
        "2. Перейдите в Настройки → Работа с API\n"
        "3. Создайте новый токен (только на чтение)\n"
        "4. Скопируйте и отправьте токен сюда\n\n"
        "⚠️ Используйте *read-only* токен для безопасности.",
        parse_mode="Markdown",
    )
    await state.set_state(TBankTokenState.waiting_token)
    await callback.answer()


@router.message(TBankTokenState.waiting_token)
async def on_tb_token_received(message: Message, state: FSMContext, db: AsyncSession) -> None:
    """Process T-Bank API token from user."""
    token = message.text.strip() if message.text else ""

    if not token or len(token) < 20:
        await message.answer("❌ Токен слишком короткий. Попробуйте ещё раз.")
        return

    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)

    # Check if already connected
    existing = await svc.get(message.from_user.id, "tbank_invest")
    if existing:
        await svc.update_tokens(existing.id, access_token=token)
        existing.status = "active"
        existing.error_count = 0
        await db.commit()
    else:
        await svc.create(
            user_id=message.from_user.id,
            integration_type="tbank_invest",
            access_token=token,
        )

    await state.clear()
    await message.answer(
        "✅ T-Bank Invest подключён!\n\n"
        "Портфель синхронизируется каждый час (7:00-23:00).\n"
        "Первая синхронизация начнётся в ближайшее время.",
    )

    # Delete the message with the token for security
    try:
        await message.delete()
    except Exception:
        pass


# --- Status details ---

@router.callback_query(F.data == "integration:zm_status")
async def on_zm_status(callback: CallbackQuery, db: AsyncSession) -> None:
    """Show ZenMoney integration details."""
    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)
    integration = await svc.get(callback.from_user.id, "zenmoney")

    if integration is None:
        await callback.answer("Не подключено")
        return

    last_sync = integration.last_synced_at.strftime("%d.%m.%Y %H:%M") if integration.last_synced_at else "ещё нет"

    from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
    await callback.message.edit_text(
        f"🏦 *ZenMoney*\n\n"
        f"Статус: {integration.status}\n"
        f"Последняя синхронизация: {last_sync}\n"
        f"Ошибок подряд: {integration.error_count}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔄 Переподключить", callback_data="integration:zm_reconnect")],
            [InlineKeyboardButton(text="❌ Отключить", callback_data="integration:zm_disconnect")],
            [InlineKeyboardButton(text="◀️ Назад", callback_data="settings:integrations")],
        ]),
        parse_mode="Markdown",
    )
    await callback.answer()


@router.callback_query(F.data == "integration:tb_status")
async def on_tb_status(callback: CallbackQuery, db: AsyncSession) -> None:
    """Show T-Bank integration details."""
    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)
    integration = await svc.get(callback.from_user.id, "tbank_invest")

    if integration is None:
        await callback.answer("Не подключено")
        return

    last_sync = integration.last_synced_at.strftime("%d.%m.%Y %H:%M") if integration.last_synced_at else "ещё нет"

    from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
    await callback.message.edit_text(
        f"💳 *T-Bank Invest*\n\n"
        f"Статус: {integration.status}\n"
        f"Последняя синхронизация: {last_sync}\n"
        f"Ошибок подряд: {integration.error_count}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔄 Обновить токен", callback_data="integration:tb_reconnect")],
            [InlineKeyboardButton(text="❌ Отключить", callback_data="integration:tb_disconnect")],
            [InlineKeyboardButton(text="◀️ Назад", callback_data="settings:integrations")],
        ]),
        parse_mode="Markdown",
    )
    await callback.answer()


# --- Disconnect ---

@router.callback_query(F.data == "integration:zm_disconnect")
async def on_zm_disconnect(callback: CallbackQuery, db: AsyncSession) -> None:
    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)
    await svc.disconnect(callback.from_user.id, "zenmoney")
    await callback.message.edit_text("🏦 ZenMoney отключён.")
    await callback.answer()


@router.callback_query(F.data == "integration:tb_disconnect")
async def on_tb_disconnect(callback: CallbackQuery, db: AsyncSession) -> None:
    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)
    await svc.disconnect(callback.from_user.id, "tbank_invest")
    await callback.message.edit_text("💳 T-Bank Invest отключён.")
    await callback.answer()
```

- [ ] **Step 3: Update settings.py — remove integrations stub, delegate to integrations handler**

Replace the `INTEGRATIONS_STUB_TEXT` and `on_integrations` handler in `sova/src/bot/handlers/settings.py`:

Remove:
```python
INTEGRATIONS_STUB_TEXT = (
    "🏦 *Интеграции:*\n\n"
    "Подключение ZenMoney и T-Bank будет доступно в следующем обновлении.\n\n"
    "Следи за обновлениями!"
)
```

Remove the `on_integrations` callback handler (the `settings:integrations` callback is now handled by `integrations.py`):
```python
@router.callback_query(F.data == "settings:integrations")
async def on_integrations(callback: CallbackQuery, db: AsyncSession) -> None:
    ...
```

- [ ] **Step 4: Register integrations router in bot/setup.py**

Add to the `register_handlers()` function in `sova/src/bot/setup.py`:

```python
from src.bot.handlers.integrations import router as integrations_router
main_router.include_router(integrations_router)
```

Add this **before** the expense router (which catches plain text).

- [ ] **Step 5: Run existing tests to ensure nothing broke**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/ -v --ignore=tests/test_oauth_callback.py
```

Expected: all existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add sova/src/bot/handlers/integrations.py sova/src/bot/handlers/settings.py sova/src/bot/keyboards/common.py sova/src/bot/setup.py
git commit -m "feat(sova): add bot handlers for ZenMoney OAuth and T-Bank token connection"
```

---

### Task 12: Cron Worker with APScheduler

**Files:**
- Modify: `sova/src/workers/cron_worker.py`
- Create: `sova/tests/test_cron_worker.py`

- [ ] **Step 1: Write tests for cron worker**

```python
# sova/tests/test_cron_worker.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from src.workers.cron_worker import sync_zenmoney_all, sync_tbank_all


async def test_sync_zenmoney_all_calls_sync_for_active_integrations(db):
    """sync_zenmoney_all should sync each active ZenMoney integration."""
    mock_integration = MagicMock()
    mock_integration.id = "int-1"
    mock_integration.user_id = 100
    mock_integration.type = "zenmoney"

    with patch("src.workers.cron_worker.IntegrationService") as MockIntSvc:
        mock_svc = AsyncMock()
        mock_svc.get_active_integrations_by_type.return_value = [mock_integration]
        MockIntSvc.return_value = mock_svc

        with patch("src.workers.cron_worker.ZenMoneySyncService") as MockSync:
            mock_sync = AsyncMock()
            MockSync.return_value = mock_sync

            with patch("src.workers.cron_worker.async_session") as mock_session_factory:
                mock_db = AsyncMock()
                mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_db)
                mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

                await sync_zenmoney_all()

            mock_sync.sync.assert_called_once_with(mock_integration)


async def test_sync_tbank_all_calls_sync_for_active_integrations(db):
    """sync_tbank_all should sync each active T-Bank integration."""
    mock_integration = MagicMock()
    mock_integration.id = "int-2"
    mock_integration.user_id = 200
    mock_integration.type = "tbank_invest"

    with patch("src.workers.cron_worker.IntegrationService") as MockIntSvc:
        mock_svc = AsyncMock()
        mock_svc.get_active_integrations_by_type.return_value = [mock_integration]
        MockIntSvc.return_value = mock_svc

        with patch("src.workers.cron_worker.TBankSyncService") as MockSync:
            mock_sync = AsyncMock()
            MockSync.return_value = mock_sync

            with patch("src.workers.cron_worker.async_session") as mock_session_factory:
                mock_db = AsyncMock()
                mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_db)
                mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

                await sync_tbank_all()

            mock_sync.sync.assert_called_once_with(mock_integration)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_cron_worker.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement cron worker**

```python
# sova/src/workers/cron_worker.py
"""Cron Worker — periodic sync tasks using APScheduler.

Jobs:
- sync_zenmoney_all: every 4 hours — sync all active ZenMoney integrations
- sync_tbank_all: every hour, 7:00-23:00 — sync all active T-Bank integrations
"""
import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from src.config import settings
from src.database import async_session
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.sync import ZenMoneySyncService
from src.services.tbank.sync import TBankSyncService

logger = logging.getLogger(__name__)


async def sync_zenmoney_all() -> None:
    """Sync all active ZenMoney integrations."""
    logger.info("Starting ZenMoney sync for all users")
    async with async_session() as db:
        encryption = EncryptionService(settings.encryption_key)
        int_service = IntegrationService(db, encryption)
        integrations = await int_service.get_active_integrations_by_type("zenmoney")

        logger.info("Found %d active ZenMoney integrations", len(integrations))
        for integration in integrations:
            try:
                sync_service = ZenMoneySyncService(db, encryption)
                await sync_service.sync(integration)
            except Exception as e:
                logger.error(
                    "ZenMoney sync failed for user %d: %s",
                    integration.user_id,
                    str(e),
                )


async def sync_tbank_all() -> None:
    """Sync all active T-Bank Invest integrations."""
    logger.info("Starting T-Bank sync for all users")
    async with async_session() as db:
        encryption = EncryptionService(settings.encryption_key)
        int_service = IntegrationService(db, encryption)
        integrations = await int_service.get_active_integrations_by_type("tbank_invest")

        logger.info("Found %d active T-Bank integrations", len(integrations))
        for integration in integrations:
            try:
                sync_service = TBankSyncService(db, encryption)
                await sync_service.sync(integration)
            except Exception as e:
                logger.error(
                    "T-Bank sync failed for user %d: %s",
                    integration.user_id,
                    str(e),
                )


def create_scheduler() -> AsyncIOScheduler:
    """Create and configure APScheduler with sync jobs."""
    scheduler = AsyncIOScheduler()

    # ZenMoney: every 4 hours
    scheduler.add_job(
        sync_zenmoney_all,
        trigger=IntervalTrigger(hours=4),
        id="sync_zenmoney",
        name="Sync ZenMoney (all users)",
        replace_existing=True,
    )

    # T-Bank: every hour, 7:00-23:00 MSK
    scheduler.add_job(
        sync_tbank_all,
        trigger=CronTrigger(hour="7-23", minute=0, timezone="Europe/Moscow"),
        id="sync_tbank",
        name="Sync T-Bank Invest (all users)",
        replace_existing=True,
    )

    return scheduler


async def main():
    """Main entry point for the cron worker process."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger.info("Cron Worker starting")

    scheduler = create_scheduler()
    scheduler.start()
    logger.info("Cron Worker started, scheduled jobs: %s", [j.id for j in scheduler.get_jobs()])

    try:
        # Keep the worker running
        while True:
            await asyncio.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        logger.info("Cron Worker shutting down")
        scheduler.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_cron_worker.py -v
```

Expected: all 2 tests PASS

- [ ] **Step 5: Run all tests to verify nothing is broken**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/ -v
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add sova/src/workers/cron_worker.py sova/tests/test_cron_worker.py
git commit -m "feat(sova): implement Cron Worker with APScheduler for ZenMoney/T-Bank sync"
```

---

### Task 13: Token Refresh Logic

**Files:**
- Create: `sova/src/services/zenmoney/token_refresh.py`
- Create: `sova/tests/test_token_refresh.py`

- [ ] **Step 1: Write failing tests**

```python
# sova/tests/test_token_refresh.py
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


@pytest.fixture
async def integration_valid(db, user, encryption):
    svc = IntegrationService(db, encryption)
    return await svc.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="valid-access",
        refresh_token="valid-refresh",
        token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1),  # still valid
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_token_refresh.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement token refresher**

```python
# sova/src/services/zenmoney/token_refresh.py
"""ZenMoney token refresh logic.

Auto-refreshes expired access tokens. If refresh fails,
marks integration as disconnected and returns None.
"""
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.integration import Integration
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.oauth import ZenMoneyOAuth

logger = logging.getLogger(__name__)

# Refresh 5 minutes before actual expiry to avoid race conditions
TOKEN_EXPIRY_BUFFER = timedelta(minutes=5)


class ZenMoneyTokenRefresher:
    """Ensures a valid access token for ZenMoney API calls."""

    def __init__(self, db: AsyncSession, encryption: EncryptionService) -> None:
        self.db = db
        self.encryption = encryption
        self._integration_service = IntegrationService(db, encryption)

    async def ensure_valid_token(self, integration: Integration) -> str | None:
        """Get a valid access token, refreshing if expired.

        Returns:
            Valid access token string, or None if refresh failed
            (integration will be marked as disconnected).
        """
        now = datetime.now(timezone.utc)

        # Check if token is still valid
        if integration.token_expires_at and integration.token_expires_at > now + TOKEN_EXPIRY_BUFFER:
            # Token is still valid
            return self.encryption.decrypt(integration.access_token_encrypted)

        # Token expired — try to refresh
        if integration.refresh_token_encrypted is None:
            logger.warning(
                "No refresh token for integration %s (user %d) — disconnecting",
                integration.id,
                integration.user_id,
            )
            await self._integration_service.disconnect(
                integration.user_id, integration.type
            )
            return None

        refresh_token_value = self.encryption.decrypt(integration.refresh_token_encrypted)

        try:
            oauth = ZenMoneyOAuth(
                consumer_key=settings.zenmoney_consumer_key,
                consumer_secret=settings.zenmoney_consumer_secret,
                redirect_uri=settings.zenmoney_redirect_uri,
            )
            tokens = await oauth.refresh_token(refresh_token_value)

            # Update stored tokens
            expires_at = now + timedelta(seconds=tokens.get("expires_in", 3600))
            await self._integration_service.update_tokens(
                integration.id,
                access_token=tokens["access_token"],
                refresh_token=tokens.get("refresh_token"),
                expires_at=expires_at,
            )

            logger.info("Refreshed ZenMoney token for user %d", integration.user_id)
            return tokens["access_token"]

        except Exception as e:
            logger.error(
                "Failed to refresh ZenMoney token for user %d: %s",
                integration.user_id,
                str(e),
            )
            # Disconnect — user needs to re-authorize
            await self._integration_service.disconnect(
                integration.user_id, integration.type
            )
            # TODO: Send notification to user via bot (Plan 7)
            return None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/test_token_refresh.py -v
```

Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sova/src/services/zenmoney/token_refresh.py sova/tests/test_token_refresh.py
git commit -m "feat(sova): add ZenMoney token auto-refresh with disconnect on failure"
```

---

### Task 14: Final Integration — Run All Tests & Verify

- [ ] **Step 1: Run full test suite**

```bash
cd sova && source .venv/bin/activate && python -m pytest tests/ -v --tb=short
```

Expected: all tests PASS (approximately 50+ tests total)

- [ ] **Step 2: Verify imports work**

```bash
cd sova && source .venv/bin/activate && python -c "
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.category_matcher import CategoryMatcher
from src.services.zenmoney.client import ZenMoneyClient
from src.services.zenmoney.oauth import ZenMoneyOAuth
from src.services.zenmoney.sync import ZenMoneySyncService
from src.services.zenmoney.mapper import ZenMoneyMapper
from src.services.zenmoney.token_refresh import ZenMoneyTokenRefresher
from src.services.tbank.client import TBankClient
from src.services.tbank.sync import TBankSyncService
from src.services.tbank.mapper import TBankMapper
from src.workers.cron_worker import create_scheduler
print('All imports OK')
"
```

Expected: `All imports OK`

- [ ] **Step 3: Verify cron worker starts**

```bash
cd sova && source .venv/bin/activate && timeout 5 python -c "
import asyncio
from src.workers.cron_worker import create_scheduler
scheduler = create_scheduler()
scheduler.start()
jobs = scheduler.get_jobs()
print(f'Jobs scheduled: {len(jobs)}')
for job in jobs:
    print(f'  - {job.id}: {job.name}')
scheduler.shutdown()
" || true
```

Expected: `Jobs scheduled: 2` with ZenMoney and T-Bank jobs listed

- [ ] **Step 4: Final commit with all remaining changes**

```bash
git add -A sova/
git commit -m "feat(sova): complete Plan 3 — ZenMoney + T-Bank Invest integrations"
```

---

## Summary

| Task | Files | Tests | What it does |
|------|-------|-------|-------------|
| 1 | pyproject.toml, config.py, .env.example | — | Add tinkoff-investments, apscheduler deps and ZenMoney config |
| 2 | encryption_service.py | 7 | AES token encrypt/decrypt via Fernet |
| 3 | integration_service.py | 11 | CRUD, encrypted token storage, error tracking, disconnect |
| 4 | category_matcher.py | 7 | Keyword matching for ZenMoney category mapping |
| 5 | zenmoney/client.py, oauth.py | 5 | OAuth flow + HTTP diff API with retries |
| 6 | zenmoney/mapper.py | 9 | ZenMoney data → Account/Transaction mapping |
| 7 | zenmoney/sync.py | 4 | Idempotent diff-based sync with upsert |
| 8 | tbank/client.py, mapper.py | 9 | gRPC wrapper + PortfolioPosition/Operation mapping |
| 9 | tbank/sync.py | 4 | Portfolio replace + operation dedup sync |
| 10 | api/oauth_callback.py, router.py | 3 | OAuth redirect handler endpoint |
| 11 | bot/handlers/integrations.py, setup.py, keyboards | — | Bot UI for connecting integrations |
| 12 | workers/cron_worker.py | 2 | APScheduler: ZenMoney 4h, T-Bank hourly 7-23 |
| 13 | zenmoney/token_refresh.py | 3 | Auto-refresh, disconnect on failure |
| 14 | — | — | Full test run + verification |

**Total estimated tests: ~64**
