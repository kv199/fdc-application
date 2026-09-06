# FDC

FDC is a local-first, always-on-top telemetry HUD and driving-feedback
companion for Forza Horizon 6. It receives FH6 Data Out directly, renders
essential driving telemetry, and keeps the feedback path on the local machine.

## What FDC does

FDC provides a compact overlay with:

- tire temperatures;
- throttle and brake input;
- steering, gear, speed, and RPM;
- boost, power, and torque;
- throttle and brake history;
- live lap timing;
- Garage vehicle library;
- Asphalt Coach guidance;
- Shift Light guidance.

The native Tauri application receives and decodes Direct Data Out. The browser
overlay consumes the normalized telemetry through one local runtime path.

## Current features

### Asphalt Coach

Asphalt Coach is a current-run, zero-reference technique assistant for Road,
Street, Rivals, Circuit, and Sprint asphalt events. It learns bounded local
evidence and shows short technique cues, a Driver Brief, or a non-final Run
Check. It does not require a track database.

Technical details: [docs/asphalt-coach.md](docs/asphalt-coach.md).

### Shift Light

Shift Light learns per-gear shift targets from live FH6 telemetry and presents
fallback, observed, or optimal timing cues in the HUD. Calibration and
diagnostics are available in Configuration, and learning data is kept locally
for the matching vehicle and tune.

Technical details: [docs/shift-light.md](docs/shift-light.md).

### Garage

Garage automatically records vehicles observed through FH6 Data Out, keeps one
local card per car ordinal, remembers class, PI, and drivetrain configurations,
and lets you name the current car or view its configurations in Configuration.
The latest used car is shown first.

Technical details: [docs/garage.md](docs/garage.md).

## Requirements

To run FDC:

- Windows PC;
- Forza Horizon 6;
- Forza Horizon 6 Data Out enabled.

To build FDC from source, also install Node.js with npm and Rust 1.85 or later
with Cargo.

## Configure Forza Horizon 6 Data Out

In Forza Horizon 6:

1. Open the Data Out settings.
2. Enable Data Out.
3. Set the IP address to `127.0.0.1`.
4. Set the UDP port to `5301`.

FDC listens on this local endpoint when it starts. The Configuration window
shows whether the receiver is waiting, live, stale, offline, or unable to
start.

## Run FDC

Run the Windows x64 `FDC_<version>_x64-setup.exe` installer, then launch FDC
from the Start menu. Installation is available to all Windows users, requires
administrator approval, and defaults to `C:\Program Files\FDC` on Windows x64.
Each user's database and preferences remain in their own application-data storage.
If Microsoft Edge WebView2 Runtime is missing, setup downloads and installs it;
that step requires an internet connection.

The installer is currently unsigned.

For a source build:

Build the release executable, then launch:

```powershell
src-tauri/target/release/fdc-application.exe
```

On first launch, FDC opens Configuration. After that, open Configuration from
the FDC tray icon.

## Configuration

Configuration lets you:

- move and reset the Coach card, lap timer, and telemetry HUD;
- show or hide overlay targets and individual HUD components;
- choose `km/h` or `mph`;
- adjust Shift Light brightness;
- resize Configuration; its `820 × 620` default size is replaced by the last
  size chosen by the user;
- view the current car, locally name it, and view its saved configurations in
  Garage;
- view Direct Data Out status;
- inspect Shift Light calibration and reset the current calibration.

Settings are applied locally and do not add another telemetry source.

## Local data and privacy

FDC is local-first. Direct Data Out is received from the local game session.
The application keeps runtime data local to the machine.

Garage and Shift Light data are stored in the FDC application-data directory as
`fdc.sqlite`. Coach session state and live telemetry state remain local to the
running application. Layout, visibility, speed-unit, and display preferences
are stored in the local application webview.

## Browser demo

The overlay can be previewed without Forza by serving the `overlay/` directory
with a local static HTTP server and opening:

```text
http://127.0.0.1:8765/index.html?demo=1
```

Useful previews include:

```text
http://127.0.0.1:8765/index.html?demo=1&coach=front-scrub
http://127.0.0.1:8765/index.html?demo=1&coach=brief
http://127.0.0.1:8765/index.html?demo=1&signal=shift
```

Demo mode is for offline visual checks. Omit `demo=1` when checking live
telemetry in the native application.

## Development

The repository is organized around the current runtime boundaries:

```text
src-tauri/                 Native Tauri runtime and Direct Data Out decoder
overlay/                   Static browser HUD and feature runtime modules
src/shift-light/           Canonical Shift Light TypeScript source
tools/                     Shift Light build and integrity test tooling
docs/                      Current architecture and feature documentation
```

Install JavaScript dependencies before working on the browser or Shift Light
code:

```powershell
npm ci
```

When changing Shift Light source, rebuild the checked-in browser bundle before
running the application.

## Build and verify

Verification is cumulative for the current change set and is performed once
after all changes for a completed task. Documentation-only changes require
changed-link and claim checks plus `git diff --check`.

When Shift Light source or build tooling changes, rebuild the generated bundle
before the final test run:

```powershell
npm run build:shift-light
```

For a completed runtime code task, run the release verification cycle from the
repository root:

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
least five seconds. Do not repeat checks that already passed for the same
final state. Run `npm ci` only when dependencies are not installed or
dependency manifests have changed.

### Windows EXE installer

On Windows x64 with the Rust MSVC toolchain and Visual Studio C++ Build Tools,
install the locked JavaScript dependencies with `npm ci` when needed, then run:

```powershell
npm run build:installer
```

This uses the project-pinned Tauri CLI to build with Cargo in release mode and
package an NSIS installer. The version comes from `src-tauri/Cargo.toml`.
The output is
`src-tauri/target/release/bundle/nsis/FDC_<version>_x64-setup.exe`.
The first packaging run may download NSIS tooling. Keep installer artifacts
out of Git and perform the release verification cycle before distribution.

## Release versioning

`src-tauri/Cargo.toml` is the canonical application version. FDC increases the
version component that matches the user impact—major for breaking changes,
minor for new user-facing runtime features, and patch for fixes or safe UI and
behavior improvements—without resetting the other components. For example, a
feature changes `1.1.14` to `1.2.14`; a following fix changes it to `1.2.15`.

Every runtime version bump also updates `src-tauri/Cargo.lock`, passes the
release verification cycle, and is committed, pushed to `main`, and annotated
as tag `vX.Y.Z`.

## Current limitations

- FDC currently supports Forza Horizon 6 Direct Data Out on Windows.
- Asphalt Coach is asphalt-only, current-run, and zero-reference. It does not
  identify track surface, track identity, an ideal line, a driving score, exact
  time loss, or optimal gear advice.
- Coach calibration and findings are not persisted between application runs.
- Shift Light learns from live telemetry and has no manual target-entry flow or
  car-name database.
- Garage has image placeholders only; it does not download car images or names.
- Browser demo mode previews the overlay but does not emulate a live Forza
  Data Out connection.

## Technical documentation

- [FDC Architecture](docs/architecture.md) — system boundary and runtime data
  flow.
- [Events](docs/events.md) — local event library, its lifecycle, and Mode
  colors.
- [Garage](docs/garage.md) — vehicle identity, local persistence, and
  Configuration behavior.
- [Asphalt Coach](docs/asphalt-coach.md) — current Coach behavior and
  verification boundaries.
- [Shift Light](docs/shift-light.md) — current learner, presentation,
  persistence, and compatibility contracts.
