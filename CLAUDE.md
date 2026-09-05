# Working in this toolkit

This repository is a **reusable kit**, not a website. Nothing here is deployed. It contains the agents, skills and MCP server used to develop and release the actual sites, which live in their own repositories.

## Layout

- `.claude/agents/` — 9 subagent definitions. One concern each.
- `.claude/skills/` — 10 skills, one directory each with a `SKILL.md`.
- `mcp-servers/cpanel-mcp/` — the cPanel MCP server. `src/tools.mjs` is the single tool registry; `src/server.mjs` (MCP over stdio) and `bin/cpanelctl.mjs` (CLI) are both thin frontends over it.
- `templates/` — project templates consumed by `bin/new-project.mjs`.
- `config/sites.json` — local, gitignored, holds no secret values.

## Rules that matter here

**Never commit a secret.** Config files record the *name* of an environment variable, never its value. If you are about to write a token, password or private key into any file except `.env`, stop.

**One SSH key for the estate.** It is declared once under `defaults.ssh` in `config/sites.json` and inherited by every site. Adding a per-project key to work around a problem hides the problem. Fix it in the one place.

**A test environment alongside every production site is a toolkit principle.** Templates ship with a `staging` environment next to `production`; do not remove it, and keep the warnings in `preflight`/`deploy`/`list_sites` that flag a production site with no test environment (`isProductionLike` / `testEnvironmentStatus` in `deploy.mjs`). Releases get verified on staging before they reach live users.

**Add a tool in one place.** New cPanel capability goes into the `TOOLS` array in `src/tools.mjs` with a JSON Schema and a handler. Both frontends pick it up automatically — do not add anything to `server.mjs` or `cpanelctl.mjs`. Mark anything that writes to a live server with `destructive: true` and require a `confirm` argument.

**No dependencies in the MCP server beyond the SDK.** It uses `node:https`, `node:child_process` and the system `ssh`/`tar`. That is deliberate: this thing has to keep working on a machine that has not been touched in a year.

**`rsync` is not available on this machine.** Uploads stream `tar czf - | ssh 'tar xzf -'`. Do not write code that assumes rsync.

## Testing changes

```bash
cd mcp-servers/cpanel-mcp
node --check src/server.mjs
node bin/cpanelctl.mjs --help

# End to end, against a scratch project:
node ../../bin/new-project.mjs --template php-site --dir /tmp/probe --key probe
cd /tmp/probe && node <toolkit>/mcp-servers/cpanel-mcp/bin/cpanelctl.mjs cpanel_list_sites
```

Anything that talks to a real host needs a real host. Do not fake a passing preflight.

## Writing agents and skills

Frontmatter `name` must match the filename (agents) or the directory name (skills). The `description` is what Claude reads when deciding whether to use it, so it should say **when to use this**, not what it philosophically is.

Bodies are instructions to a capable colleague, not documentation. Prefer the specific failure mode over the general principle: "an imported cPanel SSH key that has not been authorised looks correct and does not work" earns its space; "follow security best practices" does not.

Keep each agent to one concern. When two agents start needing the same paragraph, that paragraph probably belongs in a skill they both reference.
