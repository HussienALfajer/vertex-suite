# Design System

**Status** v1.13 · **Scope** the interface layer of the whole product

This document is the specification of the interface layer. It is complete **before** the first module screen exists — otherwise six modules' interfaces get rebuilt when it settles.

This document is the authority on the interface layer. Where it and `core-features.md` disagree about a behaviour a feature requires, the feature wins and this document is corrected (§15).

---

## 1. What this is, and how to use it

| You are…                           | Read                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Building `packages/ui`             | All of it                                                                    |
| Adding a screen in any later unit  | §6 density · §9 direction · §10 inventory · §11 keyboard · §12 display rules |
| Adding a colour, size or component | §15 first — this document changes by decision, not by need                   |

**Nothing here is decorative.** A cashier and a stock keeper look at this software for eight hours a day, which makes the interface an engineering concern. Every value below is either derived from a stated rule or decided and recorded with its reason.

---

## 2. Principles

These are the interface principles of the product, written as things a reviewer can check.

| Principle                                   | What it means in practice                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Warm neutral ground**                     | Never stark white, never a cold grey. The neutral ramp carries a deliberate warm hue at every step, light and dark alike (§4.2)                                   |
| **One accent, for action and focus only**   | The accent is not decoration. Status colours are semantic and carry meaning; a colour that means nothing is not used                                              |
| **Separation by space, not borders**        | Whitespace and surface shifts carry hierarchy. Borders appear where they genuinely aid scanning — grids and tables                                                |
| **Density is contextual, not a preference** | Three densities (§6). The register is dense because rows per screen is a productivity number; forms are comfortable because entry errors cost more than scrolling |
| **Type carries the hierarchy**              | One family, a small scale, weight and colour doing the work decoration otherwise would                                                                            |
| **Tabular numerals wherever money appears** | `font-variant-numeric: tabular-nums`, non-negotiable in financial tables                                                                                          |
| **Motion fast and almost unnoticed**        | 120–200 ms, ease-out, nothing that delays a keystroke, `prefers-reduced-motion` respected                                                                         |
| **Light and dark are equals**               | One token set, two value sets. Dark is not a filter over light, and it is not an afterthought: a register runs at night                                           |
| **Contrast is solved, not sampled**         | Every foreground/background pair in this document carries its measured ratio. A pair that does not reach its target is not shipped (§4.6)                         |

---

## 3. Token architecture

### 3.1 Four layers

```
Primitive        Alias              Semantic              Component
neutral-450      neutral            surface-1             table-row-hover
blue-fill        (inverts in dark)  text-secondary        switch-track
                                    border, fill, on      focus-ring
```

- **Primitive** — the generated ramps of §4.2 and §4.3. Fixed hex values. **No component ever references a primitive.**
- **Alias** — the handful of names that invert between light and dark.
- **Semantic** — what the interface consumes: `surface-*`, `text-*`, `fill-*`, `bg-*`, `border-*`, `on-*`, `chart-*`. **This is the only layer a screen is allowed to name.**
- **Component** — tokens owned by one component, defined beside it in `packages/ui`.

The rule that makes this worth the layers: **per-tenant branding (§4.5) and every future theme change happen in the semantic layer alone.** A screen that reaches past it to a primitive breaks that, and is a review finding.

### 3.2 Switching axes

| Attribute            | Values                                         | Changes                                                                             |
| -------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `data-theme`         | `light` · `dark` · absent (follows the system) | Every colour value set                                                              |
| `data-density`       | `compact` · `comfortable` (default) · `touch`  | Sizes, spacing, control heights, type scale (§6)                                    |
| `data-reduce-motion` | `true`                                         | Disables transitions; set from `prefers-reduced-motion` and from the tenant setting |

Direction is **not** an axis. `<html dir="rtl" lang="ar">` is the default and RTL is not a mode.

### 3.3 Naming

CSS custom properties are prefixed `--vx-`. Tailwind consumes them through `@theme inline`, so a screen writes `bg-surface-1` and `text-secondary`, never a raw value.

One concept, one English name — identical in the tokens, the components and the code.

---

## 4. Palette

### 4.1 The generating rule

Every value below through §4.4 is **imported**, not generated — a decision made once, deliberately, and recorded here rather than left to be reverse-engineered from a diff years later.

> **Provenance.** The layering of §3.1, the density-as-token-axis idea of §6, the dark-mode weight compensation of §5.4 and the `on-*` pairing convention of §4.4 were adopted early after studying a reverse-engineered reference of a third-party proprietary design system, as **methods** — no value was taken at that point, and every number in this section was the output of an OKLCH generator solving for contrast.
>
> That changed in a later revision, at the tenant's explicit, repeated instruction: the neutral ramp (§4.2) and the five accent hues (§4.3) now carry that same reference's **literal published values**, colour by colour, excluding only its own brand colour (never adopted, and nothing in this product names one — §4.5 has no fixed brand colour to begin with). The generator that used to produce this section — OKLCH primitives, a chroma profile peaking at `L ≈ 72`, a contrast-target binary search for every accent's lightness — is unchanged and still exported (`spec.ts`, `generate.ts`): it produces the chart palette of §4.8 today, and is one function call away from producing this section again, should the palette ever need to move without another import to anchor it to.
>
> **The accessibility floor was not quietly lowered to fit.** §4.6 names, by measured number, the four pairs in the imported palette that fall short of this document's own 4.5:1 target — a choice made with the numbers in front of the tenant, not a gap nobody noticed. Every other pair in this document still has to clear 4.5:1 (3:1 for non-text), and the test suite still fails the build the day one stops.

### 4.2 Neutral ramp

35 steps, published in `spec.ts`'s `NEUTRAL_RAMP_HEX` and pinned exactly by `palette.test.ts`. The ramp begins at white and ends at a warm near-black. The steps from `810` upward are compressed deliberately: dark-mode surfaces need very small separations between a page, a panel and a popover.

|                 |                 |                 |                 |                 |
| --------------- | --------------- | --------------- | --------------- | --------------- |
| `0` `#ffffff`   | `10` `#fcfcfb`  | `20` `#f9f9f7`  | `30` `#f6f6f4`  | `40` `#f3f3f0`  |
| `50` `#f0efec`  | `60` `#edece8`  | `70` `#eae9e4`  | `80` `#e7e6e1`  | `90` `#e4e3dd`  |
| `100` `#e1e0d9` | `150` `#d2d1c7` | `200` `#c3c2b7` | `250` `#b4b3a8` | `300` `#a5a49a` |
| `350` `#97958d` | `400` `#898781` | `450` `#7b7974` | `500` `#6d6b67` | `550` `#5f5e5a` |
| `600` `#52514e` | `650` `#454442` | `700` `#383835` | `750` `#2c2c2a` | `800` `#20201f` |
| `810` `#1e1e1d` | `820` `#1c1c1b` | `830` `#1a1a19` | `840` `#181817` | `850` `#151515` |
| `860` `#131313` | `870` `#111111` | `880` `#0f0f0f` | `890` `#0d0d0d` | `900` `#0b0b0b` |

### 4.3 Accent hues

Five hues, each carrying one meaning. **A sixth is not added because a screen wants variety** (§15). Every value below is published in `spec.ts`'s `ACCENT_PALETTE_HEX`, imported the same way and at the same time as §4.2.

| Hue       | Meaning                                                  | Never used for                                       |
| --------- | -------------------------------------------------------- | ---------------------------------------------------- |
| **blue**  | Interaction: the primary action, links, focus, selection | Status                                               |
| **green** | Success, posted, in stock, positive balance              | A "save" button — saving is an action, not a success |
| **red**   | Danger, reversal, negative balance, validation failure   | Emphasis                                             |
| **amber** | Warning, pending, provisional business date, low stock   | Errors                                               |
| **teal**  | Information, neutral notice, help                        | Anything actionable                                  |

