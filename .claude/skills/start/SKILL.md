---
name: start
description: The front door for this toolkit. Run it at the beginning of any work - it reads the request, checks the toolkit is set up, works out what kind of job this is, and routes to the right agents and skills. Use when you are not sure where to begin, or as the default first command in a session.
---

# Start here

The single entry point. Point it at whatever you want to do — "build a booking form", "the site is down", "is this secure", "deploy to production", "I have an idea for an app" — and it works out what that means and who should do it. Under the hood it adopts the `orchestrator` role; you do not need to know the roster, that is its job.

## 1. Is the toolkit ready?

On the first run in an environment, confirm the setup before routing anywhere that touches a server. Cheap to check, saves a confusing failure later:

```
cpanel_list_sites
```

- **Error about missing config** → the toolkit is not set up. The fastest fix is `node bin/wizard.mjs` from the toolkit root — it installs the dependency, generates the shared SSH key, walks through the one manual cPanel click (importing/authorizing the key — not scriptable, see `/ssh-key-setup`), saves the connection details, and scaffolds the first project in one guided run. Do this before anything that deploys.
- **Lists sites** → ready. Carry on.
- Pure design, spec or planning work needs no server and can start immediately regardless.

## 2. What kind of work is this?

Read the request and classify it. If it is ambiguous, ask the one or two questions that decide the track — not a questionnaire.

| The user says… | Track | Front line |
|---|---|---|
| an idea, "I want to build…", something new and fuzzy | **shape it** | `/spec` + `product-architect` |
| "add / build / create [a feature]" | **feature** | `/feature-kickoff` |
| "new site / project from scratch" | **new project** | `bin/new-project.mjs` → `/site-register` → `/test-env-setup` |
| "this is a Claude Code Cloud session" / no local toolkit clone visible | **new project (cloud)** | same, but scaffold with `--standalone` — it vendors the MCP server into the project with a relative path instead of an absolute one back to a toolkit clone that will not exist in the cloud container |
| "design / how should this look or work" | **design** | `ux-designer` → `/wireframe` → `ui-designer` / `/design-system` |
| "it's broken / down / throwing errors **now**" | **incident** | `incident-responder` — drop everything else |
| "deploy / ship / release / roll it back" | **release** | `release-manager` + `/cpanel-deploy` or `/rollback` |
| "is it secure / test security / audit / pentest" | **security** | `/threat-model` (design time) or `/pentest` + `hosting-security-auditor` |
| "slow / schema / migration / move data" | **data** | `db-steward` + `/data-model` or `/db-sync` |
| "domain / DNS / cron / SSL / quota / mailbox" | **ops** | `cpanel-ops` + `/cpanel-doctor` |
| a one-line fix, a typo, an obvious small task | **just do it** | handle directly — no machinery |

## 3. Propose the plan, then go

For anything beyond a small task, **say the plan in a few lines before executing it** — the track, the running order, who does each step, and what (if anything) needs a decision from the user first. This is the cheapest moment to correct a wrong turn.

For a build, the order is: decide (`/spec`, `/architecture`) → contracts (`/data-model`, `/api-design`, `/design-system`) → experience (`ux-designer`, `/wireframe`) → build (the layer's engineer) → verify (`test-engineer`, `deploy-qa`, `web-pentester`) → release (`release-manager`). Scale it down for small work; state what you are skipping and why.

Then hand off to `orchestrator` to run it — it sequences the specialists, keeps the scope line, guards the human-decision points (production deploys, anything destructive), and reports back with what is done, what is blocked, and what needs you.

## The judgement this encodes

- **Match the machinery to the job.** A typo does not get a six-agent pipeline; a payment system does not get jumped straight into code.
- **Restore before you diagnose** when something is down — the incident track pre-empts everything.
- **Check setup before you deploy**, not after the deploy fails.
- **Decide before you build.** The plan is cheap to change now and expensive to change at the release stage.
