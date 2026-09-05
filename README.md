# cPanel agentic development toolkit

A reusable kit for designing, building, securing and releasing web applications on cPanel shared hosting with Claude Code: **17 agents**, **22 skills**, and a **custom cPanel MCP server** that wraps cPanel's UAPI and SSH into typed tools.

It covers the whole path — spec and architecture, UX and visual design, frontend and backend build, testing, security testing, and the release train — for the common shape of this work: several PHP sites and Node apps on one hosting account, deployed over SSH, with one SSH key and one API token shared across all of them.

**Start here:** run `/start` and describe what you want to do. It checks the toolkit is set up, works out what kind of job it is, and routes to the right agents and skills — coordinated by the `orchestrator` agent. You never have to know the roster below; `/start` does.

> ### Strongly recommended: a test environment alongside every production site
>
> Every site should have a **separate staging/test environment next to production**, so releases are verified somewhere safe before they reach live users. Without one, every deploy is tested in production.
>
> This is baked in, not just advised:
> - the project templates ship **with a `staging` environment already defined** next to `production`
> - `/site-register` and `/start` treat setting up staging as a default step, and `/test-env-setup` builds one from nothing
> - the tooling **warns you** — `cpanel_list_sites`, `cpanel_preflight` and `cpanel_deploy` all flag a production site that has no test environment
> - `release-manager` deploys to staging first and will not treat production as routine without one
>
> Keep the `staging` block in your `cpanel.site.json`. Removing it is what the warnings are there to catch.

```
agents/
├─ .claude/
│  ├─ agents/           17 subagent definitions
│  └─ skills/           22 skills (slash commands)
├─ mcp-servers/
│  └─ cpanel-mcp/        the MCP server + a CLI over the same tools
├─ templates/
│  ├─ php-site/          project template - PHP site
│  └─ node-app/          project template - Passenger Node app
├─ config/
│  ├─ sites.json         YOUR config (gitignored, no secrets)
│  ├─ sites.starter.json the CHANGEME starting point sites.json is created from
│  └─ sites.example.json a worked, fully-illustrated example (reference only)
├─ bin/
│  ├─ wizard.mjs         interactive terminal setup, start to first project
│  ├─ wizard-gui.mjs      the same, as a local web form
│  ├─ new-project.mjs    scaffold a project wired to this toolkit
│  └─ setup.mjs          the non-interactive building block the wizards call
├─ .mcp.json             cpanel + playwright + github MCP servers
└─ .env                  the only place secrets live (gitignored)
```

## Install from GitHub

Clone the toolkit once, then use it to scaffold as many projects as you like.

```bash
git clone https://github.com/GaborKovesdi/claude-cpanel-toolkit.git
cd claude-cpanel-toolkit
node bin/wizard.mjs
```

`bin/wizard.mjs` is the fastest path from a bare clone to a working, preflight-verified project: it installs the dependency, generates the shared SSH deploy key, walks you through the one manual click cPanel requires (see below), saves your connection details, and scaffolds your first project — all in one guided run. Safe to re-run: it reuses anything you already filled in rather than asking again.

Prefer clicking through a form over typing terminal answers? Run `node bin/wizard-gui.mjs` instead — same steps, same automation, as a small local web page it opens for you (bound to `127.0.0.1` only, protected by a random per-run token, never reachable from your network). Nothing about what it does differs from the terminal version; it just replaces typed prompts with fields, dropdowns and a copy button on the SSH key.

Both automate everything except one step, deliberately: **authorizing the SSH key in cPanel**. cPanel's key import/authorize calls only exist in its legacy "API 2" interface — the official docs say plainly that no UAPI equivalent exists — so scripting against that older, less-verified surface to change what can log into your account is exactly the kind of shortcut this toolkit's own agents are written to refuse. The wizard generates the key, shows you the public half, and waits for you to import and authorize it in the cPanel UI (Security → SSH Access → Manage SSH Keys), then verifies the result itself before continuing.

Prefer the manual route, or want to understand each piece first? It's below.

```bash
node bin/setup.mjs          # installs deps, creates config/sites.json and .env from the examples
```

Keep it at a stable path on your machine (e.g. `C:/xprojects/toolkit`) — scaffolded projects point back to its MCP server by path.

**Two ways to use it in a project:**

- **Scaffold a fresh project** (recommended) — `node bin/new-project.mjs …` creates a new project pre-wired with all agents, skills and an `.mcp.json` that points at this toolkit. See "Starting a project" below.
- **Add it to an existing project** — copy the toolkit's `.claude/` folder (agents + skills) into your project, copy `.mcp.json`, and edit the `cpanel` server path to point at where you cloned the toolkit. Add a `cpanel.site.json` describing the site (copy from `templates/php-site/`).

Requires Node 20+, and `git` / `ssh` / `tar` on the PATH (all standard on macOS/Linux and on Windows with Git for Windows).

