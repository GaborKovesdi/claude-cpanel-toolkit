---
name: test-plan
description: Decide what to test and what not to, at which level, before writing tests - so effort lands on the risky code and skips the trivial. Use for anything non-trivial, and when a bug should be pinned so it never returns.
---

# Write a test plan

A test plan decides where the testing effort goes *before* it is spent, so it lands on the code where a bug would hurt and skips the code where a test only restates the obvious. It is short — a page, often a few lines — and it saves you from both under-testing the dangerous parts and drowning the trivial ones in ceremony.

## 1. Rank by what a bug would cost

Not by what is easy to test. List the areas of the change and sort them:

- **High** — money, data loss, auth/permission boundaries, anything irreversible. Thorough tests, edges included.
- **Medium** — core features that would embarrass but not endanger. Cover the main paths and the obvious edges.
- **Low / none** — static content, thin glue, code with no branches. A test here mostly restates the code; skip it and say so.

The plan's job is to make the high row unmissable.

## 2. Assign each to a level

- **Unit** — branching logic in isolation: calculations, validation, parsing, state transitions. Fast, no I/O. Most of the tests.
- **Integration** — the seams: code + database, code + the real query. Where the bugs that unit tests mock away actually live; on a data-driven site these catch the most real bugs. Do not skip them.
- **End-to-end** — a few critical journeys through `deploy-qa` and Playwright against a deployed environment. Expensive, so reserve for "must never break": login, and the one task the site exists for.

## 3. Name the cases that matter

For each high/medium area, list the specific cases — the plan is where you think of them, the tests are where you write them:

- boundaries: empty, one, many, too many; zero, negative, max; null, missing, wrong type
- the nasty inputs: the apostrophe in O'Brien, unicode, the 400-character string, the duplicate submit
- the failure paths: the third party is down, the payment declines, the session expired mid-task
- the regression: if this pins a known bug, the case that fails on the old code

## 4. Say what you are NOT testing, and why

The most useful line in the plan. "Not unit-testing the template rendering — no logic in it." "Not e2e-testing the admin export — covered at integration level, journey is low-traffic." This stops both the guilt-driven over-testing and the silent gap.

## 5. Note what cannot be tested automatically

A third-party integration, an email actually arriving, a hardware dependency — say so, and describe the manual check instead. A hollow test that mocks the untestable thing and asserts the mock is worse than an honest "verify by hand: X".

## Run it on this stack

- Match the project's framework — PHPUnit, or node:test / Vitest / Jest. Read a neighbouring test and follow its shape.
- Tests run locally and in CI, against a separate disposable test database — **never production**. Need realistic data? A scrubbed copy via `db-sync`.
- Wire a failing test to block the release. A green suite is part of what `release-manager` confirms at preflight; a suite that does not gate the deploy is decoration.

Hand the plan and the tests to `test-engineer` to build and maintain. Keep the plan in the repo next to the tests, so the "why we don't test X" reasoning survives.
