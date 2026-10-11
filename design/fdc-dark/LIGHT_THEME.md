# FDC Light — approved Configuration revision

This book records the approved direction for the next light-theme revision:
keep the light outer canvas, use neutral grey panels and fields, and add a
light painted masthead with dark text. The specimen is on the
[`foundation-light`](index.html?board=foundation-light) board; exact candidate
values are in [`light-theme.css`](light-theme.css). This revision has not been
implemented in FDC. The book's runtime references remain authoritative for
existing behavior.

## Boundary and material

- Configuration, including its HUD settings page, uses these roles.
- The masthead uses [`textures/paint-light.jpg`](textures/paint-light.jpg),
  centered with `cover`, at 90% opacity over `#c9ccca`. Its type and status
  text are dark. The generated [source PNG](textures/paint-light-source.png)
  is preserved at 1536 × 1024; the JPEG is a compact encoding of that image.
- The texture is fine-grained neutral grey matte paint without a green tint.
  It belongs only in the masthead. Cards, fields and maps stay flat.
- The in-game HUD and Delta keep their existing dark palette, opacity,
  telemetry and shift cues. The Configuration overrides must not reach them.
- Keep the existing typography, spacing, square corners, content hierarchy
  and one principal raised working area per view.

## Surface and reading roles

| Role | Candidate | Use |
| --- | --- | --- |
| `--bg` | `#f1f3ee` | Light outer canvas, retained from the previous proposal |
| `--surface` | `#d8d9d8` | Neutral grey cards |
| `--panel` | `#cccecc` | Principal working area and selected fill |
| `--surface-deep` | `#c2c5c3` | Navigation, fields and table inset |
| `--surface-hover` | `#cccecc` | Neutral hover wash |
| `--line-subtle` / `--line` / `--line-strong` | `#afb5b1` / `#8c948f` / `#65716a` | Dividers, ordinary edges, strong edges |
| `--text` / `--text-soft` | `#262a28` / `#3c4440` | Primary and secondary reading |
| `--text-muted` / `--text-subtle` | `#4b5450` / `#4b5450` | Supporting labels and fine metadata at full opacity |
| `--text-faint` | `#6a736e` | Disabled and unavailable content only |

The large light background remains familiar; the denser working surfaces are
darker and neutral. Do not apply a green wash to cards or fields. Supporting
labels must remain readable on the darkest inset, including POINT DATA.

## Actions and states

- Lime is an accent for selected tabs, ready actions and selected controls:
  `--accent: #9fac88`, hover `#adb996`, pressed `#8e9e78`, with dark
  `--text-on-accent: #162314`. This muted lime applies to toggle thumbs,
  selected options, tabs and ready actions, including EDIT LAYOUT. Keep a
  visible dark edge; do not restore a brighter lime for the main action.
- Range progress uses `--range-fill: #8e9e78` against `--meter-track`, with
  a dark `--text` thumb. Fill follows the value as the control moves.
  Off toggles use `--text-muted` on the same neutral inset. Shape, position,
  focus and semantic meaning remain consistent with the dark theme.
- The [interactive control specimen](index.html?board=foundation-light#light-controls)
  shows opacity, arrangement, EDIT LAYOUT and widget toggles. These are local
  demonstrations and never modify FDC preferences or HUD visibility.
- `--accent-ink: #365829` is the readable green text and focus role. Pale
  `--accent-soft` is a fill only, never a text color for a success or clean
  state. A light-theme implementation needs role-specific selectors.
- Use `--danger: #981f19` with white text on destructive fills;
  `--best: #62407f`, `--warning: #614806` and `--notice: #774619` provide
  readable Configuration status text. Their HUD counterparts are unchanged.
- Keep vehicle class and event mode hue meanings. Class badge text uses the
  existing dark text role except S2, which uses white. Check semantic fills
  in their actual components before rollout.
- Selected states use both a fill and a strong border. Hidden map layers
  retain full-opacity labels; use a hollow swatch to show their state.

## Events and Driver maps

The [`foundation-light-maps`](index.html?board=foundation-light-maps) board
compares dark and revised light treatments with the same schematic geometry
and illustrative point values. It is a design fixture, not a recorded drive,
basemap, identified track, ideal line or assessment of real driving.

| Map role | Candidate |
| --- | --- |
| Canvas / neutral route | `#d1d3d1` / `#5a645e` |
| Throttle / brake / coast / slip | `#355d27` / `#981f19` / `#73530e` / `#176575` |
| Front scrub / exit wheelspin | `#92501e` / `#943568` |
| Brake + steering / abrupt release | `#464e9b` / `#6e488b` |
| Clean check | `#58645c` |

Use these as map-only inks; do not redefine the HUD's telemetry or problem
colors. The neutral route must remain visible when semantic layers are off.
Use `vector-effect: non-scaling-stroke` so SVG geometry scaling does not
shrink the contour: route 2.4 px, pedal trace 3 px, problem segment 6 px,
selected casing 10 px, slip band 9 px and sector ticks 2 px. These are screen
pixels. Markers also keep screen radii: clean 4.5 px, start 4 px, cursor 6 px.
Clean markers and active traces use full opacity. The selected casing and
distinct markers reinforce color meaning.

Both maps have a persistent point inspector beside the route, spanning the
map height. It starts on a fixture point, follows hover or numbered keyboard
selection, and keeps the last point when the pointer leaves. Driver adds
check details for relevant points. Narrow layouts stack the inspector below
the map without covering the route. The eventual implementation must bind
this to actual saved trace points and preserve missing-field states for
older recordings.

## Verification and handoff

The book verifier checks links, assets, named tokens and the approved neutral
route role. Review the Configuration and map boards at desktop and narrow
widths, with semantic layers both on and off. Contrast checks must include
inset labels, header status, disabled-layer labels and markers, as well as
ordinary text. Token-pair checks alone do not cover opacity or SVG scaling.

Scope future overrides to the Configuration document and set its native
`color-scheme` to light. Keep the shared dark defaults used by the HUD.
Runtime preferences and persistence retain their existing behavior. This
book update changes no application files and requires no FDC rebuild.
