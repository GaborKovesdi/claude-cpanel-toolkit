---
name: site-register
description: Add a new site to this toolkit - gather the cPanel and SSH details, pick a deploy strategy, write the config/sites.json entry, set up the remote directory layout, and prove it works with a preflight. Use when onboarding a site the agents do not know about yet.
---

# Register a site

Onboards one site so every other agent and skill in this toolkit can work with it. Roughly ten minutes, and it ends with a passing preflight — not with a config file you hope is right.

## 1. Gather

Ask for whatever you cannot discover:

- **cPanel**: hostname (often `serverNN.<host>` rather than the site's own domain), username, port (usually 2083)
- **cPanel API token** — created in cPanel under *Security → Manage API Tokens*. Not the account password.
- **SSH**: host, port, user, and which key. Many shared hosts use a non-standard SSH port and require the key to be uploaded through cPanel first.
- **Local repo path** and which subdirectory becomes the docroot (`public`, `dist`, or `.`)
- **The live URL**, and a staging URL if one exists
- **PHP or Node**, and which version

## 2. Choose the deploy strategy

**symlink** if the docroot can be a symlink — that is, the site is an addon domain or subdomain whose docroot you control, e.g. `/home/user/sites/demo/current`. Atomic swaps, instant rollback, release history. Prefer it.

**sync** if the docroot is the primary domain's `public_html`, or a Passenger app root. cPanel recreates `public_html` and will not reliably follow a symlink there.

Test whether symlink is viable before committing to it:

```
cpanel_ssh_exec site=<site> command="ls -ld ~/public_html ~/sites 2>&1"
```

## 3. Write the config entry

Copy the matching block from `config/sites.example.json` into `config/sites.json` (create it if this is the first site — it is gitignored, unlike the example). Fill in real values.

**Secrets never go in this file.** It records only the *name* of the environment variable: `"apiTokenEnv": "CPANEL_TOKEN_DEMO"`. Put the value in `.env` at the toolkit root, which is also gitignored.

Set `requireApproval: true` on every production environment. Set `excludes` so nothing sensitive can ship — at minimum `.git`, `.env`, `node_modules`, `*.log`.

## 4. Create the remote layout

For a symlink environment:

```
cpanel_ssh_exec site=<site> command="mkdir -p ~/sites/demo/releases ~/sites/demo/shared ~/.deploy/backups/demo-prod && ls -ld ~/sites/demo/*"
```

Then point the domain's document root at `~/sites/demo/current` in cPanel (*Domains* for a subdomain or addon domain). The symlink will not exist until the first deploy, so the site 404s until then — expect that, and do the first deploy immediately after.

Put anything that must survive a deploy — `.env`, `uploads/`, `storage/` — in `shared/` and list it in `sharedPaths`.

## 5. Prove it

```
cpanel_list_sites
cpanel_describe_site site=<site>
cpanel_preflight site=<site> environment=staging
```

Every preflight check must pass before you call the site registered. A config that has never been exercised is not a config, it is a guess.

## 6. Give it a test environment — strongly recommended, not optional

A site is not properly registered with production alone. **Every site should have a separate staging/test environment next to production**, so releases are verified somewhere safe before they reach live users — otherwise every deploy is tested in production.

- Register **both** environments. The templates already ship a `staging` block next to `production`; keep it.
- If the site genuinely only has a production environment right now, run `/test-env-setup` to build staging before the first real release, and say plainly why deploying prod-only is a risk.
- The tooling backs this up: `cpanel_list_sites`, `cpanel_preflight` and `cpanel_deploy` warn about a production site with no test environment. If you see that warning after registering, the registration is not finished.

## 7. Hand back

Tell the user: the site key, its environments, the strategy chosen and why, where the secrets live, and the command to deploy it. Confirm a staging environment exists (or is scheduled), then offer the first deploy **to staging**.
