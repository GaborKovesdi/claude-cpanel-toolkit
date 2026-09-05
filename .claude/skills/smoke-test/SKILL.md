---
name: smoke-test
description: Verify a deployed site in a real browser - render, console errors, failed asset requests, mobile and desktop layout, primary user journey, internal links. Use after every deploy and before signing off a release.
---

# Smoke test a deployed site

An HTTP 200 tells you the server answered. It does not tell you the site works. This is the check that does.

Run it against the **deployed URL**, never localhost.

## The pass

1. **Renders** — load the home page, confirm the main heading and primary content are in the DOM, not just that the request succeeded. A JS error can leave a perfectly valid empty page.
2. **Console clean** — collect errors and warnings. A new uncaught exception since the last release is a blocker.
3. **Network clean** — every CSS, JS, font and image request. A 404 here usually means the build did not run, or a cache-busting hash changed in the HTML but the file was not uploaded.
4. **Primary journey** — whatever the site is *for*. Contact form, booking, search, login, checkout. Complete it and confirm the success state, not just that the button was clickable.
5. **Two viewports** — 360x800 and 1440x900, screenshot both. Horizontal overflow, overlapping text, an unopenable nav, tap targets under 44px.
6. **Links** — crawl one level from the home page, report 404s.

## Tools

Use the Playwright MCP tools for the browser work. `cpanel_health` covers the plain HTTP check and gives you latency and response headers cheaply — use it first, and only reach for the browser once the site is answering at all.

For the `deploy-qa` agent, hand it the URL and what the primary journey is; it does not know what the site is for unless you tell it.

## Before you submit anything

Forms that send email, take payment, create bookings or write to production systems: say what you are about to do and get agreement first. Use obviously-fake test data (`smoke-test@example.com`, name "QA Test") and tell the owner what to clean up.

## Report

Verdict first — **pass** or **fail with N blockers** — then evidence. Blockers and cosmetic issues in separate lists. Screenshots for anything visual.

For each failure: what you did, what you expected, what happened, and whether it is new since the previous release. That last one decides whether the release gets rolled back or the bug goes in the backlog, so establish it whenever you can.

Never report a pass on a check you could not run. Say it did not run, and why.
