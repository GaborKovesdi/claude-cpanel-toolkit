---
name: preflight
description: Run every pre-deploy check for a site and environment without changing anything - local source, git state, SSH reachability, remote paths, disk and inode quota, runtime version, current site health. Use before any deploy, and whenever you want to know if a target is deployable.
---

# Preflight

Answers one question: **would a deploy to this target succeed right now?** Changes nothing.

## Run it

```
cpanel_preflight site=<site> environment=<env>
```

If the user did not name a site, run `cpanel_list_sites` first and ask which one rather than guessing. If they named a site but no environment, default to `staging` when the site has one; never default to production.

## Report

Show every check with a pass/fail marker, then a one-line verdict. Do not bury a failure in a wall of green.

```
demo-php / production            strategy: symlink

  PASS  local source exists           C:/xprojects/demo-php/public
  PASS  local files to ship           128 files after excludes
  FAIL  git worktree clean            3 uncommitted changes: src/app.php, ...
  PASS  ssh reachable                 demousr | 0022
  PASS  remote path writable          /home/demousr/sites/demo/releases
  PASS  disk space                    2140 MB available
  PASS  site currently responds       HTTP 200 in 180ms

  NOT DEPLOYABLE - 1 check failed. Commit or stash the working tree first.
```

## Interpreting the failures

- **git worktree dirty** — the release would not correspond to any commit. Offer to commit; do not offer to ignore it for production.
- **ssh unreachable** — usually the key is not in the agent, the host blocks the IP, or the port is not 22. `cpanel_ssh_exec` with `echo hi` gives you the raw error.
- **remote path not writable** — the path may not exist yet (the check creates it) or the account may be over quota, which makes everything look unwritable.
- **disk space low** — the deploy takes a backup first, so it needs roughly twice the site size free. Check inodes too via `cpanel_disk_usage`; you can be under the megabyte limit and out of inodes.
- **php not on the ssh PATH** — normal on cPanel, not necessarily a problem. The web SAPI is separate. It only matters if the deploy runs `postDeploy` PHP commands, in which case use the absolute `ea-php` binary.
- **site not responding** — find out why *before* deploying. Deploying onto an already-broken site makes the cause much harder to identify afterwards.

## After a clean preflight

Say what a deploy would do concretely — strategy, target path, file count, whether a backup will be taken, whether approval is required — so the user is agreeing to something specific rather than to the word "deploy".
