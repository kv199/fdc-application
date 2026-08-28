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
- view Direct Data Out status;
- inspect Shift Light calibration and reset the current calibration.

Settings are applied locally and do not add another telemetry source.

## Local data and privacy

FDC is local-first. Direct Data Out is received from the local game session;
the application does not require a cloud service, Suite connection, co-driver,
or external telemetry database.

Shift Light profiles are stored in the FDC application-data directory as
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

Build and test the Shift Light bundle:

```powershell
npm ci
npm run build:shift-light
npm run test:shift-light
```

Run the browser and native release checks from the repository root:

```powershell
node --check overlay/overlay.js
$testFiles = @(Get-ChildItem -LiteralPath overlay,tools -Recurse -File | Where-Object { $_.Name -match '\.test\.(js|mjs)$' } | ForEach-Object { $_.FullName })
node --test $testFiles
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --release --locked --manifest-path src-tauri/Cargo.toml
cargo check --release --locked --manifest-path src-tauri/Cargo.toml
cargo build --release --locked --manifest-path src-tauri/Cargo.toml
```

The runnable output is `src-tauri/target/release/fdc-application.exe`. Before
handing off a release build, launch it and confirm that it stays alive for at
least five seconds.

## Current limitations

- FDC currently supports Forza Horizon 6 Direct Data Out on Windows.
- Asphalt Coach is asphalt-only, current-run, and zero-reference. It does not
  identify track surface, track identity, an ideal line, a driving score, exact
  time loss, or optimal gear advice.
- Coach calibration and findings are not persisted between application runs.
- Shift Light learns from live telemetry and has no manual target-entry flow or
  car-name database.
- Browser demo mode previews the overlay but does not emulate a live Forza
  Data Out connection.

## Technical documentation

- [FDC Architecture](docs/architecture.md) — system boundary and runtime data
  flow.
- [Asphalt Coach](docs/asphalt-coach.md) — current Coach behavior and
  verification boundaries.
- [Shift Light](docs/shift-light.md) — current learner, presentation,
  persistence, and compatibility contracts.
