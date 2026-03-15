---
name: test-llm
description: Run the LLM command parsing test suite against the live LM Studio model
argument-hint: [--filter <pattern>]
---

Run the LLM test suite that validates natural language voice commands are parsed into correct command types.

## Prerequisites

- LM Studio must be running with the configured model loaded
- `.env` must be configured with valid settings

## Running

Run the test suite: `npm run test:llm`

If the user provides a `--filter` argument, run with: `npx tsx --test --test-name-pattern="$ARGUMENTS" tests/llm.test.ts`

This allows filtering to specific test cases, e.g.:
- `/test-llm --filter power` — run only power command tests
- `/test-llm --filter rainbow` — run only the rainbow test
- `/test-llm --filter bedroom` — run all tests mentioning "bedroom"

## Test Coverage

42 test cases across all 7 command types:
- **Power**: on/off with natural phrasing, aliases, device targeting
- **Simple**: color temperature, brightness, RGB colors, combinations
- **Device-specific**: targeting individual devices by name
- **Factory effects**: all named effects with varied phrasing
- **Complex effects**: flash, pulse with timing variations
- **Save/Recall**: saving and naming light states
- **Schedule**: timed commands with day patterns
- **Aliases**: room alias recognition (bed → bedroom, bath → bathroom)

## Interpreting Results

- Tests validate against the Zod schema (parseCommand throws on invalid LLM output)
- `type` and `room` must match exactly
- Brightness and color temperature use range assertions (e.g. "dim" = 15–35%)
- RGB uses tolerance-based matching (±60 per channel)
- Device IDs check inclusion, not exact ordering

## After Failures

If tests fail, review:
1. Is the LLM model loaded and responding? (check LM Studio)
2. Are failures on ambiguous inputs? Consider adjusting the system prompt in `src/services/llm.ts`
3. Are RGB/brightness values slightly outside tolerance? Consider widening the test ranges in `tests/llm.test.ts`
