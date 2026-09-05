---
name: spec
description: Write a product or feature spec that turns a vague request into something buildable - the problem, the users, scope in and out, the flows, and how you will know it works. Use before building anything non-trivial, and whenever a request could be read two different ways.
---

# Write a spec

A spec exists to prevent building the wrong thing. It is done when two different people would build the same thing from it — not when it is long.

Match the length to the risk. A one-paragraph feature gets a one-paragraph spec. A new application gets the full shape. A spec longer than the thing it describes is a warning sign.

## The shape

**1. Problem** — one or two sentences on the *user's* problem, not the feature. "Customers call to ask where their order is" not "build an order tracking page". If you cannot state the problem without naming the solution, you do not understand it yet.

**2. Who it is for** — the actual people and what they are trying to get done. If there are distinct types (a customer and an admin), name them; their needs conflict and the spec has to resolve the conflict.

**3. Scope** — two lists:
- **In:** what this build delivers.
- **Out:** what it deliberately does not, *especially* the tempting things. The "out" list prevents more wasted work than the "in" list, because unstated exclusions become mid-build arguments.

**4. The flows** — the main task end to end, in numbered steps, including the unhappy ones: the error, the empty state, the abandoned-halfway. Hand the detail to `ux-designer`; the spec captures enough that everyone agrees what "it works" means.

**5. Rules and constraints** — the business rules a stranger would not guess (who can see what, what happens at the edges, what is mandatory), and the technical constraints that are fixed (the hosting, the existing stack, a deadline, a budget).

**6. Success** — how you will know it worked, stated so it can actually be checked. "The tracking page loads in under two seconds and shows the current status" beats "fast and useful".

**7. Open questions** — what is still undecided and who decides it. An honest open question is worth more than a confident guess that turns out wrong.

## How to run it

- Start from what the user said, then find the gaps by imagining building it: the first thing you would not know how to build is the first gap to fill.
- Ask only the questions whose answers change the build. "What should the error message say" is a detail for later; "can a user edit an order after it ships" is a scope question that changes everything.
- Write it as a document (Markdown in the repo, or an Artifact for something the team will read and comment on). A spec that lives only in chat is not a reference anyone can return to.
- Hand off cleanly: architecture and tech choices to `product-architect`, flows and screens to `ux-designer`, and keep the spec as the thing they all check against.

## What makes a spec bad

- It describes a solution and skips the problem, so nobody can tell whether the solution is the right one.
- It has no "out of scope", so it quietly grows.
- Its success criteria cannot be checked, so "done" is an argument.
- It is so detailed it has decided things that should be decided later by the people doing them.
