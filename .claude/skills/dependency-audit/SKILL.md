---
name: dependency-audit
description: Audit third-party dependencies for known vulnerabilities and report only what is actually reachable in this deployment - not the raw scanner output. Use before a launch, periodically, and whenever a security advisory names something the project uses.
---

# Dependency audit

Third-party code is most of what runs on a modern site, and it is where a lot of real vulnerabilities live. But a raw `npm audit` dumping 400 "criticals", most of them in build tooling that never ships, trains everyone to ignore the one that matters. Your job is to separate the reachable from the noise.

## 1. Run the scanners

- **Node:** `npm audit --omit=dev` (production tree first — that is what ships), then the full `npm audit` separately so you can see dev-only issues without conflating them. `npm outdated` for how far behind things are.
- **PHP/Composer:** `composer audit`, and `composer outdated --direct` for the packages you actually chose versus their transitive dependencies.
- Note the tooling's own limits: a clean audit means "no *known* advisory", not "safe".

## 2. Triage by reachability — the step that makes this useful

For each advisory, ask three questions before you report it:

1. **Does the vulnerable code ship?** A flaw in a build tool, a test framework or a dev server does not run in production. Real, but a different and lower priority — say so, do not rank it with the production ones.
2. **Is the vulnerable code path reachable in *this* app?** A prototype-pollution bug in a function the app never calls is far less urgent than an RCE in the request path. Reachability, not just presence, sets severity.
3. **Is it exposed to untrusted input?** A parser vulnerability matters enormously if it parses user uploads, and little if it only ever sees your own committed config.

This is judgement a scanner cannot do, and it is the entire value of the audit.

## 3. Report what to actually do

Ranked by real risk to this deployment, not by the scanner's CVSS number:

- **Fix now** — reachable, exposed, serious. The exact remediation: `npm update x`, a version bump, or a workaround if no patched version exists yet.
- **Fix soon** — reachable but lower impact, or a major-version bump that needs testing.
- **Track** — dev-only or unreachable. Recorded so it is not rediscovered as new every audit, but not blocking anything.

For each "fix now", say whether the update is a safe patch bump or a breaking major that needs `test-engineer` to verify nothing broke.

## 4. Reduce the surface, not just patch it

The most effective dependency fix is often removing a dependency:

- A package pulled in for one small function you could write in ten lines is a permanent supply-chain risk for a one-time convenience.
- Unmaintained packages (no release in years, archived repo) are a slow-motion vulnerability — flag them even with no current advisory, because when the advisory lands there will be no patch.
- On shared hosting, dependencies are also inodes and disk you are short on. `--omit=dev` in production is both a security and a quota win.

## 5. On this stack

- Ship `--omit=dev`; dev dependencies do not belong on the server (see `node-passenger-engineer`).
- Commit the lockfile (`package-lock.json`, `composer.lock`) and deploy from it, so what you audited is what ships — an audit of a tree different from production proves nothing.
- Re-run after every dependency change and on a schedule; a clean audit has a short shelf life as new advisories are published against code you already run.

Wire the production audit into the release path so a new critical in the shipping tree is visible before deploy, not after. Hand the fixes to the relevant engineer and, for anything that touched the request path, to `web-pentester` to confirm the fix holds.
