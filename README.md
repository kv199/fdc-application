<div align="center">
  <img src="src-tauri/icons/icon.png" width="128" alt="FDC app icon">
  <h1>FDC</h1>
  <p><strong>Feedback-Driven Companion — a local-first telemetry HUD compatible with Forza Horizon 6 on Windows.</strong></p>
  <p><a href="https://github.com/kv199/fdc-application/releases/latest/download/FDC-setup.exe">Download</a> · <a href="https://github.com/kv199/fdc-application/releases">Releases</a> · <a href="SECURITY.md">Security</a></p>
  <p>
    <a href="https://github.com/kv199/fdc-application/actions/workflows/ci.yml"><img src="https://github.com/kv199/fdc-application/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/kv199/fdc-application" alt="License: MIT"></a>
    <img src="https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D6" alt="Platform: Windows 10/11 x64">
  </p>
</div>

Feedback-Driven Companion (FDC) is a local-first, always-on-top telemetry HUD
app compatible with Forza Horizon 6. It receives Forza Horizon 6 Data Out
directly, renders essential driving telemetry, and keeps the feedback path on
the local machine.

<!-- Screenshot: add a HUD screenshot here (for example docs/images/hud.png). -->

## Unofficial project notice

FDC is an independent, unofficial application. It is not affiliated with,
endorsed by, sponsored by, or otherwise approved by Microsoft, Xbox,
Playground Games, Turn 10 Studios, or the Forza franchise. Microsoft, Xbox,
Forza, Forza Horizon, and related names and marks belong to their respective
owners. FDC does not include or redistribute game assets.

## What FDC does

FDC provides a compact overlay with:

- tire temperatures;
- throttle and brake input;
- steering, gear, speed, and RPM;
- boost, power, and torque;
- throttle and brake history;
- live lap timing;
- Garage vehicle library;
- recorded Driver Analysis;
- Shift Light guidance.

The native Tauri application receives and decodes Direct Data Out. The browser
overlay consumes the normalized telemetry through one local runtime path.

## Current features

### Driver Analysis

Driver Analysis is an explicit-recording, zero-reference review tool for
asphalt driving. It saves the selected telemetry and analysis locally in
`fdc.sqlite` and lists recordings newest-first in Configuration. A recording
shows at most one dominant recurring problem, the statistics of what was
recorded, and, when no problem qualifies, the most frequent pattern it checked. Recordings remain local until
the user deletes them. It does not require a track database.

Technical details: [docs/driver-analysis.md](docs/driver-analysis.md).

### Shift Light

Shift Light learns per-gear shift targets from live FH6 telemetry and presents
fallback, provisional, or optimal timing cues in the HUD. Calibration and
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

- Windows 10 or 11 x64;
- Forza Horizon 6 with Data Out enabled.

## Install

### Download and verify

