# FDC design system

This is the rulebook for building or changing a Configuration screen, so new
features look and behave like the rest of FDC. FDC has one dark visual
direction; there is no light theme or theme switch.

## Sources and checks

- `overlay/tokens.css` defines every color, the fonts, the type scale, and the
  spacing rhythm. Configuration (`overlay/settings.css`) and the in-game HUD
  (`overlay/overlay.css`) load it before their own stylesheet.
- Stylesheets use tokens only. `overlay/color-tokens-guard.test.js` fails on a
  color literal or on a custom property that is defined nowhere.
- `overlay/token-contrast.test.js` keeps text and control contrast at WCAG AA
  for the token pairs the interface uses.
- `overlay/hud-design-contract.test.js` keeps the HUD geometry, cuts, and
  fonts described in "In-game HUD and Delta".
- `overlay/design-rules-guard.test.js` enforces the rules below that can be
  checked automatically: square corners, a visible focus outline, no glows,
  radial gradients, or lime gradients outside slider fills, fonts only through
  `--font-*` tokens, no texture outside the application header, no hover
  fill on disabled buttons, and no button state hover that the base button
  hover silently overrides.

## Choosing a token

- Pick a token by meaning, not by value. Two roles may share a value today
  and change independently later.
- Vehicle classes (`--class-*`), event modes (`--mode-*`), lap and Driver
  Analysis map layers (`--trace-*`, `--problem-*`), and HUD telemetry
  (`--telemetry-*`, `--hud-*`) keep their own tokens and established colors.
- A translucent variant mixes a role with transparent:
  `color-mix(in srgb, var(--accent) 14%, transparent)`.
- Add a token only for a repeated decision, and name it after its role.

## Surfaces

| Token | Use |
| --- | --- |
| `--bg` | Application background |
| `--surface-deep` | Insets, tables, inputs, chips, the navigation bar, the connection status |
| `--surface` | Ordinary cards, sections, lists, controls at rest |
| `--panel` | The raised plate: at most one per page, for the main working area or principal result; also floating menus and tooltips |
| `--surface-hover` | Hover and focus washes on rows and cards |
| `--paint` | The painted application header |

The application header is the only textured surface: it shows
`overlay/assets/textures/paint.jpg` at `--paint-texture-opacity` over
`--paint`. Cards, forms, tables, the HUD, and Delta use even fills.

## Lines and shape

- `--line-subtle`: dividers between rows and quiet card edges.
- `--line`: default card and control borders.
- `--line-strong`: emphasized edges, the header frame, raised plates, and
  switches at rest.
- Borders are 1px. Corners are square; only status dots are round.

## Text

- `--text`: normal information.
- `--text-soft`: secondary emphasis.
- `--text-muted`: supporting labels and descriptions.
- `--text-subtle`: tertiary metadata.
- `--text-faint`: placeholders, missing values, and disabled labels only.
- Capitalized labels use `--type-label` with letter spacing.

## Accent and status colors

- Lime `--accent` is for interaction: hover fills, selected tabs and choices,
  switches that are on, slider fills, and the focus outline. As text it is
  reserved for sparse ready, positive, or timing values, never decoration.
- Ready actions use `.settings-button--ready`, filled with `--accent` and
  `--text-on-accent` at rest and with `--accent-hover` on hover or focus. They
  mark the one next step: CREATE and CREATE EVENT in Events, DETAILS in
  Driver Analysis history, EDIT LAYOUT on the HUD tab and SAVE while editing
  the HUD layout, RECORD RUN on an event page, a ready RECORD in Driver
  Analysis, the safe NO or CANCEL in confirmation dialogs, and START USING
  FDC in the connection guide.
- `--best` (purple) marks best results and the learned Shift Light cue.
- `--danger` and `--danger-text` mark destructive actions and errors.
- `--caution` and `--warning` mark attention and unsaved state.
- `--notice` marks advisory hints.
- `--alert` is the redline and shift-light red.
- Within one comparison keep one meaning per color, and prefer labels and
  signs before adding another color. Color always supplements a written label.

