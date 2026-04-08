# Plan 5: AI System

**Date:** 2026-04-08
**Status:** Implementation

## Overview

Implement the AI subsystem for Sova: LLM provider abstraction, context builder, AI service with billing integration, system prompts with legal restrictions, AI worker (arq), bot handlers for AI queries, and digest cron job.

## Files to Create

### src/services/ai/ (new package)
1. `__init__.py` — exports
2. `llm_provider.py` — ABC + ClaudeProvider + FallbackProvider
3. `prompts.py` — system prompts with legal restrictions
4. `context_builder.py` — gathers user financial context for LLM
5. `service.py` — AIService: orchestrates billing, context, LLM, logging

### src/bot/handlers/ai.py (new)
- AI query handler: detect AI-intent, confirm cost, process
- `/digest` command

### Tests (new)
- `tests/test_llm_provider.py` — ClaudeProvider, FallbackProvider
- `tests/test_ai_prompts.py` — prompt generation, legal restrictions
- `tests/test_ai_context_builder.py` — context building
- `tests/test_ai_service.py` — full AI service flow with mocked LLM
- `tests/test_ai_worker.py` — arq worker tests
- `tests/test_handlers_ai.py` — bot handler tests

## Files to Modify

1. `src/workers/ai_worker.py` — replace stub with arq worker
2. `src/workers/cron_worker.py` — add digest generation job
3. `src/bot/setup.py` — register AI handler router
4. `src/bot/handlers/expense.py` — fallback to smart_categorize (future hook)

## Implementation Steps

### Step 1: LLM Provider (`src/services/ai/llm_provider.py`)
- ABC with `complete(system, user) -> str` and `categorize(description, categories) -> str`
- `ClaudeProvider`: httpx POST to Messages API, Sonnet for complete, Haiku for categorize
- `FallbackProvider`: wraps providers, switches on 3 consecutive failures

### Step 2: Prompts (`src/services/ai/prompts.py`)
- System prompt with legal restrictions (CRITICAL)
- Per-query-type prompt templates
- Investment disclaimer

### Step 3: Context Builder (`src/services/ai/context_builder.py`)
- Gather user profile, financial summary, balances, goals
- Adapt language for user.level

### Step 4: AI Service (`src/services/ai/service.py`)
- Methods: analyze_finances, analyze_portfolio, analyze_ticker, analyze_expenses, model_savings, generate_digest, chat, smart_categorize
- Each: check balance -> build context -> call LLM -> charge -> log -> return

### Step 5: AI Worker (`src/workers/ai_worker.py`)
- arq worker processing AI tasks from Redis
- Task types map to AIService methods

### Step 6: Bot handlers (`src/bot/handlers/ai.py`)
- AI intent detection (keyword matching)
- Cost confirmation before processing
- /digest command
- Register in setup.py

### Step 7: Cron digest job
- Add daily/weekly digest generation to cron_worker.py

### Step 8: Tests (~25 new tests)
- All LLM calls mocked
- Test billing integration, legal prompts, context building, worker

## Cost Table (from spec)

| Query Type | Cost | Model |
|-----------|------|-------|
| analyze_finances | 5₽ | Sonnet |
| analyze_portfolio | 8₽ | Sonnet |
| analyze_ticker | 10₽ | Sonnet |
| analyze_expenses | 5₽ | Sonnet |
| model_savings | 5₽ | Sonnet |
| generate_digest | 12₽ | Sonnet |
| chat | 3₽ | Sonnet |
| smart_categorize | 0₽ | Haiku |

## Legal Constraints

AI system prompt MUST contain restrictions against directive recommendations. See spec section for exact text.
