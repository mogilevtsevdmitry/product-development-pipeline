"""Cron Worker — periodic tasks (sync, news, digests).
Stub: will be implemented in Plan 3 (Integrations) and Plan 7 (News).
"""
import asyncio
import logging

logger = logging.getLogger(__name__)

async def main():
    logger.info("Cron Worker started (stub)")
    while True:
        await asyncio.sleep(60)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
