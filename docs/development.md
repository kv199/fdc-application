# Development

## Branches

Day-to-day work happens on the `develop` branch. The `main` branch holds the
latest released source and changes only by fast-forwarding to `develop`. See [Releasing FDC](releasing.md)
for versioning and the release procedure.

The CI workflow (`.github/workflows/ci.yml`) runs the Node tests, Cargo format
check, and release Rust tests for pushes to `main` and `develop` and for pull
requests.

## Repository layout

The repository is organized around the current runtime boundaries:

```text
src-tauri/                 Native Tauri runtime and Direct Data Out decoder
overlay/                   Static browser HUD and feature runtime modules
src/shift-light/           Canonical Shift Light TypeScript source
tools/                     Build, release notes, diagnostic, and integrity test tooling
docs/                      Current architecture and feature documentation
```

## Install dependencies

Install JavaScript dependencies before working on the browser or Shift Light code:

```powershell
npm ci
```

Run `npm ci` only when dependencies are not installed or dependency manifests
have changed. It is not required for every task.

## Browser demo

The overlay can be previewed without Forza by serving the `overlay/` directory
with a local static HTTP server and opening:

```text
http://127.0.0.1:8765/index.html?demo=1
```

Use `?demo=1&signal=shift` to preview the Shift Light state.

Demo mode is for offline visual checks. Omit `demo=1` when checking live
telemetry in the native application.

## Rebuild Shift Light bundle

When changing Shift Light source, rebuild the checked-in browser bundle before
running the application:

```powershell
npm run build:shift-light
```

The canonical Shift Light TypeScript source lives in `src/shift-light/`. The
generated runtime bundle is at `overlay/shift-light-engine.js`. Verify the
generated output uses the canonical source labels and contains no obsolete
source paths. Runtime behavior and compatibility contracts must remain unchanged.

## Tire slip report

`tools/slip-report.mjs` reads saved Driver Analysis recordings from an
`fdc.sqlite` file read-only and prints tire slip statistics. It requires
Node.js with the built-in `node:sqlite` module. Slip values are printed as
absolute values times 100%, the scale of the in-game tire friction telemetry.

```powershell
node tools/slip-report.mjs --db path\to\fdc.sqlite
```

For every recording, the report shows the stored `CORNERS` tire shares, the
share of moving time (20 km/h or more) in which the front axle, the rear axle,
or any wheel is above 100% combined slip, the number and length of any-wheel
episodes above 100%, axle slip percentiles, and lateral acceleration grouped
by front axle combined slip. `--db` defaults to `%APPDATA%\FDC\fdc.sqlite`, and
`--session <id>` limits the report to one recording.

To compare a recording with a screen capture of the in-game telemetry, pass
local clock times with `--at`:

```powershell
node tools/slip-report.mjs --db path\to\fdc.sqlite --at 10:24:38,10:24:42
```

Each time selects one second of the newest recording, or of `--session`, using
the recording start time plus the telemetry time since its first sample. For
each wheel, the report prints slip angle, slip ratio, and combined slip in the
middle of that second and the maximum within it.

## Driver Analysis replay

`tools/replay-driver-analysis.mjs` replays saved Driver Analysis recordings
through the current analysis and compares the result with what was saved. It
reads a file saved with `EXPORT` or an `fdc.sqlite` file read-only, writes
nothing, and requires Node.js with the built-in `node:sqlite` module.

```powershell
node tools/replay-driver-analysis.mjs path\to\fdc-driver-analysis-20261002-1830.json.gz
node tools/replay-driver-analysis.mjs --db path\to\fdc.sqlite --recording 3
```

Without `--recording`, every recording in the database is replayed. `--json`
prints the full comparison instead of the text report. The tool rejects files
whose `format` or `formatVersion` it does not support.

For each car, the report compares four sections. `opportunities` and `result`
must reproduce exactly; a difference is reported as `DIFF` and makes the tool
exit with code 1. Evidence numbers and statistics can differ slightly, for
example because telemetry interruptions that reset the live analysis are not
stored. Such differences are reported as `DEVIATION` with their count, the
largest relative difference, and an example, and do not fail the car. Invalid
input
exits with code 2. When a car was recorded with another analysis version, the
report says so; replay the file with the release that recorded it for an exact
comparison.

## Shift Lab replay