## Setup, once

`node bin/setup.mjs` does steps 1–2 for you. To do them by hand:

**1. Install the MCP server's dependency**

```bash
cd mcp-servers/cpanel-mcp && npm install
```

**2. Create the shared SSH key and authorise it**

Run the `/ssh-key-setup` skill, or by hand:

```bash
ssh-keygen -t ed25519 -a 100 -f ~/.ssh/id_ed25519_cpanel -N "" -C "claude-toolkit"
```

No passphrase, deliberately — this toolkit's SSH calls run with `BatchMode=yes` for unattended deploys, which cannot answer a passphrase prompt. Treat it as a single-purpose deploy key, never your personal login key (see `/ssh-key-setup` for the full reasoning and the passphrase+agent alternative).

Import the **public** key in cPanel under *Security → SSH Access → Manage SSH Keys*, then click **Manage → Authorize**. An imported key that has not been authorised looks correct and does not work — that is the single most common failure. This step is manual by design: cPanel's key import/authorize calls only exist in its legacy API 2 interface, which the official docs say has no UAPI equivalent, so this toolkit does not script against it.

**3. Create the cPanel API token**

cPanel → *Security → Manage API Tokens*. Put the value in `.env` (copy `.env.example`):

```
CPANEL_TOKEN_MAIN=xxxxxxxxxxxx
```

**4. Fill in the three `CHANGEME` values in `config/sites.json`**

```json
"defaults": {
  "ssh":    { "host": "server42.host.hu", "user": "myacct", "identityFile": "~/.ssh/id_ed25519_cpanel" },
  "cpanel": { "host": "server42.host.hu", "user": "myacct", "apiTokenEnv": "CPANEL_TOKEN_MAIN" }
}
```

Every site inherits these field by field, so no project ever repeats the key or the account.

**5. Verify**

```bash
node mcp-servers/cpanel-mcp/bin/cpanelctl.mjs cpanel_list_sites
```

## Starting a project

```bash
node bin/new-project.mjs --template php-site --dir C:/xprojects/acme \
     --key acme --label "Acme Kft" --domain acme.hu
```

The new project gets the template files with placeholders filled in, copies of all agents and skills, a `.mcp.json` pointing back at this toolkit's MCP server, and a `cpanel.site.json` describing only itself — **the SSH key and cPanel account are inherited, never copied**. Open the project in Claude Code and everything works there.

To wire up an **existing** project instead, copy `templates/php-site/cpanel.site.json` into it, edit the paths, and copy `.claude/` and `.mcp.json` across.

## Using this in Claude Code Cloud (claude.ai/code)

The default scaffold above links back to this toolkit's MCP server **by absolute path** — fine on one machine managing several client sites, but a cloud session starts from a fresh, isolated container holding only what the project's own repo committed. That absolute path will not resolve there.

Pass `--standalone` and the project vendors its own copy of the MCP server instead:

```bash
node bin/new-project.mjs --template php-site --dir C:/xprojects/acme \
     --key acme --domain acme.hu --standalone
```

This copies `mcp-servers/cpanel-mcp/` into the project, runs `npm install` inside it, writes `.mcp.json` with a **relative** path, and inlines the `ssh`/`cpanel` connection block directly into the project's own `cpanel.site.json` (no external toolkit config to inherit from once it stands alone). `git init`, commit, push to its own repo, and it opens correctly anywhere — a teammate's machine or a Claude Code Cloud session — without this toolkit being present there too.

**The private key and the API token still never get committed** — that part does not change, and it cannot: they are secrets, not config. Whatever environment opens the project (cloud included) needs them provisioned fresh:

- `.env` with the cPanel API token (copy `.env.example`)
- the private SSH key at the path `cpanel.site.json`'s `ssh.identityFile` names

A cloud sandbox's network policy may also restrict outbound SSH to an arbitrary host on a non-standard port — that is out of this toolkit's control. Test it early and cheaply once a session starts:

```
cpanel_ssh_exec site=acme command="echo ok"
```

If that fails in the cloud but works locally, use the cloud session for design, build and test work, and run the actual deploys (`cpanel_deploy`, `cpanel_rollback`) from a session that has real network access to the host.

## Config model

Two files, merged:

| File | Holds | Committed? |
|---|---|---|
| `config/sites.json` (toolkit) | `defaults` — the shared SSH key, cPanel account, excludes — and any sites you keep centrally | no |
| `cpanel.site.json` (project) | one site: its paths, environments, runtime | yes |
| `.env` (toolkit) | every secret value | no |

Secrets are never in either JSON file. The config records the *name* of an environment variable (`"apiTokenEnv": "CPANEL_TOKEN_MAIN"`); the value lives in `.env`.

## Deploy strategies

**`symlink`** — files go to `releases/<timestamp>-<sha>/`, shared paths are linked in, then `current` is swapped atomically. Visitors never see a half-uploaded site, rollback is instant, and old releases are pruned. Use it wherever the docroot can be a symlink (addon domains, subdomains).