## Typography

- `--font-ui`: Barlow 400/600 for interface text.
- `--font-readout`: Barlow Condensed 500/600 for the page title, section
  headings, the FDC brand, and prominent numeric readouts with tabular
  numerals.
- Scale: `--type-page-title` 44px (36px below 560px width),
  `--type-detail-title` 27px for drill-down titles, `--type-heading` 28px for
  section headings, `--type-body` 14px, `--type-label` 11px.
- The font files and their SIL Open Font License texts are in
  `overlay/assets/fonts/`. Windows fonts in the fallback stack cover glyphs
  Barlow lacks, such as Cyrillic in user-entered names.

## Spacing

`--space-1` to `--space-6` are 4, 8, 12, 18, 24, and 36 px.

## Pages and navigation

- The application header holds the page identity: the tab title, the tab's
  one-paragraph description in `--text` under it, and the Direct Data Out
  status, which is a button that opens the connection guide. Tab content has
  no page-level description text; keep a new tab's description to one
  paragraph of about two lines.
- The header title names the active tab. A tab's own page heading
  (`.settings-page-title`) is kept for assistive technology only, and the
  actions in its row stay right-aligned. A heading that labels a control, such
  as the Driver Analysis switch, stays visible.
- The raised plate (`--panel` with a `--line-strong` border) marks one area
  per view: the HUD layout editor, the Events create form, the event's run
  recorder, the run's lap breakdown, the Driver Analysis recorder, the Shift
  Light calibration card, and the Garage current car. The Events library,
  Driver Analysis drill-down pages, and Settings have none.
- Drill-down views (an event, a run, and the Driver Analysis recording, car,
  and drive pages) show a compact header row: the FDC brand, a back link that
  names the parent, a slash, and the page name at `--type-detail-title` in
  `--font-readout`: `← EVENTS / EVENT`, `← EVENT / RUN`,
  `← HISTORY / RECORDING`, `← RECORDING / CAR` (`← HISTORY / CAR` when the
  recording has a single car), and `← CAR / DRIVE`. The Direct Data Out status
  stays on the right; the tab title and description are hidden. The object's
  own name (event name or car) stays as the large title in the page content,
  and an event page's DELETE sits at the end of that title row. Escape goes up
  one level.
- Lap, sector, and run times and the headline metrics of runs and Driver
  Analysis pages use `--font-readout` with tabular numerals.

## Controls and states

- Buttons (`.settings-button`) rest on `--surface` with a `--line` border.
  On hover or keyboard focus they fill with `--accent` and `--text-on-accent`.
  Ready actions (`.settings-button--ready`) fill with `--accent` and
  `--text-on-accent` at rest; disabled, they look like any disabled control.
- Destructive buttons (`.settings-button--danger`) keep `--danger-text` at rest
  and fill with `--danger` and `--text-on-danger` on hover or focus.
- Disabled controls use `--surface-deep`, `--line-subtle`, and `--text-faint`,
  and get no hover fill.
- Navigation tabs and segmented choices (layout mode, units) keep a persistent
  `--accent` fill with `--text-on-accent` when selected, and expose the state
  through `aria-selected` or a checked input. Hovered tabs show an `--accent`
  border.
- Switches (`.visibility-toggle`) have a square knob: `--text-subtle` on the
  left when off, `--accent` on the right when on.
- Sliders have an 8px track filled with `--accent` (`--alert` for the redline
  setting) and a light rectangular thumb.
- Keyboard focus is a 2px `--accent` outline outside the control. Do not
  remove it with `outline: none` on `:focus-visible`. Text fields may show
  focus with an `--accent` border instead.
- Inputs, selects, and text areas rest on `--surface-deep` with a `--line`
  border and `--text`; focus turns the border `--accent`.
- Dialogs (`.confirm-dialog`) float: their content sits on `--panel` with a
  `--line-strong` border over a dark backdrop, and their title uses
  `--font-readout`. The safe answer (NO, CANCEL) uses `.settings-button--ready`
  with lime fill; the destructive answer keeps `--danger-text` and fills red
  on hover.
