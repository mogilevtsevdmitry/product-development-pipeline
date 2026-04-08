"""Trade Worker — executes trade orders via T-Bank API.
Stub: will be implemented in Plan 5 (Trading).
"""
import asyncio
import logging

logger = logging.getLogger(__name__)

async def main():
    logger.info("Trade Worker started (stub)")
    while True:
        await asyncio.sleep(60)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