**`sync`** — files are extracted straight into the docroot and anything no longer in the source is removed (tracked via a `.deploy-manifest`). Rollback restores the pre-deploy backup. Use it for the primary domain's `public_html`, which cPanel will not reliably let you symlink, and for Passenger app roots.

Both take a backup before touching anything.

## Agents

**Coordination**
| Agent | Owns |
|---|---|
| `orchestrator` | triages a request, sequences the specialists, holds the scope line, reports back |

**Design & planning**
| Agent | Owns |
|---|---|
| `product-architect` | idea → buildable: problem, scope, data model, system shape, tech choices |
| `ux-designer` | user flows, information architecture, forms, interaction, interface copy |
| `wireframe-designer` | low- and mid-fi wireframes and clickable screen mockups |
| `ui-designer` | visual design, the design system, type/colour/spacing, design tokens |

**Development**
| Agent | Owns |
|---|---|
| `frontend-builder` | HTML/CSS/JS, assets, caching, accessibility |
| `api-engineer` | HTTP API contracts, auth, validation, webhooks, integrations |
| `php-engineer` | custom PHP, `.htaccess`, Composer, PHP version reality |
| `node-passenger-engineer` | cPanel Node apps, nodevenv, restarts, the 503 |
| `db-steward` | MySQL, migrations, dumps, restores, staging data scrubbing |
| `test-engineer` | test strategy and tests — unit, integration, e2e |

**Security**
| Agent | Owns |
|---|---|
| `web-pentester` | authorized offensive testing — find and safely prove exploitable bugs |
| `hosting-security-auditor` | defensive posture: exposed secrets, permissions, headers, compromise triage |

**Release & operations**
| Agent | Owns |
|---|---|
| `release-manager` | the release train, approval gates, the rollback call |
| `deploy-qa` | real-browser smoke tests via Playwright |
| `incident-responder` | site down right now — restore first, diagnose second |
| `cpanel-ops` | domains, DNS, cron, SSL, quota, account-level everything |

## Skills

**Start** — `/start` (the front door: triage any request and route it)

**Design & planning** — `/spec` (product/feature spec) · `/architecture` (ADR-style system design) · `/data-model` (schema + migration path) · `/wireframe` (wireframes & mockups) · `/design-system` (tokens & visual system) · `/feature-kickoff` (sequence the whole feature)

**Development** — `/api-design` (API contract as a document) · `/test-plan` (what to test, and what not to)

**Security** — `/threat-model` (STRIDE, at design time) · `/pentest` (authorized web app pentest) · `/dependency-audit` (reachable vulnerabilities only)

**Release & operations** — `/preflight` (can this deploy right now?) · `/cpanel-deploy` (full deploy path) · `/rollback` (previous version back, now) · `/release-cut` (semver, changelog, tag) · `/smoke-test` (browser verification) · `/db-sync` (dumps, restores, scrubbed prod→staging) · `/site-register` (onboard a site) · `/cpanel-doctor` (account health sweep) · `/ssh-key-setup` (the one shared key) · `/test-env-setup` (staging from nothing)

## MCP servers

`.mcp.json` wires up three:

- **cpanel** — this toolkit's server, 22 tools (see below)
- **playwright** — real browser for `deploy-qa`
- **github** — the hosted GitHub MCP server; authenticate with `/mcp` inside Claude Code

The cPanel server's tools: `cpanel_list_sites`, `cpanel_describe_site`, `cpanel_preflight`, `cpanel_deploy`, `cpanel_rollback`, `cpanel_releases`, `cpanel_backup`, `cpanel_list_backups`, `cpanel_health`, `cpanel_error_log`, `cpanel_ssh_exec`, `cpanel_list_files`, `cpanel_read_file`, `cpanel_uapi`, `cpanel_domains`, `cpanel_disk_usage`, `cpanel_list_databases`, `cpanel_list_cron`, `cpanel_add_cron`, `cpanel_ssl_status`, `cpanel_node_restart`, `cpanel_node_install`.

Every one of them is also a CLI subcommand:

```bash
node mcp-servers/cpanel-mcp/bin/cpanelctl.mjs --help
node mcp-servers/cpanel-mcp/bin/cpanelctl.mjs cpanel_preflight site=acme environment=staging
```

## Safety

- Deploys back up first; `skipBackup` exists but the agents are told never to use it on a real environment.
- Production environments carry `requireApproval: true` and refuse to deploy without an explicit `confirm: true`.
- `cpanel_ssh_exec` refuses obviously destructive commands (`rm -rf`, `mkfs`, `curl | sh`, `reboot`, `DROP DATABASE`).
- Tokens are stripped from all tool output and error messages before they reach the transcript.
- `.gitignore` excludes `.env`, `config/sites.json` and any private key.
