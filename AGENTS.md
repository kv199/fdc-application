# fdc-application repository guidance

## Repository identity

- Logical product and development name: `fdc-application`.
- Product name: `FDC` (`Feedback-Driven Companion`).
- Initial platform: Windows PC; initial game: Forza Horizon 6.
- Local project directory: `50-59_2026_FDC_PRN`.
- Permanent branch: `main` only.
- This repository has no remote and must not be published or pushed to GitHub.

## Project boundary

This is the standalone Forza Horizon 6 HUD application. Its root owns the
browser overlay, native Tauri runtime, Direct UDP input, Suite/WebSocket input,
Asphalt Coach, Shift Light, Configuration, and HUD-local SQLite persistence.
Do not recreate the Suite's `apps/forza-horizon-6-hud` directory hierarchy here.

## Verification

Run from the repository root:

```powershell
node --check overlay/overlay.js
node --test overlay/*.test.js
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --release --locked --manifest-path src-tauri/Cargo.toml
cargo check --release --locked --manifest-path src-tauri/Cargo.toml
```

Before handing off a release build, run `cargo build --release --locked`, then
launch `src-tauri/target/release/fdc-application.exe` and confirm that it stays
alive for at least five seconds.

## Data and artifacts

Keep generated build output, executables, SQLite databases, telemetry captures,
recordings, logs, exports, and QA screenshots out of Git. The repository
`.gitignore` contains the required protection. Runtime Shift Light data belongs
to the FDC application-data directory as `fdc.sqlite`, not in this repository
and not in the Suite provider database. FDC must not read or import the old
HUD application's `hud.sqlite` or its localStorage namespace.

## Change discipline

- Preserve the Direct and Suite telemetry contract and their shared normalized
  `queueTelemetry` path.
- Keep the Asphalt Coach current-run and asphalt-only; do not introduce track,
  line, score, or exact time-loss claims without an explicit product decision.
- Keep Shift Light persistence HUD-local and preserve SQLite migration safety.
- Update product documentation when behavior, configuration, or data ownership
  changes.
- Do not modify the source Suite as part of standalone repository work.
