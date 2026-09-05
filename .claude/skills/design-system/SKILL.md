---
name: design-system
description: Establish or refresh a site's visual design system - type scale, colour roles, spacing scale, and the design tokens (CSS custom properties) that keep every component consistent. Use before building UI at scale, and when a site looks inconsistent across pages.
---

# Build the design system

A design system is what makes twenty pages look like one product instead of twenty. It is a small set of rules, expressed as tokens, that every component draws from — so consistency is the default and drift takes effort, rather than the other way round.

## Define the scales, not the values

The reason sites look unfinished is almost always inconsistency, not one bad choice. Fix the cause by deciding scales once:

**Type** — a modular scale, not a size per element. Pick a base (16px) and a ratio (~1.2–1.25 for most sites) and derive a handful of steps. One or two font families; often one, used well. Set line-height with the role: ~1.5 for body, tighter for headings.

**Colour** — express it as *roles*, so components reference meaning not hex:
- structural: `bg`, `surface`, `border`
- text: `text`, `text-muted`
- brand: one `accent` (two at most)
- semantic: `success`, `warning`, `danger`

Everything else derives from these. **Measure contrast** — 4.5:1 for body text, 3:1 for large text and UI — with a checker, not by eye.

**Spacing** — one scale, 4px or 8px based, used for every margin, padding and gap. Consistent spacing signals "designed" more than any decoration.

**The rest** — one or two border-radius values, a small shadow set tied to elevation, one focus-ring style used on everything focusable.

## Express it as tokens

CSS custom properties are the right tool on this stack: no build step, they work in plain PHP-rendered HTML, and they are the contract the whole team codes against.

```css
:root {
  /* colour — light */
  --bg: #ffffff;        --surface: #f7f7f8;    --border: #e4e4e7;
  --text: #18181b;      --text-muted: #71717a; --accent: #2563eb;
  --success: #16a34a;   --warning: #d97706;    --danger: #dc2626;
  /* spacing */
  --space-1:.25rem; --space-2:.5rem; --space-3:.75rem; --space-4:1rem; --space-6:1.5rem; --space-8:2rem;
  /* type */
  --text-sm:.875rem; --text-base:1rem; --text-lg:1.25rem; --text-xl:1.75rem; --text-2xl:2.5rem;
  --font-body: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  /* other */
  --radius:.5rem; --shadow-1:0 1px 3px rgb(0 0 0/.1); --shadow-2:0 4px 12px rgb(0 0 0/.12);
}
```

A component built from tokens stays consistent for free; one built from raw values drifts the instant someone copies it. That is the whole point.

## Theme-aware from the first line

Define the full light palette on bare `:root`. Redefine **only the colour tokens** under `@media (prefers-color-scheme: dark)`, and again under `[data-theme="dark"]` so an explicit toggle wins in both directions. Never give a colour its only definition inside a dark block, or the light theme gets a hole. Decide up front whether the site commits to one look or supports both — bolting dark mode onto hardcoded colours later is a rewrite.

## Document it so it gets used

A design system nobody can find gets ignored and re-invented. Produce:

1. The token file (`tokens.css` or the top of the main stylesheet), as the single source of truth.
2. A one-page reference — the scales rendered, the colour roles with their contrast pairs, the core components (button, input, card) shown in their states. An Artifact works well; the `design` skill produces a higher-fidelity, editable canvas when the user wants to push it around visually.
3. The rules in prose: "spacing always comes from the scale", "colours are referenced by role, never by hex in a component".

## Hand-offs

`ui-designer` owns the aesthetic decisions behind the scales; this skill codifies them into tokens. `frontend-builder` implements components from the tokens and must not introduce raw values. `dataviz` sets chart colours and should be pointed at this palette so charts and UI agree. `deploy-qa` checks the result in both themes at real widths.
