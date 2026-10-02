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

## Configuration UI conventions

Each Configuration tab starts with a heading block and one
`settings-section__intro` paragraph. Every empty state uses `.settings-empty`
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

Every delete asks first through `confirmDelete(message)` in
`overlay/settings.js`: the shared `ARE YOU SURE?` dialog with **YES** and
**NO**, where **NO** has focus and Escape or a click outside the dialog answers
**NO**. Do not use the browser `confirm()`;
`overlay/delete-confirm-guard.test.js` fails when it appears or when a
`delete_` command is called without `confirmDelete`.

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
