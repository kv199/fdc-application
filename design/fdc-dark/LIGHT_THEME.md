# FDC Light — Configuration token proposal

This is a design proposal for the Configuration window. It is not an
implemented app theme. The exact candidate values and a specimen are in
[`light-theme.css`](light-theme.css) and the `foundation-light` board. The
implemented FDC Dark values remain in `overlay/tokens.css`.

## Boundary

- The painted masthead keeps its current texture, colors, and light text.
- Only the Configuration work area, navigation, cards, forms, tables, dialogs,
  and controls gain light roles. The HUD settings page belongs to this window.
- The in-game HUD and Delta keep their current dark palette, opacity, font,
  geometry, telemetry colors, and shift cues. Their document must not inherit
  the light role overrides.
- Typography, spacing, square corners, content hierarchy, and the one-raised-
  plate-per-view rule stay the same.

## Light roles

| Role | Candidate | Use |
| --- | --- | --- |
| `--bg` | `#f1f3ee` | Configuration canvas |
| `--surface-deep` | `#e5e9e2` | Navigation, table, inputs, inset |
| `--surface` | `#fafbf8` | Ordinary cards |
| `--panel` | `#e8ede5` | One principal working area |
| `--surface-hover` | `#e8eedc` | Row and card hover wash |
| `--line-subtle` / `--line` / `--line-strong` | `#d5dbd2` / `#b7c2b6` / `#829184` | Dividers, controls, emphasized edges |
| `--text` / `--text-soft` | `#1b241d` / `#364238` | Primary and secondary reading |
| `--text-muted` / `--text-subtle` | `#566357` / `#68756a` | Supporting copy and metadata |
| `--text-faint` | `#89938b` | Disabled and missing values only |

The other proposed role values (`--shade-*`, meter, shadow, bright text, line
light, and map roles) are declared in `light-theme.css`; that file is the exact
source.

## Events and Driver maps

The [`foundation-light-maps`](index.html?board=foundation-light-maps) board puts
current dark and proposed light treatments one after the other. Both use the
same schematic recorded-route geometry and values. The light map sits on
`--map-canvas: #e5e9e2` inside an ordinary `--surface` card. Its neutral
`--map-track: #b7c2b6` route matches the existing `--line` role and separates
the route from green `--map-throttle: #446b24`. Map-only colors retain the established
meaning of throttle, brake, coast, slip, problem types, and clean checks.
They do not redefine the existing `--trace-*`, `--problem-*`, telemetry, or
HUD tokens. The proposal has no basemap or track identity.

The current bright throttle, slip, and problem colors contrast poorly with
`--map-canvas` (roughly 1.3–2.4:1). The proposed semantic stroke colors have
at least 3.9:1 contrast against that field. The neutral route is intentionally
quieter; its 13 px line remains legible as geometry and is distinct from the
green throttle stroke. Route and sector labels stay visible when overlays are
hidden. Layer switches and the selected Driver problem use border, contour,
and weight as well as color.

Each map has a point inspector at its right edge, stretching to the full map
height. It is visible on arrival with an illustrative saved point selected.
Hovering the map changes the nearest fixture point in the inspector; leaving
the map keeps the last selection. Numbered point buttons offer keyboard
selection. The panel carries the recorded telemetry and per-wheel values;
Driver adds check details when the selected point belongs to a problem. No
cursor-following tooltip appears. For implementation, bind the panel to the
nearest actual saved trace point, preserve missing-field states for older
recordings, and keep it usable when the layout stacks at narrow widths.

## Interaction and meaning

- Keep the existing FDC lime fills: `--accent: #c3ed83`, hover `#d5f6a6`,
  pressed `#b2df6c`, with dark `--text-on-accent: #162314`. The selected
  tab and one ready action stay filled; ordinary actions fill on hover.
- Pale lime is not a readable text color or a strong focus outline on a light
  surface. Use `--accent-ink: #446b24` for green text and
  `--focus-ring: #557a2c` for the 2 px focus outline. This requires dedicated
  selectors when the light theme is implemented; replacing values alone is
  insufficient.
- Destructive text and hover fill use `--danger: #a51d16` with white text on
  the fill. Best/learned cues in Configuration use `--best: #6b3f91`;
  attention uses `--warning: #765a0a`; advisory text uses
  `--notice: #8a4d17`. The HUD redline `--alert` is unchanged.
- Vehicle class and event mode fills retain their established hues. Class
  badge text uses dark `--text-on-class: #0c150e`, except S2 blue, which uses
  white `--text-on-class-s2`. Event mode badges retain their dark text role.
  Text on any other semantic fill must be checked in context before rollout.

## Contrast checks for the proposal

On `--surface`, normal text is 15.36:1, supporting text 6.09:1, fine metadata
4.66:1, green text 5.99:1, focus ring 4.81:1, red text 7.25:1, and purple
text 7.37:1. Disabled `--text-faint` is 3.06:1 and is reserved for unavailable
content. Dark text on the lime fill is 11.97:1. S2 uses white text; the other
class examples use dark text. These checks cover token pairs, not every final
component or overlay state.

## Implementation handoff

Keep these overrides scoped to the Configuration document, for example to a
class on its `body`. Do not change the shared `:root` dark defaults in
`overlay/tokens.css`, because the HUD document consumes them. Restore the
dark text, inset, and status roles within the painted masthead. Set the
Configuration document's native `color-scheme` to light when the theme is
actually implemented. The theme choice and persistence behavior remain a
separate product decision.