Download the latest installer from the [Releases](https://github.com/kv199/fdc-application/releases) page:

- Use `FDC-setup.exe` (stable name) or `FDC_<version>_x64-setup.exe` (versioned).
- Each installer has a matching `.sha256` file on the same release.

Verify the checksum on Windows:

```powershell
Get-FileHash .\FDC-setup.exe -Algorithm SHA256
```

Compare the output with the hash in the `.sha256` file for your release.

### Unsigned installer

The installer is unsigned. Microsoft Defender SmartScreen may show:

> "Windows protected your PC"

Select **More info**, then **Run anyway**. The message appears because the
installer does not have an Authenticode signature. Verify the SHA-256 checksum
matches before running.

During installation, Windows will prompt for administrator approval, showing
"Unknown publisher" for the same reason. This is expected and normal for
unsigned software.

### Installation details

- Installation is available to all Windows users and requires administrator approval.
- Default installation path: `C:\Program Files\FDC`.
- Scope: per-machine installation.
- WebView2 Runtime: if missing, setup downloads and installs it (requires internet connection).

### If your antivirus blocks the installer

1. Confirm the installer file came from the official [Releases](https://github.com/kv199/fdc-application/releases) page.
2. Verify the SHA-256 checksum matches the `.sha256` file on that same release.
3. If your antivirus still blocks it, open a [GitHub issue](https://github.com/kv199/fdc-application/issues) with:
   - your antivirus product name;
   - the detection name it reports.

**Do not attach** `fdc.sqlite`, telemetry recordings, or files containing personal data.

### Uninstall

Uninstall FDC from Windows Settings:

1. **Settings** > **Apps** > **Installed apps**
2. Search for **FDC**
3. Select **Uninstall**

The FDC database, `fdc.sqlite`, is stored in `%APPDATA%\FDC`. See
[Local data and privacy](#local-data-and-privacy).

## Configure Forza Horizon 6 Data Out

In Forza Horizon 6:

1. Open the Data Out settings.
2. Enable Data Out.
3. Set the IP address to `127.0.0.1`.
4. Set the UDP port to `5301`.

FDC listens on this local endpoint when it starts. The Configuration window
shows whether the receiver is waiting, live, stale, offline, or unable to
start.

## First launch

On first launch, Configuration opens automatically. Afterward, you can access
Configuration from the FDC tray icon in the Windows system tray.

## Configuration

Configuration lets you:

- move and reset the Delta and telemetry HUD;
- show or hide overlay targets and individual HUD components;
- enable Driver Analysis, record an asphalt session, change its global hotkey,
  and review saved results;
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

Garage, Events, Driver Analysis, and Shift Light data are stored in the FDC
application-data directory as `fdc.sqlite` (`%APPDATA%\FDC\fdc.sqlite`). A
Driver Analysis recording keeps its selected telemetry samples, opportunities,
evidence, statistics, and result in that database until the user deletes the
recording; only the enable state and the hotkey stay in local webview storage.
Layout, visibility, speed-unit, and display preferences are also stored in the
local application webview.

## Current limitations

- FDC currently supports Forza Horizon 6 Direct Data Out on Windows.
- Driver Analysis is beta, asphalt-only, and zero-reference. It does not
  identify track surface, track identity, an ideal line, a driving score, exact
  time loss, or optimal gear advice.
- Driver Analysis evaluates steering that is held for at least 200 ms, so short
  steering pulses are recorded but not checked.
- Shift Light learns from live telemetry and has no manual target-entry flow or
  car-name database.
- Garage has image placeholders only; it does not download car images or names.
- Browser demo mode previews the overlay but does not emulate a live Forza
  Data Out connection.

## Build from source

Requirements:

- Node.js with npm;
- Rust 1.85 or later with Cargo (Windows x64, MSVC toolchain).

Build the release executable:

```powershell
npm ci
cargo build --release --locked --manifest-path src-tauri/Cargo.toml
```

The runnable output is `src-tauri/target/release/fdc-application.exe`.

Day-to-day work happens on the `develop` branch; the `main` branch holds only
released source. See [Development](docs/development.md) for the full developer
workflow and [Releasing FDC](docs/releasing.md) for versioning and the release
procedure.

## Reporting issues

Found a bug or have a feature idea? Open a [GitHub issue](https://github.com/kv199/fdc-application/issues).

For security vulnerabilities, see [SECURITY.md](SECURITY.md) — never open a
public issue for an unpatched vulnerability.

## Technical documentation

- [FDC Architecture](docs/architecture.md) — system boundary and runtime data flow.
- [Development](docs/development.md) — developer setup, build, and verification.
- [Releasing FDC](docs/releasing.md) — branches, versioning, and release procedure.
- [Events](docs/events.md) — local event library, its lifecycle, and Mode colors.
- [Garage](docs/garage.md) — vehicle identity, local persistence, and Configuration behavior.
- [Driver Analysis](docs/driver-analysis.md) — recording, analysis, history, and verification boundaries.
- [Shift Light](docs/shift-light.md) — current learner, presentation, persistence, and compatibility contracts.

## License

FDC is available under the [MIT License](LICENSE).
