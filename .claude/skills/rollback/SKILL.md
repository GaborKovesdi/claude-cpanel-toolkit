---
name: rollback
description: Put the previous version of a site back immediately - symlink repoint or backup restore, then verify. Use when a deploy broke something, when a site is down after a change, or when someone says "undo that".
---

# Rollback

Restore the last known-good state. This is an emergency procedure: act first, understand later.

## Do this now

```
cpanel_rollback site=<site> environment=<env> confirm=true
```

With no `to` argument it goes back exactly one step. That is almost always what you want.

**Do not investigate first.** Do not try a fix-forward because the bug looks like a one-liner. Restore the site, then debug against a site that is up.

## Say what you are doing while you do it

Tell the user you are rolling back, before the result comes back. In an outage, silence reads as nothing happening.

## Then verify

The result carries a health check. If it is still failing after the rollback, the cause was not the release, and you have a different problem:

- Check `cpanel_disk_usage` — a full account breaks everything and no rollback fixes it.
- Check `cpanel_error_log` for what is actually failing.
- Check whether other sites on the same account are affected. If they are, it is server-level.
- Hand to the `incident-responder` agent.

## Picking a specific target

```
cpanel_releases site=<site> environment=<env>
```

lists the releases on the server and marks the live one. To go back further, pass `to=<release id>`. For a `sync` environment, `cpanel_list_backups` lists the tarballs and `to=<filename>` picks one.

Going back more than one release is a real decision — say what will be lost and confirm before doing it.

## What rollback does not undo

- **Database migrations.** Code rolls back; schema does not. If the release included a migration, old code may now be running against a new schema. Get `db-steward` involved immediately and say this out loud — it is the most common way a rollback makes things worse rather than better.
- **Files written by the application** since the deploy: uploads, generated caches, logs. Anything under `sharedPaths` is deliberately shared across releases and is *not* reverted.
- **Anything changed outside a release** — a hand-edit on the server, a cPanel setting, a DNS change.
- **Emails already sent, payments already taken.**

## Afterwards

Once the site is up, write down: what broke, what the rollback restored, and whether the cause is fixed or merely bypassed. Then fix it properly and ship it through a normal release. A rolled-back release that gets silently re-deployed the next day is how the same outage happens twice.
