import pytest
from unittest.mock import AsyncMock, MagicMock
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

from src.models import Base


@pytest.fixture
async def db_engine():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db(db_engine) -> AsyncSession:
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture
def mock_bot():
    """Mock aiogram Bot for testing handlers."""
    bot = AsyncMock()
    bot.id = 123456789
    bot.token = "test:token"
    return bot


@pytest.fixture
def make_message(mock_bot):
    """Factory fixture for creating mock Message objects."""
    def _make(
        text: str = "",
        chat_id: int = 1,
        user_id: int = 1,
        username: str = "testuser",
        first_name: str = "Test",
    ):
        message = AsyncMock()
        message.text = text
        message.chat = MagicMock()
        message.chat.id = chat_id
        message.chat.type = "private"
        message.from_user = MagicMock()
        message.from_user.id = user_id
        message.from_user.username = username
        message.from_user.first_name = first_name
        message.bot = mock_bot
        message.answer = AsyncMock()
        message.reply = AsyncMock()
        return message
    return _make


@pytest.fixture
def make_callback(mock_bot):
    """Factory fixture for creating mock CallbackQuery objects."""
    def _make(
        data: str = "",
        chat_id: int = 1,
        user_id: int = 1,
        username: str = "testuser",
        first_name: str = "Test",
    ):
        callback = AsyncMock()
        callback.data = data
        callback.from_user = MagicMock()
        callback.from_user.id = user_id
        callback.from_user.username = username
        callback.from_user.first_name = first_name
        callback.message = AsyncMock()
        callback.message.chat = MagicMock()
        callback.message.chat.id = chat_id
        callback.message.bot = mock_bot
        callback.message.edit_text = AsyncMock()
        callback.message.answer = AsyncMock()
        callback.answer = AsyncMock()
        callback.bot = mock_bot
        return callback
    return _make
