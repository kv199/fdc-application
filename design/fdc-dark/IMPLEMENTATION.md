# FDC Dark implementation handoff

This is a design proposal for a later implementation task. The tracked source
lives in `design/fdc-dark/`; `outputs/fdc-design-book/` is a local preview
copy and is ignored by Git. A new worktree or clone must use the tracked source.
The application runtime has not been changed by this design work.

## Read the source in this order

1. `README.md` records scope, materials, fonts, and HUD constraints.
2. `index.html` opens the 16 application boards and five reference boards.
3. `style-spec.js` renders the Exact style specification board.
4. `design-system.css` defines the proposed tokens and the latest component
   overrides. It is loaded **after** `book.css`.
5. `book.css` supplies artboard and general specimen layout. It contains some
   earlier rules; later rules in `design-system.css` win in the rendered book.
6. `screens.js` supplies the baseline fixtures. `screens-current.js` replaces
   the agreed HUD, Driver, and Events specimens and adds their new boards.
   The rendered board is authoritative for the proposal when these differ.
7. Current runtime code and the relevant feature guides are authoritative for
   behavior, persistence, data, and labels. This book contains illustrative
   values and no live telemetry.

Do not copy either stylesheet wholesale into the runtime. The book's `.app`,
`.panel`, `.hud-spec-*`, and other selectors style mock markup, while the live
Configuration and overlay use different markup and state classes. Translate
the visual rules into those existing components and preserve their behavior.

## Fixed visual decisions

- One dark application direction. Do not add a light theme or theme switch.
- Barlow Regular/Semibold handles UI text; Barlow Condensed Medium/Semibold
  handles headings and prominent readouts. The CSS family alias `Condensed`
  means Barlow Condensed. Bundle the four local font files with both OFL
  notices. The current UI is English/Latin; Cyrillic coverage is undecided.
- The supplied `paint.png` texture appears on the Configuration masthead only
  at `--wear: .9`; ordinary cards, forms, tables, the in-game HUD, and Delta
  use even dark fills. The material reference board is a specimen exception.
- App background `#101715`, ordinary surface `#1e2a22`, raised plate
  `#2c3b2f`, warm white text `#edf0df`. Use the exact tokens in
  `design-system.css` for all other colors, type, spacing, and HUD geometry.
- Top-level titles are 44 px. Driver and Events detail views use a compact
  27 px title and an immediate-parent link.
- A raised olive plate identifies the main working area or principal result.
  Supporting metrics and details use ordinary panels. Preserve a sparse accent
  hierarchy: painted masthead for identity, lime for interactions and selected
  states, white for normal information, muted green-grey for support.
- Ordinary action buttons are dark at rest and gain lime fill with dark text
  on hover. Primary buttons have a stronger resting border. Destructive
  buttons keep red text at rest and gain red fill with dark text on hover.
  Disabled buttons do not gain a hover fill. Selected navigation and segmented
  choices stay visibly selected without hover. Keyboard focus stays visible.
- Lime text is limited to meaningful ready/positive/timing states. Purple
  marks best results and the learned Shift Light cue. Event mode, vehicle
  class, telemetry, and map colors retain their existing semantic maps. Within
  one comparison, use labels or signs before assigning another color.
- Garage presents vehicle data without an image slot or placeholder. Remove
  decorative ring/screw marks from the proposed UI.

### In-game HUD is a fixed design constraint

The in-game HUD is dark-only. Keep its current colors, Barlow/Barlow Condensed
typography, data composition, and no paint texture. The six areas are Tires,
vertical Brake/Throttle, Steering, one Speed/Gear/RPM block, Engine/Boost, and
Input Graph; Delta remains a separate target. Freeform gives each widget and
Delta a top-left and bottom-right cut. Grouped joins the six areas into one
736 x 69 px strip with zero gaps and only two outer cuts. The whole HUD and
Delta, including readings and dark surfaces, use the existing 1-100% opacity
setting (80% default). Do not split the gear data or make pedals horizontal.

## Board-to-runtime map

| Design boards | Runtime area to restyle | Behavior to preserve |
| --- | --- | --- |
| `hud-config` | `overlay/settings.html` `#hud-panel`; `overlay/settings.css`; `overlay/settings.js` | Grouped/Freeform, visibility, edit, scale, placement, opacity |
| `hud-live`, `hud-freeform`, `hud-states` | `overlay/index.html`; `overlay/overlay.css`; `overlay/overlay.js`; HUD layout and preference modules | `queueTelemetry`, six blocks, separate Delta, shift states, click-through/edit behavior |
| `driver-list`, `driver-recording`, `driver-detail`, `driver-drive` | `#driver-analysis-panel`; `overlay/settings.css`; `overlay/settings.js`; Driver history/map modules | Asphalt-only, multi-car recording and drive lifecycle, zero-reference findings, current hotkey `Ctrl+Shift+F9` |
| `shift-light` | `#shift-light-panel`; `overlay/settings.css`; Shift Light settings/runtime modules | Existing learner states, gear-pair targets, local persistence, red/purple cue meanings |
| `garage` | `#garage-panel`; `overlay/settings.css`; `overlay/settings.js`; `overlay/garage-runtime.js` | Numeric car and variant identity, saved names, latest ordering; remove visual image placeholders only |
| `events-library`, `events-create`, `events-detail`, `events-run`, `events-map` | `#events-panel`; `overlay/settings.css`; `overlay/settings.js`; Events recorder/map modules | Sorting, create/discard flow, recording, runs/laps, comparison colors, map layers and recorded-value hover |
| `settings` | `#settings-panel`; `overlay/settings.css`; `overlay/settings.js`; `overlay/display-preferences.js` | Always-on-top, telemetry visibility, speed and distance unit choices |

The common masthead, tab bar, footer, form controls, buttons, panels, and
status/empty states map to `overlay/settings.html`, `overlay/settings.css`, and
the DOM created by `overlay/settings.js`. The book's Events Create board shows
the creation area as a focused specimen; the runtime currently opens it inside
the Events tab. The Events Map board enlarges the expanded lap map; it does not
require a new route. Likewise, artboard size is a review canvas, not an app
window-size contract. The HUD dimensions above are deliberate physical values.

## Implementation acceptance

1. Review every board in the book and its corresponding live view at the
   supported Windows window sizes. Preserve empty, waiting/offline, loading,
   recording, disabled, selected, hover, focus, and error states even when a
   board shows only a representative fixture.
2. Keep functional flows and data ownership intact. Do not invent telemetry,
   track identity, ideal-line guidance, driving scores, exact time loss,
   external services, or new persistence.
3. Keep class/mode/result meanings and the current unit conversions. Use real
   runtime data where the app has it; never ship the book's fixture values or
   schematic map as recorded data.
4. Verify the in-game HUD at Grouped and Freeform layouts, normal/redline/
   learned-shift states, hidden widgets, Delta, opacity, and edit mode.
5. Follow the repository's `AGENTS.md` for branch, version, changelog, test,
   build, and commit requirements when runtime implementation begins. Update
   current-behavior docs only after behavior is implemented.

The book's `reference/` files and `canvas.json` are local review/export
material and are not part of the tracked source package.
