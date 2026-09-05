---
name: threat-model
description: Think through what could go wrong security-wise before building - the assets worth protecting, who would attack them, how, and which defences are worth adding. Needs no running system, so use it during design, when the architecture is still cheap to change.
---

# Threat model

Find the security problems while they are still a design decision rather than an incident. A threat model needs no running system — that is its value: you do it early, when moving a trust boundary costs a sentence instead of a rewrite.

Keep it proportionate. A brochure site with a contact form needs ten minutes; an app handling payments and accounts needs a real session. The goal is the handful of threats worth defending against, not an exhaustive catalogue nobody reads.

## 1. What are you protecting?

List the assets, concretely. Not "the system" — the *things an attacker would want*:

- data: customer PII, credentials, payment details, business data
- capability: the ability to act as another user, to reach admin functions, to send mail from your domain
- the account itself: disk, the ability to host content, the domain's reputation

Rank them. A model that treats every asset as equally precious defends none of them well.

## 2. Draw the trust boundaries

Sketch how data flows and mark every line where it crosses from less-trusted to more-trusted:

- the browser → your server (everything from the client is hostile until validated)
- your server → the database
- your server → third parties (payment, mail, APIs)
- unauthenticated → authenticated → admin

Each boundary is where a check must exist. A missing check at a boundary is the whole game — most real vulnerabilities are one absent boundary control.

## 3. Walk STRIDE at each boundary

A prompt list so you do not miss a class. At each boundary ask:

- **Spoofing** — can someone pretend to be another user or system? (auth, session integrity)
- **Tampering** — can they modify data in transit or at rest? (validation, integrity, HTTPS)
- **Repudiation** — can they deny doing something? (logging, audit trail)
- **Information disclosure** — can they read what they should not? (access control, error messages, exposed files)
- **Denial of service** — can they exhaust a resource? (rate limits — and on shared hosting your quota and CPU are shared, so this is real)
- **Elevation of privilege** — can they gain rights they should not have? (authorization per record, admin separation)

You will not have a threat in every cell. Note the ones that are real for *this* app and move on.

## 4. Decide what to do about each

For every real threat, one of:

- **Mitigate** — the control that addresses it, named specifically ("check record ownership in the handler, not just login state").
- **Accept** — with a written reason ("no rate limit on the newsletter form; abuse is low-value and the form is trivial"). An accepted risk you wrote down is a decision; an unnoticed one is a hole.
- **Transfer** — push it to someone equipped for it (card data → the payment provider, so it never touches your server).

Rank the mitigations by asset value times likelihood, so the build does the high-value ones first.

## 5. Feed it into the build

The threat model is an input to `/architecture` and `/spec`, not a document that sits alone. The mitigations become requirements the engineers build in from the start — far cheaper than the same controls retrofitted after `/pentest` finds their absence. Revisit it when the design changes materially (a new integration, a new user type, handling a new kind of data).

## On this stack, the recurring real threats

Grounded in what actually happens to PHP/Node shared-hosting sites: missing per-record authorization (IDOR), input reaching SQL unparameterised, secrets or `.git` exposed in the docroot, uploads that can execute, and DoS-by-quota where one abusable endpoint exhausts the shared disk or CPU. If your model surfaces nothing else, make sure it covers these.

Hand active validation to `/pentest` and `web-pentester`, defensive configuration to `hosting-security-auditor`, and vulnerable dependencies to `/dependency-audit`.
