---
name: db-sync
description: Dump, restore and move MySQL data between local, staging and production on cPanel - with a backup taken first and production data scrubbed before it lands anywhere less protected. Use for database copies, refreshes and restores.
---

# Database sync

Moving data between environments. The dangerous direction is obvious; the subtle risk is copying real customer data into an environment with weaker access control.

## Always, before anything else

**Dump the destination.** Not the source — the destination, the one you are about to overwrite. State the dump path in your message before you run the import.

```
mysqldump --defaults-extra-file=~/.my.cnf --single-transaction --routines --triggers DB \
  > ~/.deploy/backups/DB-$(date -u +%Y%m%dT%H%M%SZ).sql
```

Run it through `cpanel_ssh_exec`. **Never put the password on the command line** — it lands in shell history and in this transcript. Use `~/.my.cnf` with `0600` permissions on the account, or `--defaults-extra-file`.

## Production to staging (the routine direction)

1. Dump production.
2. Dump staging (the destination — see above).
3. Import into staging.
4. **Scrub, in the same session, before you tell anyone it is ready.** At minimum: replace real email addresses, blank phone numbers and postal addresses, invalidate password hashes, remove payment references and API tokens, and clear any queued outbound email. Write the scrub as a `.sql` file committed to the repo so the next refresh runs the same one.
5. Verify: row counts per table against production, and confirm the scrub actually changed what it was supposed to.

Say explicitly what you scrubbed. "Anonymised" without a list is not something anyone can rely on.

## Staging to production

Almost never correct. If someone asks for it, confirm they understand that production rows written since the staging copy will be lost, and get an explicit yes. Then dump production twice: once before, once again immediately before the import.

## Restoring

Do not `DROP DATABASE` and import over the top. Instead:

1. Import the dump into a **new** database (`user_restore20260905`).
2. Verify row counts and spot-check the newest records to confirm the dump is not truncated. A dump that failed halfway is still a valid-looking `.sql` file.
3. Point the application's config at the restored database, or rename.

That way a bad dump costs nothing.

## cPanel specifics

- Database and user names carry the account prefix and are length-limited: `demousr_app`, not `app`. Create them via `cpanel_uapi module=Mysql` so the prefix is handled.
- `phpMyAdmin` times out on anything but small imports. Over a few MB, go through SSH.
- Remote MySQL is disabled by default and needs your IP allowlisted. Prefer an SSH tunnel to opening it.
- Large imports on shared hosting can exceed CPU or time limits and stop partway. Check the final row counts rather than assuming success from a clean exit.

## Migrations

Schema changes belong in numbered migration files in the repo, not in an ad-hoc dump-and-restore. Get the `db-steward` agent involved for anything that changes structure, and remember that a code rollback does not roll the schema back with it.
