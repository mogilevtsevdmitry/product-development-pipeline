"""AI Worker — processes LLM tasks from Redis queue.
Stub: will be implemented in Plan 4 (AI System).
"""
import asyncio
import logging

logger = logging.getLogger(__name__)

async def main():
    logger.info("AI Worker started (stub)")
    while True:
        await asyncio.sleep(60)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