Each hue provides six tokens. `fill` and `fill-hover` are identical in both themes — a filled control's contrast requirement does not change with the theme, only what colour clears it (§4.4's `on-*` table). **`amber` alone breaks the fill/fill-hover pattern the other four keep**: at a stop this light, a hover has to move _further_ from white to read as a hover at all, so it moves darker rather than lighter, from the same source palette's own exception.

**Light theme**

| Hue   | `fill`    | `fill-hover` | `text`    | `bg`      | `on-bg`   | `border`  |
| ----- | --------- | ------------ | --------- | --------- | --------- | --------- |
| blue  | `#2a78d6` | `#3987e5`    | `#184f95` | `#cde2fb` | `#184f95` | `#86b6ef` |
| green | `#009300` | `#0ca30c`    | `#006300` | `#caeac7` | `#006300` | `#73cb6d` |
| red   | `#d03b3b` | `#e34948`    | `#8e2626` | `#fad6d6` | `#8e2626` | `#f09595` |
| amber | `#fab219` | `#eda100`    | `#734500` | `#f9dca4` | `#734500` | `#eda100` |
| teal  | `#138e65` | `#199e70`    | `#065f49` | `#bfebdb` | `#065f49` | `#5acba0` |

**Dark theme**

| Hue   | `fill`    | `fill-hover` | `text`    | `bg`      | `on-bg`   | `border`  |
| ----- | --------- | ------------ | --------- | --------- | --------- | --------- |
| blue  | `#2a78d6` | `#3987e5`    | `#6da7ec` | `#032042` | `#6da7ec` | `#0d366b` |
| green | `#009300` | `#0ca30c`    | `#0ca30c` | `#11260f` | `#0ca30c` | `#074506` |
| red   | `#d03b3b` | `#e34948`    | `#ec7e7e` | `#3c0e0e` | `#ec7e7e` | `#641919` |
| amber | `#fab219` | `#eda100`    | `#db9300` | `#311a00` | `#db9300` | `#512e00` |
| teal  | `#138e65` | `#199e70`    | `#3bbd8c` | `#022720` | `#3bbd8c` | `#034235` |

`onBg` equals `text` in every row: a role's tinted background (a badge, a banner) is read with exactly the ink that names the role everywhere else, which is the source palette's own choice rather than a coincidence of this table. `green`'s dark-theme `text`/`onBg` sits one stop darker than the pattern the other four keep (`400`, not `300`) — `300` did not clear its own contrast floor against a dark surface, in the source palette as well as this one.

### 4.4 Semantic tokens

| Token                                   | Light                         | Dark                    | Role                                                                                                                                                 |
| --------------------------------------- | ----------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface-0`                             | `neutral-20` `#f9f9f7`        | `neutral-900` `#0b0b0b` | Behind everything; the window ground                                                                                                                 |
| `surface-1`                             | `neutral-10` `#fcfcfb`        | `neutral-850` `#151515` | **The page**                                                                                                                                         |
| `surface-2`                             | `neutral-0` `#ffffff`         | `neutral-830` `#1a1a19` | Panels, cards, table headers                                                                                                                         |
| `surface-3`                             | `neutral-0` `#ffffff`         | `neutral-810` `#1e1e1d` | Popovers, menus, dialogs                                                                                                                             |
| `text-primary`                          | `neutral-900`                 | `neutral-50`            | Body and headings                                                                                                                                    |
| `text-secondary`                        | `neutral-600`                 | `neutral-200`           | Labels, supporting text                                                                                                                              |
| `text-muted`                            | `neutral-400`                 | `neutral-400`           | Placeholders, metadata, units — the same stop in both themes, unlike every other row here                                                            |
| `text-disabled`                         | `neutral-900` @ 35%           | `neutral-50` @ 35%      | Disabled controls only                                                                                                                               |
| `border`                                | `neutral-900` @ 10%           | `neutral-50` @ 10%      | Default separation                                                                                                                                   |
| `border-strong`                         | `neutral-900` @ 20%           | `neutral-50` @ 20%      | Input rings, focused edges                                                                                                                           |
| `fill-primary`                          | `neutral-900`                 | `neutral-0`             | The neutral primary button                                                                                                                           |
| `fill-secondary`                        | `surface-2` + `border-strong` | `neutral-50` @ 8%       | The default button                                                                                                                                   |
| `fill-primary-hover`                    | `neutral-750`                 | `neutral-100`           | Hover on the neutral primary                                                                                                                         |
| `fill-secondary-hover`                  | `neutral-50`                  | `neutral-50` @ 14%      | Hover on the default button                                                                                                                          |
| `fill-ghost-hover`                      | `neutral-900` @ 5%            | `neutral-50` @ 7.5%     | Hover on a transparent control                                                                                                                       |
| `fill-field`                            | `surface-2`                   | `neutral-50` @ 5%       | Input backgrounds                                                                                                                                    |
| `on-primary`                            | `neutral-0`                   | `neutral-900`           | Label on `fill-primary`                                                                                                                              |
| `fill-accent`                           | `blue-fill`                   | `blue-fill`             | The accent action, and the focus ring of §7.3                                                                                                        |
| `fill-success`                          | `green-fill`                  | `green-fill`            | A filled success control                                                                                                                             |
| `fill-danger`                           | `red-fill`                    | `red-fill`              | A filled destructive control                                                                                                                         |
| `fill-warning`                          | `amber-fill`                  | `amber-fill`            | A filled warning control                                                                                                                             |
| `fill-info`                             | `teal-fill`                   | `teal-fill`             | A filled informational control                                                                                                                       |
| `on-accent` · `on-danger`               | `#ffffff`                     | `#ffffff`               | Label on a filled accent or danger control                                                                                                           |
| `on-success` · `on-warning` · `on-info` | `#0b0b0b`                     | `#0b0b0b`               | Label on a filled success, warning or info control — **not white**, because white does not clear the contrast floor against these three fills (§4.6) |

Borders are **alpha overlays, never solid colours**. A solid border is one more value to maintain per surface and drifts the moment a surface changes; an overlay composites correctly on all four surfaces by construction.

**`on-*` is no longer one colour for every fill.** The rule used to be unconditional — white in either theme, for every role — because every accent was _solved_ to clear 4.5:1 against white by construction. An imported fill carries no such guarantee: `success`, `warning` and `info` sit at a lightness where black is the one that actually clears the floor (`ON_ROLE_HEX` in `spec.ts` decides each role by measuring its own fill against both). `accent` and `danger` still take white — but §4.6 names the two specific pairs among those where even white falls short.

**Which hue carries which role.** `fill-accent` is blue, `fill-success` green, `fill-danger` red,
`fill-warning` amber and `fill-info` teal — the meanings of §4.3, bound to token names. The mapping
is fixed: a screen never names a hue, only a role, which is what lets the palette change hue without
a screen changing.

**Every fill that can be hovered has its own hover value, and it is a value, not an
effect.** Fading a fill with opacity lets the ground show through, which on a dark theme reads as
dirt rather than as response — and on the neutral primary, whose fill is near-white there, it is
indistinguishable from a disabled control. The neutral primary therefore moves one step along the
ramp toward the middle: darker in the light theme, lighter in the dark one, with the paired
foreground unchanged either way.

**Every `fill-*` has exactly one `on-*`.** A fill without its paired foreground is not a token, and adding one without the other is a review finding — this is the convention that makes an unreadable button structurally impossible rather than merely unlikely.

### 4.5 Per-tenant brand

There is **no fixed brand colour in the palette.** Branding is per tenant — **configuration, never a fork** — so the brand enters as a semantic token the tenant supplies:

- `fill-brand` — the tenant's colour, used on the sign-in screen, the printed document header and the register idle screen. **Nowhere else.**
- `on-brand` — computed at load: white or `neutral-900`, whichever reaches ≥ 4.5:1 against the supplied colour.
- A supplied colour that cannot reach 4.5:1 with **either** foreground is **refused at upload** with an explanation, not silently accepted.

The brand colour never drives interaction. The accent of §4.3 does. A tenant whose brand is red does not get red "save" buttons.

