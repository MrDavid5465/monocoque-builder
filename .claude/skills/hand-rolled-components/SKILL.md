---
name: hand-rolled-components
description: How to build a new one-off visual component in this app's frontend (a "card", panel, or similar shell with no existing Fabric.tsx field type or Fluent component) — build it from basic Fluent primitives and theme.palette/theme.semanticColors, check for prior art first, and put genuinely reusable atoms in typical-admin-fabric/lib/templates. Use this before hand-rolling any new component with inline styles.
license: MIT
user-invocable: false
---

# Hand-rolling a component in this app

This app's UI is built almost entirely from `@fluentui/react` (v8) plus this
repo's own `per-form`/`typical-admin-fabric` scaffolding on top of it — there
is no separate design system and no Fluent "Card" package installed
(`@fluentui/react-cards` and Fluent v9 are both absent from `package.json`).
So when a screen needs a shell that doesn't map to an existing Fabric.tsx
field type or a stock Fluent component (a bordered "card" wrapper, a status
strip, a custom panel), it has to be hand-rolled — but "hand-rolled" doesn't
mean inventing arbitrary CSS.

## Check for prior art before inventing a look

Two places to check, in order, before writing a single style value:

1. **This repo's own reusable atoms** — `src/lib/typical-admin-fabric/lib/templates/` (`Form.tsx`, `Fabric.tsx`, `ThumbnailCard.tsx`, `FormCard.tsx`). If something close already exists, extend it or copy its shape rather than starting over.
2. **The sibling `davidallanscott.ca` repo** (`/var/home/david/source/repos/davidallanscott.ca`) — the original app this one's `denim`/`typical-admin-fabric` scaffolding was ported from. Its `src/lib/styles.ts` (`qStyles`) and `src/components/**/*.tsx` are full of exactly this kind of shell component (`ServerCard`, `meetingCard`, `alert`, ...). A concrete example: this app's `FormCard.tsx` is a direct port of that repo's `ServerCard`'s `style.card` — `borderTop: '.25em solid themePrimary'` + a soft two-layer `boxShadow`, not a background/border box invented from scratch. Getting this wrong (making up a plausible-looking box instead of checking) happened once already this session — the first draft used a flat `background`/`border`/`borderRadius` box that looked reasonable but wasn't this app's actual card style.

If neither has it, only then design something new — and even then, stay close to values already used elsewhere in this codebase (spacing like `.77em`, `0.25em` accent borders, the same shadow recipe) rather than picking arbitrary new numbers.

## Build from Fluent primitives, theme-aware

- Use Fluent layout primitives (`Stack`, `Separator`) for structure, not raw `<div>` soup — matches every other component in `typical-admin-fabric`/`Shakers`.
- Pull every color from `getTheme()` — `theme.palette.themePrimary`, `theme.palette.neutralLighterAlt`, `theme.semanticColors.*` — **never** a hardcoded hex/rgb color. This is what makes the component obey the light/dark theme switch (`src/lib/light.ts`/`dark.ts`) automatically. A raw `boxShadow` alpha-black value (as in `FormCard`) is the one accepted exception — shadows read fine as neutral black-alpha in both themes in this app's existing precedent (`alert`/`card` in the original app), so don't over-engineer a themed shadow color unless asked.
- Prefer real Fluent controls (`IconButton`, `Dropdown`, `Checkbox`, `DefaultButton`) over hand-styled `<button>`/`<input>` for anything interactive — see `ChannelHeader.tsx`'s/`TyreGrid.tsx`'s IconButtons and `EffectRow.tsx`'s mute button for the established icon-button styling pattern (children `<Icon iconName=".."/>`, not `iconProps`, when the button needs a conditional icon/color).

## Where a genuinely reusable atom belongs

If the shell is generic (not tied to one feature's data), it belongs in
`src/lib/typical-admin-fabric/lib/templates/`, re-exported from both
`typical-admin-fabric/lib/index.ts` **and** `denim/lib/index.ts` (see how
`Form`/`List`/`ThumbnailCard`/`FormCard` are each exported from both) so
feature code imports it via the `denim/lib` barrel
(`import { Form, FormCard } from '../../lib/denim/lib'`) rather than reaching
directly into `typical-admin-fabric`. If it's genuinely one-off (tied to a
single feature's data shape), keep it local to that feature's folder instead
(e.g. `Shakers/ChannelHeader.tsx`, `Shakers/TyreGrid.tsx`) — don't
over-generalize a component nothing else will ever use.

## When prototyping

Reach for this before writing the first line of a new visual shell,
especially during rapid prototyping where it's tempting to just eyeball a
box with inline styles — check prior art first, theme every color, and place
the result correctly the first time rather than doing it ad hoc now and
fixing the location/theming later.
