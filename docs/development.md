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
tools/                     Shift Light build and integrity test tooling
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