- A button with an extra state class still carries `.settings-button`; give
  the state rule a compound selector (for example
  `.settings-button.event-recorder__record`) so the base button rule, which
  comes later in the file, cannot override it.

## Empty, waiting, and error states

- Show a named state, such as WAITING or a specific unavailable message.
  Never show illustrative values as live telemetry.
- Use the shared `.settings-empty` pattern for empty lists.

## In-game HUD and Delta

- The HUD and Delta are dark-only and use even, untextured fills. Their
  surfaces use `--hud-panel` (and `--hud-delta-panel` while waiting or
  offline), tinted with the application's dark green and kept translucent so
  the game shows through; HUD Opacity (1-100%, default 80%) applies on top to
  the whole HUD and Delta, readings included.
- Telemetry colors keep their meanings and values: throttle and "ahead"
  `--telemetry-throttle`, brake and "behind" `--telemetry-brake`, tire
  temperature ranges, the redline red, and the learned-shift purple
  (`--hud-shift-alert`).
- Shape: in Grouped, the six blocks join into one 736 x 69 px strip with no
  gaps; only its outer top-left and bottom-right corners are cut
  (`--hud-cut-grouped`, 14 px at base scale), and `--hud-divider` lines
  separate the blocks. In Freeform, each widget is cut at its top-left and
  bottom-right corners (`--hud-cut-widget`, 7 px at base scale). Delta uses
  the same 7 px cut, scaled with its own size, and keeps its full-width strip.
- Cuts scale with the HUD and never clip the layout editor: frames, resize
  handles, and edit tools sit outside the clipped surface.
- Type: Barlow Condensed (`--font-readout`) for speed, gear, RPM, engine
  values, tire temperatures, and Delta times; Barlow (`--font-ui`) for labels.
  The HUD preloads its fonts so the first frame does not use a fallback font.
- The block composition does not change: Tires with four temperatures and tire
  shapes, vertical Brake and Throttle bars, the Steering wheel, one
  Speed/Gear/RPM block, Engine (boost, power, torque), and the Input Graph;
  Delta is a separate target.
- Configuration's HUD layout uses three blocks below HUD OPACITY. ARRANGEMENT
  is a card like HUD DISPLAY and HUD OPACITY, with a segmented choice of
  GROUPED (moves the HUD as one block) or FREEFORM (moves and resizes each
  block individually) whose selected option keeps a lime fill. The layout
  editor is the page's raised plate and an action panel (`.action-panel`)
  that shares its styles with the Driver Analysis recorder: EDIT THE LAYOUT
  with RESET LAYOUT (caution) and EDIT LAYOUT, or EDITING with CANCEL and
  SAVE; and IN-GAME EDIT HOTKEY with the hotkey and CHANGE. WIDGETS is a
  card of compact name-and-switch rows with ALL in its header. Text and
  controls of all three blocks line up on the same left and right edges.
- The layout editor shows an edit toolbar on the selected target with the
  hint text `DRAG <TARGET> TO MOVE · CORNER TO RESIZE · CLICK A BLOCK TO
  SELECT`, then GRID ON (filled with lime) or GRID OFF (neutral), RESET
  (restores the selected target's default placement, styled with `--caution`
  text and border, fills `--caution` on hover), CANCEL (neutral dark, fills
  lime on hover), and SAVE (filled with lime at rest). While the grid is on,
  an alignment grid of thin lines and dots sits under the HUD.

## Checklist for a new screen or feature

- Uses existing tokens and components; no color literals.
- At most one raised plate (`--panel`) per page.
- Lime only for interaction or meaningful positive values.
- Titles, headings, and readouts follow the type scale and fonts above.
- Empty, waiting or offline, loading, disabled, hover, focus, and error states
  are styled.
- Works at the Configuration window's default 820x620 and minimum 460x560
  without horizontal scrolling.
- The full Node test suite passes, including the guard and contrast tests.
