---
name: cpanel-doctor
description: Health check of a whole cPanel hosting account - disk and inode quota, SSL expiry, cron jobs, databases, domains, error logs, and whether every configured site is actually responding. Use for a periodic review, or as the first step when something is vaguely wrong.
---

# cPanel doctor

A full sweep of one hosting account. Read-only. Run it monthly, before a launch, or whenever something is off and you do not yet know what.

## The sweep

Run these and read them together — most real problems only show up as a combination.

```
cpanel_disk_usage      site=<site>
cpanel_domains         site=<site>
cpanel_ssl_status      site=<site>
cpanel_list_cron       site=<site>
cpanel_list_databases  site=<site>
cpanel_error_log       site=<site> lines=60
```

Then health-check every environment of every site on that account (`cpanel_health`), and for symlink environments confirm which release is live (`cpanel_releases`).

## What to flag, and the threshold

| Check | Flag when |
|---|---|
| Disk usage | over 80% — a deploy takes a backup first and needs headroom for both copies |
| **Inodes** | over 80% — the limit people forget; thousands of cache or session files exhaust it long before megabytes run out |
| SSL expiry | under 21 days, or AutoSSL has stopped covering a domain that is still live |
| Cron | jobs referencing paths that no longer exist, jobs printing output on every run (mailing the account into a spam list), jobs nobody recognises |
| Databases | databases with no site using them, or a size that is growing unexpectedly |
| Domains | a domain whose docroot does not exist, or points somewhere unexpected |
| Error log | anything repeating. A single stack trace is noise; the same one every minute is a live bug |
| Health | non-200, slow response, or a redirect chain that should not be there |

## Cross-checks worth doing

- **Every domain has a live docroot, and every docroot has a domain.** Orphans in both directions are how stale copies of a site end up publicly reachable.
- **Unknown cron jobs plus recently modified PHP files** is the classic compromise signature. If both show up, stop the sweep and hand to `hosting-security-auditor`.
- **Old release directories** — if `keepReleases` is not pruning, they are quietly eating disk and inodes.
- **Backups actually exist and are recent.** `cpanel_list_backups` per environment. A backup path that has been empty for months is a rollback that will not work when you need it.

## Report

Traffic-light summary first, then the detail:

```
demousr @ server42                                        3 warnings

  OK    disk        4.2 GB of 20 GB (21%)
  WARN  inodes      182,400 of 200,000 (91%) - old releases and PHP sessions
  OK    ssl         2 certificates, next expiry in 68 days
  WARN  cron        1 job writes output on every run (mails the account hourly)
  OK    databases   2, both in use
  WARN  logs        "PHP Warning: undefined array key" x412 in the last hour
  OK    health      demo.example 200 in 180ms, staging 200 in 210ms
```

Then, for each warning: what it will cause if ignored, and the specific fix. Rank by what breaks something soonest, not by how easy it is to fix.
