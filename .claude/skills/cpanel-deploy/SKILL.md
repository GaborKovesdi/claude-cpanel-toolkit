---
name: cpanel-deploy
description: Deploy a site to a cPanel environment end to end - preflight, backup, upload, activate, restart, verify, and report the rollback command. Use whenever someone wants to push changes to staging or production on cPanel hosting.
---

# Deploy to cPanel

The full path from local files to a verified live site. Follow it in order; each step exists because skipping it has cost someone a site.

## 1. Establish the target

`cpanel_list_sites` if the site is not obvious from the conversation. Confirm site **and** environment explicitly before touching anything. "Deploy the site" is not a target — "deploy demo-php to staging" is.

## 2. Preflight

`cpanel_preflight site=<site> environment=<env>`. Every check passes, or you stop and report. Do not deploy through a failed check because it "looks unrelated".

## 3. Show what will ship

State: strategy (`symlink` or `sync`), target path, file count after excludes, git branch and short sha, whether a backup will be taken. For a `sync` deploy, say that files removed from the source will be deleted from the server — that is the step that surprises people.

## 4. Approval

Environments with `requireApproval: true` refuse to deploy without `confirm: true`. That flag exists so a human says yes to *this* release. Get an explicit yes in the conversation first. An earlier approval for an earlier release does not carry over.

## 5. Deploy

```
cpanel_deploy site=<site> environment=<env> note="<what is shipping>" confirm=<true only if approved>
```

Write a real `note` — a version number or the changelog headline. It is recorded in the result and it is what someone reads at 2am trying to work out what changed.

Never pass `skipBackup: true` for staging or production.

## 6. Verify

The result includes a health check. Then, for anything with a real user journey, hand to the `deploy-qa` agent for a browser pass — a 200 response proves the server is up, not that the site works.

If the health check failed: **roll back first**, diagnose after. `cpanel_rollback site=<site> environment=<env> confirm=true`.

## 7. Report

Give the user, in this order:

- release id and what shipped
- health check result with latency
- backup location
- the exact rollback command, copy-pasteable

## Strategy notes

**symlink** — files land in a new timestamped release directory, shared paths are linked in, then the `current` symlink is swapped atomically. Visitors never see a half-uploaded site. Rollback is a symlink repoint, effectively instant. Old releases are pruned to `keepReleases`.

**sync** — files are extracted straight into the docroot. There is a window during which the site is partly old and partly new, so prefer symlink where the hosting allows it. Rollback restores the pre-deploy backup tarball, which takes as long as the site is big. Use `sync` for the primary domain's `public_html`, which cPanel will not let you symlink reliably, and for Passenger app roots.

## Node sites

If `package.json` or `package-lock.json` changed, run `cpanel_node_install` **before** the deploy's restart and expect several minutes. After the restart, wait and then health-check twice — the first request pays the cold start and looks alarming for no reason.
