---
name: architecture
description: Design and record the system architecture for a build - the pieces, how a request flows through them, the technology choices with their reasons, and the risks. Produces a decision record (ADR-style) the team can point at later. Use after the spec, before the code.
---

# Design the architecture

Turns a spec into the technical decisions that let people build the right thing once. The output is a document someone can read in six months and understand *why*, not just *what* — because the "why" is what stops the next person undoing a decision that had a reason.

## Decide these, in this order

**1. The shape.** The pieces and how a request flows through them. Draw it — a boxes-and-arrows sketch or a mermaid diagram beats three paragraphs. On this stack the pivotal choice is usually:

- **Server-rendered** (PHP or Node templates) — simplest to build, deploy and secure on shared hosting; the default, and correct more often than people admit.
- **SPA + API** — worth it when the interaction is genuinely app-like (live updates, complex client state); costs you a build step, a second thing to deploy, SEO work, and a larger security surface.

Pick one and write the reason. This decision colours everything downstream.

**2. The data.** The entities and their relationships — the shape, not the DDL. Hand the schema and migration path to `db-steward`. Where the data lives is mostly decided for you (the account's shared MySQL); if the design wants anything else, that is a flag, because you cannot run it on this hosting.

**3. The technology choices.** For each significant one, write three things: the choice, the reason, and the cost. "Vanilla PHP, because it deploys as files and the team knows it, at the cost of writing more boilerplate" is a real decision. Match the existing stack unless there is a decision-changing reason not to — novelty is not one.

**4. The cross-cutting concerns.** Auth (how identity and permission work), sessions/state, error handling and logging, background work (a cron job on this hosting — say which), caching, and file/upload handling. These are the things that are painful to add later, so decide them now even if briefly.

**5. The risks.** The two or three things most likely to go wrong and what each would cost. Data-loss and security-boundary risks rank first. For each, either a mitigation or an explicit "accepted, because".

## Ground it in the real hosting

Say it plainly in the document, because generic architecture assumes infrastructure this estate does not have:

- No container orchestration, no message broker you operate, no worker fleet. Async is cron. Scaling up is a bigger plan or a VPS, and that migration is a real fork — name the point at which the design would hit it.
- One shared MySQL, shared CPU and memory with every other site on the account.
- Capability you cannot host comes from third-party services, each a dependency and a failure mode — list them.

An architecture that cannot be deployed on the hosting the user has is not a design, it is a wish.

## Record it as a decision, not a description

Write it as a short ADR (Architecture Decision Record) per significant choice, or one document for a small build:

```markdown
# ADR: server-rendered PHP, not a SPA

## Context
Small brochure-plus-booking site on shared cPanel hosting. One developer. SEO matters.

## Decision
Server-rendered PHP templates. The booking form enhances progressively with a little JS.

## Consequences
+ Deploys as files, works without a build step, indexes cleanly, small attack surface.
- Any richly interactive feature later means adding JS piecemeal or reconsidering this.
```

Keep it in the repo next to the code. Then hand the contract work out: API to `api-engineer`, schema to `db-steward`, screens to `ux-designer`/`ui-designer`, deployment to `release-manager`, and get `web-pentester` to sanity-check the security boundaries while they are still cheap to move.
