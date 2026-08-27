# fdc-application repository guidance

## Repository identity

- Logical product and development name: `fdc-application`.
- Product name: `FDC` (`Feedback-Driven Companion`).
- Initial platform: Windows PC; initial game: Forza Horizon 6.
- Local project directory: `50-59_2026_FDC_PRN`.
- Permanent branch: `main` only.
- The repository is mirrored to the private GitHub repository
  `https://github.com/kv199/fdc-application`; do not add additional remotes.

## Project boundary

This is the standalone Forza Horizon 6 HUD application. Its root owns the
browser overlay, native Tauri runtime, Direct UDP input on `127.0.0.1:5301`,
Asphalt Coach, Shift Light, Configuration, recording/analysis flow, and HUD-local
SQLite persistence. Suite, co-driver, and WebSocket telemetry are not runtime
dependencies. Do not recreate the Suite's `apps/forza-horizon-6-hud` directory
hierarchy here.

## Verification

Run from the repository root:

```powershell
npm ci
npm run build:shift-light
npm run test:shift-light
node --check overlay/overlay.js
$testFiles = @(Get-ChildItem -LiteralPath overlay,tools -Recurse -File | Where-Object { $_.Name -match '\.test\.(js|mjs)$' } | ForEach-Object { $_.FullName })
node --test $testFiles
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --release --locked --manifest-path src-tauri/Cargo.toml
cargo check --release --locked --manifest-path src-tauri/Cargo.toml
cargo build --release --locked --manifest-path src-tauri/Cargo.toml
```

Before handing off a release build, run `cargo build --release --locked`, then
launch `src-tauri/target/release/fdc-application.exe` and confirm that it stays
alive for at least five seconds.

## Data and artifacts

Keep generated build output, executables, SQLite databases, telemetry captures,
recordings, logs, exports, and QA screenshots out of Git. The repository
`.gitignore` contains the required protection. Runtime Shift Light data belongs
to the FDC application-data directory as `fdc.sqlite`, not in this repository
and not in any external provider database. FDC must not read or import the old
HUD application's `hud.sqlite` or its localStorage namespace.

## Change discipline

- Preserve the Direct UDP packet contract and the shared normalized
  `queueTelemetry` path after decoding.
- Keep the Asphalt Coach current-run and asphalt-only; do not introduce track,
  line, score, or exact time-loss claims without an explicit product decision.
- Keep Shift Light persistence HUD-local and preserve SQLite migration safety.
- Update product documentation when behavior, configuration, or data ownership
  changes.
- Do not modify the source Suite as part of standalone repository work.