**The product's own mark is a different thing from the tenant's brand**, and the three surfaces above are
where they meet. A shop signs in to its own shop, so a tenant that has supplied a brand carries it there
and the product's mark stands down; until one is supplied, the product's mark is what stands in.
`<VertexLogo>` in `packages/ui` is that mark, and it is **drawn rather than placed**: a raster with
gradients turns to mud below about 24px, cannot be printed in one ink, and cannot take the colour of
whatever it sits on. It carries **fixed** colours — the one place in this system where a fixed value is
correct, because a mark that changed with the theme would not be a mark — in two tones:

| Tone   | Where                                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full` | Three neutral faces and the accent facet. Any surface except pure white: its lightest face is near-white, and `surface-2` is `#ffffff` in the light theme |
| `mono` | One silhouette in `currentColor`, the V knocked out as the ground showing through. Small sizes, one-ink print, a favicon, and on top of `fill-brand`      |

**The words take `currentColor` in both tones**, which is what lets one lockup serve both themes: §2 has
them as equals, and a wordmark baked black has chosen the light one. Three layouts — `mark`,
`horizontal`, `stacked` — and `VertexAppIcon` for the rounded square a platform draws, which is not the
logo at a small size but its own thing with its own ground and its own margin. All of them derive from
one statement of the geometry, because a logo system whose pieces are separate files is one where the
icon and the lockup drift a degree apart and nobody notices until they are side by side on an invoice.

| Mark height | What survives                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------- |
| ≥ 48px      | Everything, including the lit edge of the carve and the tagline                                     |
| 24–48px     | The mark and the wordmark. **No tagline** — it is the first thing to stop being readable            |
| < 24px      | `mono`, or the app icon, which drops the lit edge. The three neutrals read as one grey at this size |

Clear space on every side is **half the cube's width**, measured from the silhouette rather than from the
box. The tagline is set type rather than drawn letterforms, and is set with `textLength` so it spans the
wordmark exactly in whatever font a surface substitutes — outline it before the logo goes to a printer.

### 4.6 Verified contrast

Measured, not estimated. Every pair is asserted by a test in `packages/ui` (§13), against the source imported literally in §4.2–§4.3.

**Text on the page surface**

| Pair             | Light       | Dark      | Target |
| ---------------- | ----------- | --------- | ------ |
| `text-primary`   | **19.17**   | **15.88** | 4.5    |
| `text-secondary` | **7.73**    | **10.19** | 4.5    |
| `text-muted`     | **3.50** ⚠️ | **5.08**  | 4.5    |