`tools/shift-lab.mjs` replays the drives FDC recorded in `fdc-lab.sqlite`
through the current Shift Light bundle. It opens its inputs read-only, writes
only the `--out` file, and requires Node.js with the built-in `node:sqlite`
module. See [Shift Lab recording](shift-light.md#shift-lab-recording) for what
is recorded and what the report contains.

Close FDC, copy `fdc-lab.sqlite` and, for the game comparison, `fdc.sqlite`
from the FDC application-data directory, and run the tool on the copies:

```powershell
node tools/shift-lab.mjs --lab path\to\fdc-lab.sqlite --fdc path\to\fdc.sqlite
node tools/shift-lab.mjs --lab path\to\fdc-lab.sqlite --session 4 --json --out shift-lab.json
```

Without `--session`, every session is replayed. `--json` prints the full
result instead of the text report. `--fdc` is optional; without it the report
shows only the replay and the reference.

`tools/shift-lab-decoder.mjs` turns a raw packet into the payload the HUD
receives, including its `f32` rounding. A Rust test and a Node test decode the
synthetic packet in `tools/shift-lab-decoder-golden.json` and must both
produce its `expected` payload.

### Shift Lab fixtures

A fixture is one car's drives from a recording, cut down to the fields Shift
Light and the reference read, with no map position. It is a regression test
for drives that once exposed a bug:

```powershell
node tools/shift-lab.mjs --lab path\to\fdc-lab.sqlite --car fh6:3363:4:800:2:10 --fixture tools\shift-lab-fixtures\skyline-v10-awd-limiter.json.gz
```

`--car` is required when the selection holds more than one car; `--session`
narrows it further. Next to the fixture, write `<name>.expect.json` by hand.
Every key is optional:

```json
{ "description": "What the drives show",
  "usableCeilingRpm": [9450, 9550],
  "minCeilingSampleRpm": 9000,
  "minLearnedShiftRpm": 9400,
  "pairs": { "4->5": "learning" },
  "minAcceptedShifts": 5,
  "referenceRpm": { "2->3": [7200, 7700] },
  "shiftAtRpm": { "2->3": [7200, 7700] } }
```

`usableCeilingRpm` bounds the learned ceiling, `minCeilingSampleRpm` is the
lowest RPM any kept limiter observation may have, `minLearnedShiftRpm` is the
lowest RPM any `POTENTIAL` or `OPTIMAL` pair may have, `pairs` sets exact
pair states, `minAcceptedShifts` is the fewest compared upshifts, and
`referenceRpm` requires a reference `crossover` within the range for each
listed pair, and `shiftAtRpm` bounds the shift point the replayed Shift Light
ends with for each listed pair. `tools/shift-lab-fixtures.test.mjs` replays every fixture that has
an expectation file through the current bundle as part of the Node suite and
lists every failed expectation.

`tools/shift-lab-fixtures/` is in `.gitignore`: recordings and fixtures made
from them stay on the developer's computer and are never committed. Without
fixtures, as in CI, the test file reports one skipped test.

## Tests that read source code

`tools/test-sources.cjs` returns source text without naming the file that holds
the code. Its exports are `readRustSources()` (every file under
`src-tauri/src`, recursively), `readPageScripts(htmlFileName)` (the local
scripts an `overlay/` page loads, in document order; a missing one throws),
`readConfigurationScripts()` and `readHudScripts()` (the same for
`settings.html` and `index.html`), `registeredTauriCommands()` (the names in
`tauri::generate_handler![...]`), and `invokedTauriCommands()` (the command
names that runtime JavaScript passes to its invoke wrappers, without plugin
commands). New tests that inspect source text read it through these helpers,
so moving code between the Configuration tab modules or the Rust modules does
not break them. Some existing tests still read a single file directly, such as
`overlay/hud-layout.test.js` and `overlay/theme-boot.test.js`; switch them to a
helper when that file is split.

Prefer behavior tests that call a module's exported functions. Text assertions
are for contracts that survive a refactor: visible text, CSS classes and ids,
command names and argument keys, event names, and storage keys. Do not assert
internal names or statement shapes.

`overlay/configuration-extraction-backlog.test.js` lists Configuration rules
that still live inside DOM code and can only be checked against the script
text. When a rule's logic moves into a testable function, replace its entry
with a behavior test of that module. The file is meant to shrink to nothing.

`overlay/tauri-command-contract.test.js` requires every command that runtime
JavaScript invokes to be registered in `tauri::generate_handler!`, and every
registered command to have a JavaScript caller. `NOT_INVOKED_FROM_JS` maps
justified exceptions to a reason; it is currently empty.

`.gitattributes` checks out every text file with LF on every platform,
including the Windows CI runner, so a test may match `\n`. A test that reads a
file directly should still normalize `\r\n`, as `tools/test-sources.cjs` and
`overlay/configuration-events.test.js` do.

## Configuration UI conventions

Each Configuration tab starts with a `settings-page-title` heading. Its
one-paragraph introduction lives in the window header: `.settings-header__intro`
holds one `<p data-settings-intro="<tab>">` per tab, and only the active tab's
paragraph is shown. Every empty state uses `.settings-empty`
(framed box with border and dark background), or
`.settings-empty settings-empty--inline` when it sits inside an existing card.
Toggle empty states with the `hidden` attribute; do not add feature-specific
empty-state styles. Placeholders inside a map or trace box keep
`events-lap-detail__empty`.

Measurement units go through `overlay/units.js` (`FdcUnits`). Keep values
metric (km/h, meters) in telemetry, storage, and computations, and format them
only when shown with `FdcUnits.formatSpeed` or `FdcUnits.formatDistance`; these
follow the user's per-quantity preference (`speedUnit`, `distanceUnit`). Never
write a unit label such as `km/h`, `mph`, `km`, or `m` into output text
directly; `overlay/units-guard.test.js` fails when one appears outside
`units.js`. To add a quantity, add it to `FdcUnits.QUANTITIES` with a
`<quantity>Unit` preference and a Settings row.

Every delete or reset of saved data asks first through
`confirmDestructive(message)` in `overlay/settings.js`: the shared
`ARE YOU SURE?` dialog with **YES** and **NO**, where **NO** has focus and
Escape or a click outside the dialog answers **NO**. Do not use the browser
`confirm()`; `overlay/destructive-confirm-guard.test.js` fails when it appears
or when a `delete_` or `reset_` command is invoked without
`confirmDestructive`. Quitting from the Configuration X button uses the same
dialog through `askConfirm`, with its own title, button labels, and an optional
checkbox.

Stylesheet colors are role tokens in `overlay/tokens.css`, which both pages
load before their own stylesheet. `overlay/settings.css` and
`overlay/overlay.css` reference them with `var(--token)`, and a translucent
variant mixes the role with transparent:
`color-mix(in srgb, var(--token) N%, transparent)`. Pick the token by meaning,
not by value: vehicle classes, event modes, map layers, and HUD telemetry have
their own tokens even where they share a value with another role.
`overlay/color-tokens-guard.test.js` fails when a color literal or an undefined
custom property appears in those stylesheets. Tests that assert a color
contract read the stylesheet through `tools/stylesheet-tokens.cjs`, which
resolves tokens to their values.

## Release verification cycle

Verification is cumulative for the current change set and is performed once
after all changes for a completed task.

For a completed runtime code task, run the full release verification cycle from
the repository root:

```powershell
node --check overlay/overlay.js
$testFiles = @(Get-ChildItem -LiteralPath overlay,tools -Recurse -File | Where-Object { $_.Name -match '\.test\.(js|mjs)$' } | ForEach-Object { $_.FullName })
node --test $testFiles
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --release --locked --manifest-path src-tauri/Cargo.toml
cargo build --release --locked --manifest-path src-tauri/Cargo.toml
```

The runnable output is `src-tauri/target/release/fdc-application.exe`. Before
handing off a release build, launch it and confirm that it stays alive for at
least five seconds.

If Shift Light source or build tooling changes, rebuild the generated bundle
before the final Node test run:

```powershell
npm run build:shift-light
```

Documentation-only changes require changed-link and claim checks plus:

```powershell
git diff --check
```

Do not repeat checks that already passed for the same final state.

## Build Windows installer

On Windows x64 with the Rust MSVC toolchain and Visual Studio C++ Build Tools,
install the locked JavaScript dependencies with `npm ci` when needed, then run:

```powershell
npm run build:installer
```

This uses the project-pinned Tauri CLI to build with Cargo in release mode and
package an NSIS installer. The version comes from `src-tauri/Cargo.toml`.
The output is `src-tauri/target/release/bundle/nsis/FDC_<version>_x64-setup.exe`.

The first packaging run may download NSIS tooling. Keep installer artifacts
out of Git and perform the release verification cycle before distribution.
