---
name: test-env-setup
description: Build a staging/test environment for a site on cPanel from nothing - subdomain, docroot, database, .env, search-engine blocking, access protection, first deploy and verification. Use when a site has no staging environment, or when the existing one has drifted from production.
---

# Set up the test environment

A staging environment nobody trusts is worse than none, because people stop testing on it and start testing in production. So the goal is not "a copy of the site somewhere" — it is an environment that fails the same way production would.

Work in this order. Steps 1-3 are the ones people skip and regret.

## 1. Decide what staging means for this site

Answer these before creating anything, and write the answers into the config:

- **Same hosting account, or separate?** Same account is normal for small sites and is what this toolkit assumes. Accept the consequence: staging and production share a disk quota, a MySQL server and a CPU limit. A runaway import on staging can take production down with it.
- **Same PHP/Node version as production?** It must be. A staging environment on a different runtime tests the wrong thing. Check with `cpanel_preflight` against both and compare.
- **Real data, or fixtures?** A scrubbed production copy catches far more bugs than fixtures. Whichever you pick, say which, because it changes what staging can prove.

## 2. Create the subdomain and docroot

In cPanel: **Domains → Create A New Domain**, e.g. `staging.example.com`, with document root `/home/<user>/staging.example.com`. Untick "share document root".

Or check what already exists first:

```
cpanel_domains site=<site>
cpanel_ssh_exec site=<site> command="ls -ld ~/staging.* ~/sites/* 2>&1"
```

Then create the directories the deploy expects:

```
cpanel_ssh_exec site=<site> command="mkdir -p ~/staging.example.com ~/.deploy/backups/<key>-staging && ls -ld ~/staging.example.com"
```

Use **`sync` strategy for staging** even when production uses `symlink`. Staging benefits from being simple; you rarely roll staging back, and the pre-deploy backup is enough.

Wait for AutoSSL to issue a certificate for the subdomain before testing anything HTTPS-dependent. It can take up to an hour, and until then the browser warning will mask real problems.

## 3. Keep it out of the index and out of public hands

Both of these, not one:

- **`robots.txt`** on staging with `Disallow: /` — put it in the repo under a staging-only path or generate it at deploy time.
- **HTTP basic auth** on the whole staging subdomain (cPanel: *Directory Privacy*). Robots directives are advisory; basic auth is not. This also keeps half-finished work away from a client who bookmarked the URL.

Add `X-Robots-Tag: noindex` in the staging `.htaccess` as well. A staging site that gets indexed competes with production for the same search terms and takes weeks to undo.

If staging is protected, tell the `deploy-qa` agent the credentials or it will report every page as a 401.

## 4. Database

Never point staging at the production database. Create a separate one:

```
cpanel_uapi site=<site> module=Mysql func=create_database params={"name":"<user>_app_stg"}
cpanel_uapi site=<site> module=Mysql func=create_user params={"name":"<user>_app_stg","password":"<generated>"}
cpanel_uapi site=<site> module=Mysql func=set_privileges_on_database params={"user":"<user>_app_stg","database":"<user>_app_stg","privileges":"ALL PRIVILEGES"}
```

cPanel prefixes and truncates these names — use what the API returns, not what you asked for.

Then populate it with the `db-sync` skill: dump production, import to staging, **scrub in the same session**. Real customer email addresses in a basic-auth-protected staging database are still real customer email addresses.

Record the staging credentials under the site's `database.staging` block in the config, with the password in `.env` under its own variable name.

## 5. Environment file

Staging needs its own `.env` with `APP_ENV=staging`, the staging database, and — the important part — **outbound integrations pointed somewhere harmless**:

- Mail to a catch-all or a mail-trap, never to real recipients. A staging cron that emails every customer is a genuine incident.
- Payment providers in sandbox mode.
- Webhooks pointed at a test endpoint.
- Any SMS/push provider stubbed out.

Put the file in the shared directory so deploys do not overwrite it:

```
cpanel_ssh_exec site=<site> command="mkdir -p ~/staging-shared && ls -l ~/staging-shared"
```

## 6. Register the environment

Add the `staging` block to the site's `cpanel.site.json` (or `config/sites.json`) — `url`, `strategy: "sync"`, `docroot`, `backups`, `source`, `healthPath`. Do **not** set `requireApproval` on staging; the whole point is that deploying there is cheap.

## 7. First deploy and proof

```
cpanel_preflight site=<site> environment=staging
cpanel_deploy    site=<site> environment=staging note="staging bootstrap"
cpanel_health    site=<site> environment=staging
```

Then a real browser pass with the `deploy-qa` agent. Staging is not set up until a full smoke test has passed on it once — until then you have a directory, not an environment.

## 8. Write down how it differs from production

Every staging environment differs somehow. Record the differences in the project README, because the unrecorded ones are exactly where "it worked on staging" comes from:

```markdown
## Staging differs from production

- basic auth on the whole subdomain
- mail goes to the trap, never to real addresses
- payments in sandbox mode
- database is a scrubbed copy, refreshed manually
- same PHP version and same hosting account as production
```

## Keeping it honest

Staging drifts. Refresh the database periodically with `db-sync`, redeploy production's current release to staging after any manual change, and if you ever hand-edit a file on staging, treat it as a bug in your process and re-deploy over it.
