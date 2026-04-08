from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from src.config import settings

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)

async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
