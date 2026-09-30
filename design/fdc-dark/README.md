# FDC design book — FDC Dark · Proposal 04

An isolated HTML design proposal. Open `index.html` directly. The local
`outputs/` preview also has an optional `serve.cjs` helper. The overview links
to full-size boards. All assets and fonts are local. No connection to
telemetry, SQLite, or the running application.

The versioned source for a future implementation agent is `design/fdc-dark/`.
The `outputs/fdc-design-book/` preview is local and ignored by Git. Read
`IMPLEMENTATION.md` for source precedence, design rules, the board-to-runtime
map, and implementation acceptance. The tracked source does not include the
local `serve.cjs` helper, `reference/` material, or generated `canvas.json`.
Run `node design/fdc-dark/verify.cjs` from the repository root to check boards,
links, assets, and values without generating files.

## Scope and evidence

Sixteen application boards cover HUD configuration, Grouped and Freeform geometry, shift states, Driver history/recording/car/drive pages, Shift Light, Garage, Events library/create/detail/run/map, and Settings. Five supporting boards cover an exact style specification, materials, typography, component states, and migration rules. Use **Exact style specification** in the overview for the agreed values and `design-system.css` for their CSS definitions.

The second overview group contains design references, not extra FDC screens: **App finish & HUD surface** explains where texture appears; **Fonts & readouts** shows the two selected font families; **Screen map & design rules** links to the covered app areas and records behavior to retain. The Garage proposal uses text, badges and variant rows without vehicle image slots.

Sources: user-supplied FDC screenshots; current overlay/index.html, overlay/overlay.css, overlay/settings.html and overlay/settings.js; HUD, Garage, Driver Analysis and Events behavior documentation; an earlier read-only view of the Driver Analysis release window. Populated states and telemetry are illustrative fixtures, not current user data. Both map paths are schematic, not recorded routes or track identities.

The presentation borrows the artboard overview / foundations / component inventory format from https://github.com/primo-browser/design-book. All FDC boards are proposed, not implemented runtime changes. Controls demonstrate local appearance; Record, Delete, Reset, Create and Change actions do not act on real data. Map legend buttons demonstrate selected states; the schematic paths do not change.

## Fonts

Barlow and Barlow Condensed are the two selected families for UI text, headings and numeric readouts, including the agreed HUD. These are not identified as Porsche's instrument typeface. Four unmodified font files are bundled with their SIL Open Font License notices in fonts/. OFL permits bundling with commercial software subject to its conditions; preserve the copyright and license notices. See https://openfontlicense.org/ofl-faq/ and the included licenses. This proposal uses English/Latin UI; Cyrillic coverage is not established.

## Material and color

The B texture remains at 0.90 opacity on the application header only; the material reference page shows it as a sample. Ordinary cards, forms and tables have even dark fills. The in-game HUD and Delta have no paint texture: their flat dark backgrounds and readings share the existing HUD opacity setting (1–100%, default 80%). Warm white, muted green paint, dark instrument surfaces and lime interaction states establish the application palette. The exact style page distinguishes Configuration accents from the current in-game throttle, brake, tire and Delta colors. Event mode, vehicle-class and Driver Analysis map colors retain their meanings.

The app background remains `#101715`; ordinary surfaces are `#1e2a22` and raised panels `#2c3b2f`. Top-level page headers use a 44 px title. Driver and Events detail pages use a compact 27 px title with a link to the immediate parent. Repeated surface, border and hover colors are defined in `design-system.css`. In the interaction trial, primary and secondary action buttons gain lime fill with dark text on hover; destructive buttons gain red fill with dark text. Their resting styles still distinguish primary, secondary and destructive actions. Selected navigation and segmented choices remain visibly selected without hover; keyboard focus keeps its lime outline. This book contains one dark application direction; no theme switch or light palette is proposed.

Use a raised olive plate for the main working area or principal result; put supporting metrics and details on ordinary surfaces. Keep lime text sparse for ready states, positive results and meaningful timing values. Purple means best or the learned Shift Light cue. Within each data context, preserve one stable meaning per semantic color rather than introducing a new color for every comparison. The Settings board includes the current speed and distance unit choices. The top-level navigation follows the current Configuration order: HUD, Events, Driver, Shift Light, Garage, Settings.

## HUD geometry contract

The in-game data arrangement follows the current six HUD blocks. Tires retain four temperatures and their tire shapes. Brake and throttle remain vertical bars. Steering remains a wheel. Speed, gear and RPM remain one block and preserve their redline and learned shift states. Engine/Boost keeps boost, power and torque; Input Graph keeps pedal history. Delta remains a separate target. In Freeform, each widget and Delta has a top-left and bottom-right cut. Grouped joins all six data areas into one 736 × 69 px dark strip with no internal gaps or cuts; only the top-left and bottom-right corners of the entire strip are cut. The local opacity sliders on the HUD boards preview the same opacity on backgrounds and readings.

The style guide uses `design-system.css` as the token source. `book.css` contains legacy and general layout rules. `screens-current.js` applies the updated HUD and post-September-23 Driver and Events proposal boards over the original fixture set; `style-spec.js` adds the exact style page.

The files in this export are separate from FDC runtime. They do not change its version, persistence, telemetry contracts, or installed executable.
