---
name: feature-kickoff
description: Run a feature from idea to deployed - spec, design, build, test, release - by sequencing the right agents and skills instead of jumping straight to code. Use at the start of any feature big enough that getting it wrong would cost real rework.
---

# Kick off a feature

The most expensive bug is the one designed in before a line of code is written. This skill is the running order that catches those while they are still cheap — it sequences the specialists rather than doing everything itself. Skip stages deliberately for small work; never skip them by accident.

This is the **feature** track. If you are not sure a feature is even the right frame — an idea still being shaped, a bug, an incident, a security review — start at `/start` instead; it triages and routes here when a feature is what you have. `orchestrator` runs the sequence below and keeps the scope line while the specialists work.

## The running order

**1. Spec — what and why.** `/spec` with `product-architect`. The user's problem, who it is for, scope in and *out*, the flows including the unhappy ones, and how you will know it worked. Do not move on while two people could still build two different things.

**2. Architecture — how, technically.** `/architecture` with `product-architect`, once the feature touches more than one screen or the data. The system shape, the pivotal server-vs-client decision, tech choices with reasons, the risks. Data shape to `/data-model` and `db-steward`; API contract to `/api-design` and `api-engineer`.

**3. Design — how it works and looks.** `ux-designer` for the flow and interaction; `/wireframe` with `wireframe-designer` to make it visible and clickable; `/design-system` and `ui-designer` for the visual layer. Settle the flow on a wireframe before anyone writes markup — a redrawn box is cheaper than a rebuilt page.

**4. Test plan — what is worth testing.** `/test-plan` with `test-engineer`, alongside the build, not after it. Decide where the risk is so the tests land there.

**5. Build.** The right engineer for the layer: `frontend-builder`, `api-engineer`, `php-engineer` or `node-passenger-engineer`, `db-steward` for schema. They build against the contracts from steps 2–3, in parallel where the contract lets them.

**6. Verify.** `test-engineer` runs the suite; `deploy-qa` smoke-tests in a real browser; `web-pentester` reviews the security boundaries if the feature touches auth, money or user data.

**7. Release.** `release-manager` and `/cpanel-deploy`: staging first, verify, approval gate, production, health check, rollback command in hand.

## Scale it to the feature

- **A copy change or a styling tweak** — skip to step 5, build and release. The running order is for features, not one-line fixes.
- **A new form or page** — light spec, wireframe, build, test the validation, release.
- **A new capability** (payments, accounts, a booking system) — the whole order, no skipping. This is exactly the case the sequence exists for, and the case where jumping to code costs weeks.

## The judgement this skill encodes

- **Decide before you build.** Each stage's output is the next stage's input. Skipping a stage does not remove its cost — it moves the cost to rework, at a worse time.
- **Parallelise once the contracts exist.** After the API contract and the design tokens are settled, frontend and backend proceed at once. That is the payoff for doing the contracts first.
- **Carry the scope line the spec drew.** When "wouldn't it be nice if…" appears mid-build, it goes back to the spec as a scope decision, not silently into the code.

State which stages you are running and which you are skipping, and why, at the start — so the user can pull one back in if your call was wrong.
