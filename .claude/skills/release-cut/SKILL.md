---
name: release-cut
description: Cut a versioned release - decide the semver bump, write the changelog entry, tag the commit, and hand off to deploy. Use when someone wants to ship a version rather than just push files.
---

# Cut a release

Turns "the code is ready" into a numbered, tagged, described release that someone can point at in six months.

## 1. Look at what is actually in it

```
git log --oneline <last tag>..HEAD
git diff --stat <last tag>..HEAD
```

Read it. Do not summarise the commit subjects back to the user as though that were a changelog — commit subjects are written for developers, changelogs are written for whoever owns the site.

If the working tree is dirty, stop. A release must correspond to a commit.

## 2. Choose the version

Semver, judged against what a *user of the site* experiences:

- **major** — URLs change, a feature is removed, a template contract other people depend on breaks, a migration cannot be rolled back
- **minor** — new page, new feature, new option, anything additive
- **patch** — fixes, copy changes, styling, dependency bumps

State the bump and the one reason for it in a single sentence. If you are torn between minor and major, it is major.

## 3. Write the changelog entry

Keep-a-changelog shape, newest first, in `CHANGELOG.md`:

```markdown
## [1.4.0] - 2026-09-05

### Added
- Booking form now sends a confirmation email to the visitor.

### Fixed
- Gallery images no longer overflow the layout on narrow phones.
```

Rules that make it worth writing:

- One line per user-visible change, in plain language. Not "refactored the mailer service".
- Group under Added / Changed / Fixed / Removed / Security. Drop empty groups.
- **Security fixes always get a line**, even a vague one. Someone deciding whether to update urgently needs to see it.
- Internal-only changes that nobody can observe do not belong here. If nothing is user-visible, say so and consider whether this needs a version at all.

## 4. Tag it

```
git add CHANGELOG.md && git commit -m "Release 1.4.0"
git tag -a v1.4.0 -m "1.4.0"
```

Push the tag only when the user asks — tags are hard to retract once other people have fetched them.

If the site has a version constant or a `package.json` version, bump it in the same commit. Do not leave the tag and the code disagreeing.

## 5. Hand off

Give the release manager the version, the changelog headline, and the target. The headline becomes the deploy `note`:

```
cpanel_deploy site=<site> environment=production note="1.4.0 - booking confirmation emails" confirm=true
```

Staging first unless the user has explicitly decided otherwise.

## GitHub

When the project has a GitHub remote and the GitHub MCP server is connected, create the release from the tag with the changelog section as the body. Draft it and show the user before publishing — a published release notifies watchers, and that is not something to undo.