**Accents** — `fill` measured against the label it actually carries now (§4.4's `on-*` table), not against a fixed white

| Hue   | `fill` + own label  | `fill-hover` + own label | `text` on page | `on-bg` on `bg` |
| ----- | ------------------- | ------------------------ | -------------- | --------------- |
| blue  | **4.42** ⚠️ (white) | **3.64** ⚠️ (white)      | 7.89 / 7.30    | 6.12 / 6.51     |
| green | 4.85 (black)        | 5.87 (black)             | 7.35 / 5.44    | 5.78 / 4.79     |
| red   | 4.80 (white)        | **3.95** ⚠️ (white)      | 8.33 / 6.83    | 6.38 / 6.23     |
| amber | 10.73 (black)       | 9.09 (black)             | 7.93 / 7.12    | 6.12 / 6.40     |
| teal  | 4.77 (black)        | 5.78 (black)             | 7.46 / 7.69    | 5.88 / 6.73     |

_(light / dark where two figures are given)_

Targets: **4.5:1** for text of any size — the AA large-text relaxation is not used, because Arabic connected forms have thinner joins than Latin letterforms and read worse at an identical measured ratio. **3:1** for non-text graphics: chart marks, icons carrying meaning, control boundaries.

**⚠️ Four accepted, named exceptions.** `text-muted` in the light theme, `fill-accent` carrying white at rest and on hover, and `fill-danger` carrying white on hover, do not clear 4.5:1 — a fact the tenant was shown, with these exact numbers, before choosing the literal import over adjusting them (§4.1). Nothing else in this document is relaxed: every other pair above is still pinned by `contrast.test.ts` and still fails the build the day it stops clearing its target. **`fill-accent`'s hover moving the wrong way is the most visible of the four** — a control that gets marginally harder to read at the moment the pointer lands on it — and is the one worth watching if this section is ever revisited.

### 4.7 Component tokens

Layer 4 of §3.1, and the only layer with values of its own. A component earns a token when a
semantic one cannot express what it needs — not when a screen wants a shade.

Every value below still resolves to the semantic layer, so a theme change reaches it like anything
else. A component token never names a primitive.

**Switch.** The one control whose two halves must stay distinguishable in four combinations at
once: track and knob, off and on, light and dark. `fill-secondary` cannot serve as the track — in
the light theme it resolves to `surface-2`, which is the same white as the knob, and the knob
disappears.

| Token             | Light           | Dark             | Role           |
| ----------------- | --------------- | ---------------- | -------------- |
| `switch-track`    | `border-strong` | `border-strong`  | The track, off |
| `switch-track-on` | `fill-primary`  | `fill-primary`   | The track, on  |
| `switch-knob`     | `surface-2`     | `text-secondary` | The knob, off  |
| `switch-knob-on`  | `on-primary`    | `on-primary`     | The knob, on   |

`border-strong` serves as the track because an overlay at 20% in both themes is exactly the
recessed grey a track wants — and naming the semantic token rather than carrying a value of its own
means the track follows a theme change with everything else.

The knob on carries the paired foreground of the track it sits on, which is the same rule as any
label on a fill (§4.4) — so it inverts with the theme for free and cannot become unreadable.

**Neutral badge.** `badge-neutral` is `border-strong` in both themes — the switch track's fill,
for the switch track's reason. `Badge`'s neutral tone shipped on `fill-secondary`, which in the
light theme is `surface-2`: the same white as the table row a badge sits in, so the pill was bare
text. `text-secondary` on it measures **5.04** light and **5.36** dark, and the contrast suite
holds it to 4.5:1 over both surfaces a badge sits on.

**Dialog scrim.** What a modal dims the page with: `dialog-scrim`, an overlay of `neutral-900` at
45% in both themes. Both dialogs wrote that mixture out against the primitive by name, which is the
one thing a component may not do.

### 4.8 Chart palette

Eight categorical series. All pinned to **one lightness per theme** (`L = 58` light, `L = 74` dark, chroma `0.145`) so that no series reads as more important than another — the ordering of a chart legend must not encode emphasis that the data does not carry.

| #   | Series  | Light     | Dark      |
| --- | ------- | --------- | --------- |
| 1   | blue    | `#257ecc` | `#60b0ff` |
| 2   | amber   | `#a46e00` | `#df9c27` |
| 3   | teal    | `#008c8c` | `#00c3c3` |
| 4   | red     | `#c15249` | `#f98478` |
| 5   | green   | `#239149` | `#5ec478` |
| 6   | violet  | `#8863c2` | `#b994f8` |
| 7   | magenta | `#b4528e` | `#ea83c0` |
| 8   | olive   | `#7f8000` | `#b1b231` |

Worst contrast against the page: **3.92** light, **7.39** dark — both above the 3:1 floor for non-text graphics.

Series 4 (red) and 5 (green) keep their semantic meaning in charts: **a series that means "loss" uses red, and one that means "profit" uses green, regardless of series order.** Colour is never the only channel — every chart also distinguishes series by direct labelling or by mark shape, because a cashier may be colour-blind and the system will never know.

---

## 5. Typography

### 5.1 Families

| Token        | Face                     | Licence     | Use                                       |
| ------------ | ------------------------ | ----------- | ----------------------------------------- |
| `font-sans`  | **IBM Plex Sans Arabic** | SIL OFL-1.1 | Arabic and the entire interface           |
| `font-latin` | **IBM Plex Sans**        | SIL OFL-1.1 | Latin companion where a run is Latin-only |
| `font-mono`  | **IBM Plex Mono**        | SIL OFL-1.1 | Codes, barcodes, identifiers, SQL, diffs  |

Fonts **ship with the application and are never loaded from a CDN** — the product must render identically with every network interface disabled. Every face declares a real fallback stack:

```
--vx-font-sans: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, system-ui, sans-serif;
--vx-font-mono: "IBM Plex Mono", ui-monospace, Consolas, monospace;
```

### 5.2 The scale

Derived for Arabic, not adapted from a Latin scale. Two deliberate differences from a typical Latin UI scale:

- **The floor is 12px, not 11px.** Arabic distinguishes ب ت ث ن ي largely by dot count and position; at 11px on a register screen at arm's length those collapse.
- **Line height runs 1–2px taller at every size.** Arabic ascenders and descenders (ل ط ك against ج ح خ) overlap far more than Latin ones, and the connected baseline leaves less optical air.

| Role       | Compact | Comfortable | Touch   | Used for                          |
| ---------- | ------- | ----------- | ------- | --------------------------------- |
| `caption`  | 12 / 17 | 12 / 18     | 14 / 20 | Units, metadata, table footnotes  |
| `footnote` | 12 / 18 | 13 / 19     | 15 / 22 | Helper text, secondary labels     |
| `code`     | 12 / 18 | 13 / 19     | 15 / 22 | Barcodes, identifiers, references |
| `body`     | 13 / 20 | 14 / 22     | 17 / 26 | Everything read as text           |
| `heading`  | 15 / 21 | 16 / 22     | 18 / 26 | Section and card headings         |
| `title`    | 20 / 28 | 22 / 30     | 24 / 32 | Dialog and panel titles           |
| `page`     | 24 / 32 | 26 / 34     | 28 / 36 | Page title, once per screen       |

_(size / line-height, in px)_

### 5.3 Weights

| Token      | Value | Use                                                    |
| ---------- | ----- | ------------------------------------------------------ |
| `regular`  | 400   | Body text                                              |
| `medium`   | 500   | Labels, buttons, table headers, emphasis in a data row |
| `semibold` | 600   | Headings, totals, the amount on a receipt              |
| `bold`     | 700   | Page titles only                                       |

Bold is never used for emphasis inside a sentence; colour and weight-500 carry it. Italic is **not used at all** — Arabic has no italic form, and a synthesised oblique is a defect, not a style.

### 5.4 Dark-mode weight compensation

Light text on a dark ground blooms optically and reads heavier than the same weight on a light ground. Dark mode compensates:

**IBM Plex Sans Arabic ships static weights only** — there is no variable build of the Arabic
family, although one exists for the Latin. So the second strategy applies: **dark mode steps text
at `body` size and larger down one named weight**, and leaves `caption` and `footnote` unchanged,
because those are already at the legibility floor of §5.2.

The Latin companion is bundled as **static weights too, despite a variable build existing**. A
variable Latin beside a static Arabic would compensate in two different ways inside one sentence,
and Arabic and Latin runs sit inside one sentence constantly here — an item name beside its SKU.

### 5.5 Numerals

- **Western digits (0–9) by default.** Arabic-Indic digits are a per-tenant display setting that **never** affects stored values or parsing.
- `font-variant-numeric: tabular-nums` on every element that can contain a figure in a column — mandatory in financial tables, and the default for the money, quantity and date components of §12.
- Numerals are never italic, never condensed, and never rendered in a face other than `font-sans` or `font-mono`.

---

## 6. Density

### 6.1 Three densities

| Density         | Where                                                | Why                                                                                        |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **compact**     | Back-office grids, tables, reports, the stock ledger | Rows per screen is a real productivity number for a stock keeper working through 300 lines |
| **comfortable** | Forms, settings, dialogs, wizards — **the default**  | An entry error costs far more than a scroll                                                |
| **touch**       | **The register**, the stocktaking PWA                | Fingers on glass. Nothing interactive below 48px                                           |

Density is set at the application root and inherited. A subtree may raise density (a dense table inside a comfortable form) but **may never lower it below `touch` on a touch surface** — that would produce a target a finger cannot hit.

### 6.2 Size tokens

| Token                                | compact              | comfortable           | touch                  |
| ------------------------------------ | -------------------- | --------------------- | ---------------------- |
| `h-control`                          | 24                   | 32                    | **48**                 |
| `h-control-nested`                   | 18                   | 22                    | 32                     |
| `h-row` (table row)                  | 32                   | 36                    | 52                     |
| `icon`                               | 16                   | 20                    | 24                     |
| `radius`                             | 2                    | 3                     | 4                      |
| `radius-card`                        | 4                    | 5                     | 6                      |
| `checkbox`                           | 16                   | 20                    | 28                     |
| `switch-h`                           | 16                   | 20                    | 28                     |
| `pad-xs` / `sm` / `md` / `lg` / `xl` | 4 / 6 / 8 / 12 / 20  | 6 / 8 / 12 / 16 / 24  | 8 / 12 / 16 / 22 / 32  |
| `gap-xs` / `sm` / `md` / `lg` / `xl` | 6 / 8 / 12 / 20 / 32 | 8 / 12 / 16 / 28 / 40 | 10 / 16 / 22 / 32 / 48 |

All values in px. The type scale moves with the density (§5.2).

### 6.3 The touch floor

On `touch`, **every interactive target is at least 48 × 48 px**, including icon-only buttons, table row actions and the close control of a dialog. A target smaller than that is a bug, not a style choice, and is asserted by a Playwright check over the register screens (§13).

---

## 7. Radius, elevation and focus

### 7.1 Radius

`radius` and `radius-card` follow the density (§6.2). `9999px` stays reserved for the one place a full capsule is a functional shape rather than a decorative one — **the switch track** — not for badges or status chips, which now round like everything else (below).

**Two radii and a pill, and nothing else.** `radius` is every control — button, field, row action, tooltip — **and now every badge and status chip as well**; `radius-card` is every surface that holds them — panel, dialog, toast, popover. A third value invented for one component is what turns a system into a collection, so there is no `rounded-lg` anywhere in this repository and a grep proves it.

**The corner is nearly square.** 3px on a control and 5px on the card around it at `comfortable`: enough that no corner cuts, not enough to read as a rounded shape. This is a decision about what a screen of dense tabular data should feel like — rounding is a shape, and thirty of them on one grid is a shape competing with the figures on it. A badge no longer tells itself apart from a button by its corner — nothing does, now, except the switch — so that job moved to what was always the _stronger_ signal anyway: a badge fills with a **tint**, sits at caption size, and sits inline rather than in the control row. Shape was never the only cue; it was just the one that stopped working once every corner converged on the same near-square.

### 7.2 Elevation

Four levels. Shadows are cast in the neutral, not in pure black, so they stay warm.

| Token           | Light                                                          | Dark                                                       | Use                         |
| --------------- | -------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------- |
| `shadow-sm`     | `0 1px 2px rgb(12 11 9 / .05), 0 2px 8px rgb(12 11 9 / .06)`   | `0 1px 2px rgb(0 0 0 / .30), 0 2px 8px rgb(0 0 0 / .24)`   | Raised control, switch knob |
| `shadow-md`     | `0 2px 4px rgb(12 11 9 / .06), 0 8px 20px rgb(12 11 9 / .07)`  | `0 2px 4px rgb(0 0 0 / .32), 0 8px 20px rgb(0 0 0 / .28)`  | Card, panel                 |
| `shadow-lg`     | `0 4px 8px rgb(12 11 9 / .07), 0 16px 32px rgb(12 11 9 / .08)` | `0 4px 8px rgb(0 0 0 / .34), 0 16px 32px rgb(0 0 0 / .32)` | Popover, menu               |
| `shadow-dialog` | `0 8px 24px rgb(12 11 9 / .12), 0 2px 6px rgb(12 11 9 / .08)`  | `0 8px 24px rgb(0 0 0 / .44), 0 2px 6px rgb(0 0 0 / .32)`  | Dialog                      |

Dark mode carries **stronger** shadows, not weaker: a dark surface separates from a dark ground by shadow depth where a light one separates by lightness.

### 7.3 Focus

```
--vx-focus-ring: 0 0 0 2px var(--vx-surface-1), 0 0 0 4px var(--vx-fill-accent);
```

- Focus is **always visible**. `outline: none` without a replacement ring is a `pnpm lint` failure (§13).
- The ring is drawn on `:focus-visible`, so a mouse click does not ring a button, but a keyboard tab always does.
- On a danger control the ring takes the danger hue, so the keyboard user sees which button is about to be pressed.
- The two-layer ring (page colour, then accent) keeps the ring visible against **both** a page and a coloured fill without a per-context variant.

---

## 8. Motion

| Token      | Value                       | Use                                             |
| ---------- | --------------------------- | ----------------------------------------------- |
| `dur-snap` | 120 ms                      | State change on a control: press, check, switch |
| `dur-base` | 160 ms                      | Popover, menu, tooltip, tab change              |
| `dur-slow` | 200 ms                      | Dialog, drawer, page transition                 |
| `ease-out` | `cubic-bezier(.2, 0, 0, 1)` | Everything entering                             |
| `ease-in`  | `cubic-bezier(.4, 0, 1, 1)` | Everything leaving                              |

**Nothing animates that delays a keystroke.** At the register, a scan must paint its line immediately; the line may fade in, but the value is present in the same frame it is known.

`prefers-reduced-motion: reduce` and the tenant's reduce-motion setting both disable every transition. A component whose meaning depends on motion is a component that fails for those users, and is not built.

---

## 9. Direction and layout

- `<html dir="rtl" lang="ar">`. **RTL is the default, not a mode** (`SYS-01`).
- **Logical CSS properties only.** The banned list, enforced by lint: `ml-* mr-* pl-* pr-* left-* right-* text-left text-right border-l-* border-r-* rounded-l-* rounded-r-*`. The replacements: `ms-* me-* ps-* pe-* start-* end-* text-start text-end border-s-* border-e-* rounded-s-* rounded-e-*`.
- React Aria's `I18nProvider` wraps the application, so direction is **derived from the locale** rather than carried as a separate flag, and primitive **behaviour** — keyboard navigation, popover placement, slider direction — follows it, including portalled content.
- Spacing between siblings comes from the parent's `gap`, never from per-element margins.
- Wide content — tables, receipts, diagrams — scrolls inside its own container. **The page body never scrolls horizontally.**
- Icons that indicate direction (back, next, collapse) mirror with the document. Icons that depict an object (printer, box, barcode) do **not** mirror.
- **Machine text is an `ltr` island.** An identifier, a document number, a till's mark, a numbering format — anything a machine reads back — is rendered through `Code`, or typed into a field marked `isMachineText`, both of which carry `dir="ltr"` and with it `unicode-bidi: isolate`. This is not tidiness: the bidirectional algorithm resolves a bracket pair to the paragraph's direction when the paragraph is RTL and its contents are not (UAX #9, N0), so `SYS-02`'s own default format `{prefix}-{generation}-{year}-{sequence:6}` **displays as `{sequence:6}-{year}-{generation}-{prefix}`** — four islands in reverse, each reading correctly on its own because the braces mirror. Nothing warns anybody, and the person reading it is being shown a format their shop does not use. The same reordering reaches anything beginning or ending with a neutral character: `#{sequence:4}`, `/2026/0001`.

---

## 10. Component inventory

`packages/ui`, built on **React Aria Components** (`react-aria-components`) under our own component layer. **No third-party component collection is vendored.**

React Aria rather than Base UI: Base UI is still at a release candidate, and React Aria's interaction
and internationalisation machinery is deeper in exactly the places this product lives — locale-derived
direction, a number field that parses and renders Arabic-Indic digits without affecting the stored
value (§5.5), and keyboard models that are the library's reason for existing rather than an addition
to it (§11).

The **Stage 0** column marks what `packages/ui` delivers before the first screen exists. It is
deliberately **not** the whole inventory. §15 has every component arrive with the unit that needs
it, and designing the API of a component no screen has used is how a component library acquires
the wrong API — discovered at the twentieth screen, at many times the cost of the work it saved.

Stage 0 is therefore two things: the five **display contracts**, which must precede every screen
because no figure is rendered anywhere without them (§12), and the set `U04` actually needs to
put an organisation, its users and its numbering on screen. Everything else joins the inventory
in the same pull request as the unit that first needs it, built to these tokens.

| Group          | Components                                                                                                                                                                        | Stage 0                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Actions**    | Button · ButtonGroup · DropdownButton · IconButton · TextLink · Kbd                                                                                                               | Button · IconButton                              |
| **Inputs**     | TextInput · TextArea · NumberInput · MoneyInput · QuantityInput · DateInput · Select · Combobox · Checkbox · RadioGroup · Switch · SegmentedControl · SearchInput · FormatBuilder | TextInput · Select · Checkbox · Switch           |
| **Scanning**   | ScanInput — the shared scan-capture control                                                                                                                                       | `POS`                                            |
| **Overlays**   | Dialog · ConfirmationDialog · UnsavedChangesDialog · Popover · Tooltip · Toast · Drawer                                                                                           | Dialog · ConfirmationDialog · Toast · Tooltip    |
| **Layout**     | Page · PageHeader · Panel · Card · Tabs · Accordion · Splitter · Toolbar                                                                                                          | Page · PageHeader · Panel                        |
| **Data**       | DataTable (virtualised) · TreeView · TableRowActions · Badge · StatusChip · Counter · KeyValueList · EmptyState · Pagination                                                      | DataTable · TableRowActions · Badge · EmptyState |
| **Display**    | Money · Quantity · DateTime · CurrencyRate · UnitLabel — §12 · Code — §9                                                                                                          | **the five of §12**                              |
| **State**      | Banner · Spinner · Skeleton · ProgressBar · OfflineIndicator · SyncStatus                                                                                                         | Banner                                           |
| **Chrome**     | ThemeSwitch — the control for §3.2's `data-theme` axis                                                                                                                            | ThemeSwitch                                      |
| **Navigation** | SideNav · Breadcrumb · CommandPalette                                                                                                                                             | SideNav · Breadcrumb                             |
| **Charts**     | ChartContainer · ChartLegend · BarChart · LineChart — Recharts, palette from §4.8                                                                                                 | `RPT`                                            |
| **Geo**        | GeoMap · PointPicker — geometry that ships with the product, marks to §4.6                                                                                                        | `U04.7`                                          |
| **Register**   | RegisterKeypad · TenderPanel · LinePad · CustomerDisplayFrame                                                                                                                     | `POS`                                            |
| **Print**      | ReceiptPreview · DocumentHeader · LabelPreview                                                                                                                                    | `POS`, `HW`                                      |

That is **27 components**, not 56.

**A field is not a component here.** The label, the description and the error are
parts of each input rather than a wrapper a screen assembles around one, because that is what keeps
them wired together for assistive technology: React Aria owns the `aria-describedby` and
`aria-invalid` relationships between them, and a screen cannot forget to pass one. A standalone
`Field` would exist only to be given those parts by hand, which is the failure it would be there to
prevent. One arrives if a control that is not an input ever needs the same furniture — with the unit
that needs it, as §15 requires.

**Not built:** any chat, messaging, rich-text-editor, avatar-stack, media or marketing component. This is a retail system.

---

## 11. Keyboard and focus conventions

Every screen is keyboard-operable, and **the register is fully operable with no pointing device** (`POS-02`). That is not a feature of the register; it is a property of every component here.

### 11.1 Everywhere

| Key                 | Behaviour                                                                         |
| ------------------- | --------------------------------------------------------------------------------- |
| `Tab` / `Shift+Tab` | Move through interactive elements in logical (not visual) order                   |
| `Enter`             | Submit the form, or activate the focused control                                  |
| `Space`             | Toggle a checkbox, switch or button                                               |
| `Esc`               | Close the top overlay; in a field with a pending edit, revert it                  |
| `↑ ↓`               | Move within a list, menu, grid rows or a combobox                                 |
| `← →`               | Move within a row or a segmented control — **mirrored for RTL by `I18nProvider`** |
| `Home` / `End`      | First / last row or option                                                        |
| `Ctrl+K`            | Command palette                                                                   |

- Every dialog **traps** focus, moves focus to its first meaningful control on open, and **restores** focus to the trigger on close.
- Grids use a roving `tabindex`: one tab stop for the grid, arrows inside it. A 30,000-row table with 30,000 tab stops is not keyboard-operable.
- Every screen begins with a skip link to its main region.
- A control that can be reached by pointer but not by keyboard is a defect, tested by the keyboard-only Playwright journeys of §13.

### 11.2 The register

The register has **no pointer at all** in normal operation. Its shortcut map is owned by the `POS` module, is displayed on screen, and follows two rules set here:

- **No destructive action on a single unmodified key.** Voiding a line, voiding a sale and opening the drawer each require a modifier or a confirmation, because a cashier's hand rests on the keyboard.
- **Focus never leaves the scan field implicitly.** Anything that moves focus away returns it when it finishes, so the next scan lands where it belongs.

### 11.3 The pointer

The register has no pointer, but the back office is worked with one all day, and the cursor is the
only affordance a pointer user gets before committing to a click.

- **Anything that acts on a click shows `cursor: pointer`.** Buttons, icon buttons, the trigger and
  the options of a select, a checkbox, a switch, a navigation link, a row action.
- **A disabled control shows `cursor: not-allowed`**, never `pointer`. The cursor says whether the
  click will do something, so a disabled control must not promise that it will.
- **Text keeps the text cursor.** An input, a textarea and selectable prose are not actions.
- **Nothing else changes the cursor.** A panel, a row that is not itself clickable, a badge — these
  are not controls, and a hand over them teaches the user that the hand means nothing.

This is stated because the browser does not do it: `<a href>` carries a hand by default and
`<button>` does not, so a control library that says nothing ships arrows over every button. The
argument that a hand should mean "this navigates" is a real one and it is how a native desktop
application behaves — but the people using this software learned what a hand means on the web, and
a till is not the place to teach them otherwise.

---

## 12. Displaying numbers, money, quantities and dates

A displayed figure never appears without its currency or its unit, and that is enforced by components rather than by discipline. A screen does not format a figure; it renders a component.

| Component        | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<Money>`        | **Always** renders the currency alongside the amount. Never a bare symbol where SYP and USD could be confused — the ISO code is shown. Never exceeds the stored precision. `tabular-nums`. Negative amounts are rendered with a sign **and** the danger colour, never colour alone                                                                                                                                                                                                                                                                                                                                                                                      |
| `<Quantity>`     | Always renders the unit. Never exceeds the stored precision. A weight is never shown as an integer count                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `<CurrencyRate>` | Renders as units of the currency per one unit of the functional currency (`FX-04`), with the rate's date in its branch's day, and marks a rate that is not today's. The zone is not repeated beside it: a rate is always shown under the branch it belongs to                                                                                                                                                                                                                                                                                                                                                                                                           |
| `<DateTime>`     | Two kinds of date, told apart by the type of the value. A **moment** renders in the branch's timezone with the zone stated — beside a date-only value unless the caller's own context already names whose day it is (`showZone`). A **calendar day** (`LocalDate`) takes no zone at all, because it has none. A **provisional business date** (a shift opened without the store node) is marked visibly wherever it appears (`POS-01`). A date inside a **sentence** is `formatDay` or `formatMoment`, which is what this renders: ICU interpolates text, and a message split into fragments around an element has had its word order decided by whoever wrote the code |
| `<UnitLabel>`    | Resolves through the terminology layer, so a tenant's renaming applies (`SYS-08`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**No user-facing string is a literal in code.** Every label, message and unit name lives in `packages/i18n` and resolves through the terminology layer.

Rounding is **never** done for display in a way that could be mistaken for the stored value: a figure shown at lower precision than stored carries a marker and its full value on hover and in its `title`.

---

## 13. What is enforced automatically

A design system that is only described is a design system that decays. These run in `pnpm verify`:

| Check                                                                    | Enforces      | From                             |
| ------------------------------------------------------------------------ | ------------- | -------------------------------- |
| Tailwind lint: banned physical-direction utilities                       | §9            | `packages/ui`                    |
| `outline: none` without a replacement ring fails lint                    | §7.3          | `packages/ui`                    |
| Contrast test over **every** `fill`/`on` and `text`/`surface` pair in §4 | §4.6          | `packages/ui`                    |
| Token snapshot: the generated palette matches Appendix A's output        | §4.1          | `packages/ui`                    |
| String-literal check in `pnpm check:policy`                              | §12           | `packages/ui`                    |
| Keyboard-only Playwright journeys, light and dark                        | §11, `POS-02` | `packages/ui`, extended per unit |
| Touch-target check ≥ 48px on register screens                            | §6.3          | `POS`                            |
| Component tests asserting currency and unit are present                  | §12           | `packages/ui`                    |

**The contrast test is the important one.** It means a future change to a hue, the chroma profile or a surface cannot silently ship an unreadable pair: the suite fails, and the commit is stopped.

---

## Appendix A — the generator

Implemented in TypeScript in `packages/ui`, with the snapshot test of §13.

**As of §4.1, steps 1 and 2 below no longer produce §4.2 and §4.3** — those are imported literally — **but the code is unchanged and still live**: step 3 generates the chart palette of §4.8 today, exactly as described, and steps 1–2 are one function call away from producing the palette again (`generate.ts`'s `generateNeutralRamp`/`generateAccents`, both still exported), should it ever need to move without another import to anchor it to. Left here as what those functions do, not as history.

**1. Neutral ramp** (not currently the source of §4.2's values — see above). For each of the 35 stops, lightness is interpolated through these anchors, and chroma through these, both in OKLCH at hue `95°`. **Interpolation is linear**, clamped at both ends — on the stop axis for lightness, then on the resulting lightness for chroma:

```
L anchors (stop → L%):   0→100.0  50→95.2  100→90.6  200→81.0  300→71.7
                       450→57.6  500→52.8  600→43.5  700→33.5  800→24.3
                       850→19.6  900→15.0

C anchors (L% → C):    100→0.0000  99→0.0022  95→0.0048  90→0.0072  81→0.0105
                        72→0.0130  58→0.0118  53→0.0105  43→0.0085  33→0.0068
                        24→0.0052  19→0.0044  15→0.0038
```

Stop `0` is forced to `#ffffff`.

**2. Accents** (not currently the source of §4.3's values — see above). For each hue, chroma is fixed and lightness is found by **bisection over `L ∈ [12, 95]`** for the **boundary** lightness at which contrast against the stated background reaches `4.60` — a 0.1 margin over the 4.5 target, so quantising to 8 bits per channel can never drop a pair below it. The colour departs from its background only as far as the requirement forces, which is what keeps the accents vivid rather than uniformly muddy:

| Token           | Solved against    | Direction            |
| --------------- | ----------------- | -------------------- |
| `fill`          | `#ffffff`         | lightest that passes |
| `text` (light)  | `surface-1` light | lightest that passes |
| `text` (dark)   | `surface-1` dark  | darkest that passes  |
| `on-bg` (light) | `bg` light        | lightest that passes |
| `on-bg` (dark)  | `bg` dark         | darkest that passes  |

`fill-hover` is `fill` at `L − 5`. `bg` is `L = 93` light / `L = 26` dark and `border` is `L = 82` light / `L = 38` dark, both with chroma capped so a tint never competes with a fill: `bg` at **0.055** light and **0.060** dark, `border` at **0.085** light and **0.080** dark.

**3. Chart series.** Fixed `L = 58` light, `L = 74` dark, chroma `0.145`, at hues `250 · 75 · 195 · 27 · 150 · 300 · 345 · 110`.

**4. Gamut.** Any OKLCH value outside sRGB is mapped by **reducing chroma only**, by bisection, holding lightness and hue. Lightness is never altered — it is the variable carrying the contrast guarantee.

**5. Verification.** After generation, every pair in §4.6 is measured with the WCAG 2.x relative-luminance formula and asserted. **Generation without verification is not a build step; it is a guess.**

---

## 14. Open decisions

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Needed by                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 1   | The register shortcut map, owned by the `POS` module within the two constraints of §11.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `POS`                    |
| 2   | Whether `compact` needs a fourth, denser step for the stock ledger at pilot scale — to be answered from the real data, not in advance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | pilot data               |
| 3   | What an accent `border` is measured against. §4.6 sets 3:1 for chart marks, meaningful icons and control boundaries; an accent border is the edge of a tinted container and reaches 2.06:1 against the page (blue, light theme), which no stated rule forbids. To be pinned by the first component that draws one                                                                                                                                                                                                                                                                                                                                                                    | first component using it |
| 4   | Whether `border-strong`, the edge of every field, select, checkbox and switch track, is raised to clear §4.6's 3:1 for control boundaries. Imported with the palette of v1.9 and never measured, it reaches **1.57:1** in light and about **1.8:1** in dark against the page — and it is the only thing that tells a field from the panel it sits on, since `fill-field` and the surfaces are near-identical whites. **45% in light and 40% in dark** clear 3:1 on every surface; the cost is a visibly darker edge on every control. The alternative is to name it a fifth accepted exception in §4.6. `contrast.test.ts` pins the current figures until one or the other is chosen | the tenant, before `U12` |

---

## 15. Change control

This document is an **architecture-level specification**. It changes by recorded decision, and the change lands here **before** the code.

- **A colour, size, weight or duration is never edited by hand.** Colours change by changing the generator's inputs in Appendix A and regenerating; the contrast test then either passes or refuses the change.
- **A sixth accent hue is not added because a screen wants variety.** It is added when a sixth _meaning_ exists that the five cannot carry, and its meaning is written into §4.3 in the same change.
- **A component is added to §10 by the unit that needs it**, built to these tokens, in the same pull request as the unit.
- Removing a token requires naming what replaces it on every surface that used it.

### 15.1 Change log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-20 | **v1.14** — §10 gains `TreeView` in Data, making the inventory **27**, and `Tabs` and `DateInput` — named there since v1.0 and unbuilt until now — are built. All three arrive with `FIN-01`'s chart of accounts and `FIN-05`'s fiscal calendar. `TreeView` is one tab stop with arrows inside it, `←`/`→` opening and closing a branch mirrored for RTL, a row's own actions reached by the arrow that runs with the text, and the indent drawn from the level React Aria reports so that `aria-level` and the picture cannot disagree. `Tabs` is horizontal only, is given its tabs as data, and marks the tab that is on with a rule as well as with ink. `DateInput` takes and returns `LocalDate` — the product's own day, and never a calendar object — and states the day an empty field starts from rather than reading the device's clock. §12's `DateTime` now takes either kind of date, and `formatDay` and `formatMoment` write one into a sentence                                            | A chart of accounts **is** a tree, and `FIN-01` says so; drawn as an indented table it has a tab stop per account, no way to collapse a group of thirty, and nothing for a screen reader but leading spaces. `Tabs` is horizontal only because a vertical strip and `SideNav` are the same control drawn twice, and two shapes for "where am I" is one too many. `DateInput` exists rather than a text box because every parser of a typed date decides silently whether `03/04` is March or April, in a market where both conventions are in living memory — and it speaks `LocalDate` so that `@internationalized/date` stays inside the design system and a tenant reading in a Hijri locale cannot store Hijri figures as the product's day. A fiscal period opens on a **day** and not at an instant — it is not a moment that falls on different dates in different branches — so a zone on it would have been a fact the caller had to invent to satisfy a prop; and an `Instant` is a count of milliseconds, so the fiscal calendar's "closed by whom, and when" printed the count until `formatMoment` existed to write it |
| 2026-09-19 | **v1.13** — §10 gains `FormatBuilder` in Inputs and `UnsavedChangesDialog` in Overlays, each arriving with the screen that needed it: `SYS-02`'s numbering format built from cards — every mark a series must carry placed by the control, a person choosing only order, padding and the text between, the row an `ltr` island (§9) and a card moved from the keyboard announced — and `SYS-05`'s question before a link carries an unsaved edit away, with three answers where a confirmation has two. §4.7 gains `badge-neutral`. §12's `DateTime` states the zone beside a date unless the caller already names whose day it is, and `CurrencyRate` no longer repeats it. The map's zoom controls sit on the raised surface the map's search already uses                                                                                                                                                                                                                                                | Found by using the screens rather than reading them. A neutral badge was invisible on a white row. A zone name on every row of a rate board said nothing the board did not, and a dozen of them buried the rates. The zoom controls were drawn straight onto the map: dark ink vanished on the offline outlines in the dark theme, light ink on the street tiles, and no single colour reads on both — a surface of their own does. A numbering format typed as `{prefix}-{generation}-{year}-{sequence:6}` could drop the till's marks, which `SYS-02` then refused; built from cards it cannot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-17 | **v1.12** — Corrections from an audit of the built layer, none of them a new rule. §5.2's line heights now reach the text utilities (`--text-*--line-height`), where they had been emitted under a name no utility read. §4.7 gains `dialog-scrim`. Overlays move as §8 says, through React Aria's entering and exiting states. The password reveal control joins the tab order, a confirmation opens on Cancel, a breadcrumb trail is a `nav` landmark, the toast region sits outside the application as a top layer, and §5.5's numerals reach the translator and React Aria as well as the display components. §14 gains item 4                                                                                                                                                                                                                                                                                                                                                                          | Each was found by measuring or rendering rather than by reading. The line heights and the overlay motion compiled to nothing, so the interface was not the one this document describes: a 26px page title sat on a 22px line, and no overlay moved. The reveal control was excluded from the tab order against §11.1's own rule that a control a keyboard cannot reach is a defect — and the register has no pointer. A toast raised by a dialog was hidden with everything else outside it. `ar-SY` defaults to Arabic-Indic digits, so a message printed `١٢` beside money printed `12`. `border-strong` measured below §4.6's 3:1 for control boundaries; it came with the palette the tenant chose, so it is recorded as a decision rather than changed                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-09-16 | **v1.11** — §9 gains a rule for **machine text**, and §10 a `Code` in the Display group with `TextInput`’s `isMachineText` beside it, arriving with the registers and numbering screens for `SYS-02`. Anything a machine reads back — an identifier, a document number, a till’s mark, a numbering format — is an `ltr` island carrying `unicode-bidi: isolate`, the same island §9 already grants the map. Stage 0’s Display cell now names the five of §12 rather than “all”, since the group holds six                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Measured, not guessed. The bidirectional algorithm resolves a bracket pair to the paragraph’s direction when the paragraph is RTL and its contents are not (UAX #9, N0), so `SYS-02`’s own default format `{prefix}-{generation}-{year}-{sequence:6}` laid out as four islands in reverse and **displayed as `{sequence:6}-{year}-{generation}-{prefix}`**. Nothing warned: the braces mirror, so every part read correctly on its own and only their order was wrong — an accountant reading that column, or typing into that field, was shown a format the shop does not use. The rule is here rather than in a screen because it is a property of an Arabic-first interface (`SYS-01`) and not of one module’s data                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-09-16 | **v1.10** — §10 gains a **Geo** group, `GeoMap` and `PointPicker`, arriving with `U04.7` for `SYS-14`, and `Popover` joins the built inventory with them — detail that belongs beside a marker is neither a modal, which takes the screen away to say one thing, nor a tooltip, which cannot hold a link. Geography does not mirror, so the map surface is an `ltr` island inside the `rtl` document of §9 while its own controls stay logical and sit on the start edge. A map mark that carries a count is **text on a fill**, so it answers to §4.6's 4.5:1 and not to the 3:1 floor for non-text graphics — and it takes no colour from §4.8, whose green and red are reserved for profit and loss                                                                                                                                                                                                                                                                                                      |
| 2026-09-16 | **v1.9** — §4.2's neutral ramp and §4.3's five accent hues become **literal imports** from the third-party reference §4.1 already named as a methods source, at the tenant's explicit, repeated instruction, excluding that reference's own brand colour. §4.4's `on-*` splits by role (white for `accent`/`danger`, black for `success`/`warning`/`info` — no longer one rule for all five) and picks up `text-muted`, `border`, `border-strong`, `fill-primary`, `fill-primary-hover`, `fill-ghost-hover` and `on-primary` value changes to match. §4.6 records **four named pairs that fall short of the 4.5:1 target** rather than meeting it — `text-muted` (light), `fill-accent` at rest and on hover, `fill-danger` on hover. §7.1's `radius`/`radius-card` move to 2/3/4 and 4/5/6 — the corner now reads as _nearly square_ rather than _softened_ — and §7.1's pill narrows to the switch track alone: `Badge`, and the small chips in `CurrencyRate`/`DateTime`, round like every other control | A tenant review of the built screens asked for the reference's _shape_ system first (§7.1's radius, accepted) and then, separately and after seeing the tokens explained, its _colour_ system — twice confirmed at "100%" once the one exclusion (the reference's own brand colour) and the accessibility trade-off were put in front of them explicitly, numbers included. Appendix A's generator is not deleted: it still produces §4.8's chart palette, and steps 1–2 are one call away from producing §4.2/§4.3 again without another import to anchor them to. v1.0's own reasoning — "three pairs in the studied reference would have failed AA had their values been adopted directly" — is superseded here, not silently: those pairs are adopted, and named in §4.6 rather than avoided                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-15 | **v1.8** — §10's `Page` gains two chrome slots, `banner` and `nav`, and keeps the skip link the first tab stop in front of both; `TextArea` and `SearchInput` join the inventory from `U04.6`; `VertexProvider` gains `navigate`, which hands React Aria the application's own routing so a link inside the design system never reloads the document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The second, third and fourth screens arrived together, and with them the first frame: a product with one screen has no navigation to put anywhere, and one with five has nowhere else to put it. Built as slots on the page rather than as a new frame component because the skip link of §11 has to precede the chrome, and a shell assembled by each app would put its own controls in front of it — which is the one ordering no screen is allowed to get wrong. `navigate` is here for the same reason it is not in an app: `SideNav` and `BreadcrumbTrail` are React Aria links, and without a router in context every one of them is a full page load that discards the session                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-09-15 | **v1.7** — §4.5's product mark becomes a system: three layouts, an app icon, a size ladder and a clear-space rule, all derived from one statement of the geometry. §10 gains a **Chrome** group with `ThemeSwitch`, making Stage 0 twenty-five                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The mark existed and the lockups did not, so the first screen that wanted words beside the cube would have drawn its own — which is how an icon and a lockup end up a degree apart. `ThemeSwitch` was built inside the back office and is a control over an axis **this document** defines: the register and the stocktaking app want the same three states and the same cycle, and three copies of a control that knows nothing about any module is three copies that drift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-09-15 | **v1.6** — §4.5 gains the product mark: what it is, how it differs from the tenant's brand, and its two tones. `TextInput` and `Select` no longer offer `validationBehavior`, and validate through `aria` alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The first screen put "Please fill out this field." under a label reading "اسم المستخدم". Left to validate natively, the browser writes the message itself, in its own language, from strings nothing here can translate and no tenant can rename — which §12 forbids and which no amount of care in a screen can prevent, so the component stopped offering the choice. The mark was recorded at the same time because §4.5 said who the sign-in screen belongs to and never said what stands there before a tenant has supplied a brand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-09-15 | **v1.5** — §10 drops `Field` from the inventory and from Stage 0, which is now **24 components**, and states why a field is not a component here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | An audit of `U01`–`U04` counted the shipped inventory against this table and found 24 of the 25. The missing one was never built: `TextInput`, `Select`, `Checkbox` and `Switch` each carry their own label, description and error through React Aria, which owns the `aria-describedby` and `aria-invalid` relationships between them. A standalone `Field` would exist only to be handed those parts by hand, which is the mistake it would be there to prevent. This document is the authority on the interface layer, so it is corrected rather than left carrying a divergence nobody recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-09-15 | **v1.4** — §11 gains §11.3, the pointer: anything that acts on a click shows a hand, a disabled control shows `not-allowed`, text keeps the text cursor, and nothing else changes the cursor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A button showed an arrow. The browser gives an anchor with `href` a hand and a `<button>` an arrow, so a control library that says nothing about the cursor ships arrows over every button — and this document said nothing. The counter-argument, that a hand should mean "this navigates", is real and is how a native desktop application behaves; it loses because the people using this software learned what a hand means on the web, and a till is not the place to teach them otherwise                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-09-15 | **v1.3** — §4.4 gains `fill-primary-hover` and `fill-secondary-hover`; a new §4.7 populates the component-token layer that §3.1 declared and §4 had never filled, starting with the switch; the chart palette moves to §4.8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Two defects found by inspecting the built components. In the dark theme `fill-secondary` and `fill-ghost-hover` resolve to the same value, so hovering a default button did nothing at all, and the primary button faded itself with opacity — which on a near-white fill over a dark ground reads as dirt rather than as response. Separately, a switch whose track was `fill-secondary` put a white knob on a white track in the light theme and the knob vanished. Neither was a styling slip: the document had no hover fill for a neutral button, and no component tokens at all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-09-14 | **v1.2** — §10's Stage 0 narrows from all eight groups (56 components) to 25: the five display contracts plus what `U04` needs. §5.4 is resolved and §14's first open decision is closed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `@fontsource-variable/ibm-plex-sans-arabic` does not exist in the npm registry while `@fontsource-variable/ibm-plex-sans` does, so the Arabic family ships static weights only and the second compensation strategy applies. The Stage 0 reduction follows §15's own rule that a component arrives with the unit that needs it: building an API for a component no screen has used is how the API turns out wrong                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-09-14 | **v1.1** — Appendix A now states that interpolation is linear and gives the chroma caps for `bg` and `border`, both of which were unstated and left the palette unreproducible; the accent solver's direction column is reworded from "darkest passing" to the boundary it actually means. §4.4 gains `fill-accent`, `fill-success`, `fill-danger`, `fill-warning` and `fill-info` with the hue→role mapping. §9, §10 and §11 move from Base UI to React Aria Components. Six generated values are corrected: `neutral-80`, `-550`, `-810`, `-820`, `-880` and chart series 8 (light). §14 gains a fourth open decision                                                                                                                                                                                                                                                                                                                                                                                     | The generator was implemented in `packages/ui` and reproduced 95 of the 101 published values exactly, the remaining six differing by one unit in one channel. Since this document makes the generator the only permitted source of §4 and forbids editing a value by hand, the generator is authoritative and the table follows it. The unstated interpolation and caps are recorded because a palette that cannot be re-derived is a palette that will drift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-09-13 | **v1.0 approved unchanged**, after a second direction — a ruled account-book language with monospaced figures, structural currency distinction and an indigo-on-cream palette — was built and compared on the product's own screens in both themes. Nothing in this document changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The owner reviewed both directions side by side and chose this one. Recorded because "why is it not a ledger?" is a question that will be asked again, and because the alternative solved two real problems this system leaves to convention                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-09-13 | **v1.0 issued** — token architecture, generated palette with verified contrast, Arabic-derived type scale, three densities including a touch density for the register, elevation, focus, motion, direction rules, retail component inventory, keyboard conventions, display contracts, and the generator of Appendix A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The palette is generated rather than chosen so that it can be re-derived and re-verified; the touch density exists because no two-density system can serve both a 30,000-row grid and a finger on glass; every contrast pair is measured because three pairs in the studied reference (§4.1) would have failed AA had their values been adopted directly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
