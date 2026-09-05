---
name: wireframe
description: Turn a spec or a flow into wireframes you can look at and click through - low-fi to settle structure, mid-fi to settle the flow - before any visual design. Use when the layout is being argued in words and needs to become something visible.
---

# Wireframe a screen or flow

Make the layout visible so it can be reacted to, while it is still cheap to change. A wireframe is a question about structure, not a draft of the finished look — keep it rough on purpose so people critique the *layout*, not the colour.

## 1. Pick the fidelity for the decision

- **Low-fi** — boxes, labels, placeholder text, one grey. Settles "what is on the screen and in what priority". Start here.
- **Mid-fi** — real content, real controls, greyscale, clickable between screens. Settles "does the task flow". Where the missing step gets caught.
- **High-fi** is the visual design — hand that to `ui-designer` / the `design` skill. Do not drift into it here.

State which level you are at, so nobody reviews the greyscale of a structure sketch.

## 2. List the screens *and states* before drawing

For the task at hand, enumerate every screen, then every state each screen has:

- default / populated
- **empty** (nothing created yet)
- **error** and validation
- **loading / partial**
- **worst-case content** (longest name, most rows, missing image)

The states are the point. A flow wireframed only in its tidy happy path has not been wireframed.

## 3. Choose the medium

- **Clickable HTML wireframe as an Artifact** — the default. Responsive (show 360px and 1440px from one file), clickable between screens, cheap. Keep it visibly low-fi: one grey palette, labelled boxes, system font, `[image]` placeholders. Load `artifact-design` first.
- **Editable canvas of the whole flow** — use the `design` skill when the user wants to push screens around and edit them on a pan/zoom canvas.
- **Inline ASCII/box sketch** — fine for settling one screen's hierarchy fast. Do not over-invest.

## 4. Annotate

Write the decisions onto the wireframe: "list paginated 20/page", "button disabled until valid", "this links to the confirmation screen". An un-annotated wireframe gets interpreted three ways.

## 5. Feed findings back

What the wireframe surfaces — a missing state, a dead end, a step that does not work — goes back to the spec and to `ux-designer` before the flow is signed off. That is the whole return on wireframing: catching it here, where a redrawn box is the entire cost.

## Hand-offs

`ux-designer` supplies the flow and each screen's job; `wireframe-designer` (this skill's agent) produces the wireframes; `ui-designer` and `design` take the agreed structure to visual fidelity; `frontend-builder` implements; `deploy-qa` checks the built result against the wireframed flow.
