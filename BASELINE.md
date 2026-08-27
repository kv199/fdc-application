# Forza Horizon 6 HUD extraction baseline

Captured on 2026-08-27 before separating the HUD from the Suite.

## Provenance

- Source repository: `C:\Install\forza-horizon-6-suite`
- Source project: `apps/forza-horizon-6-hud`
- Source branch: `main`
- Source commit: `a8264565555c1639adc503c83267fe93b280d5a1`
- Source tree: `930d834a9aa4243f32610dea41ac6b9e6e2a69c9`
- New project root: `C:\50-59_Projects\50-59_2026_FDC_PRN`

The HUD path had no staged, unstaged, or untracked changes. The Suite had one unrelated untracked file, `.tmp/extract_hud_docx.py`; it was left untouched. The source also contained ignored generated `src-tauri/target` and `src-tauri/gen` output; only the 64 tracked HUD files were exported.

The exported files were compared against the source by SHA-256: 64 files copied, 0 mismatches.

## Verification

- HUD JavaScript syntax check: passed.
- HUD JavaScript tests: 185 passed, 0 failed.
- HUD Rust formatting check: passed.
- HUD release Cargo check with the locked dependency set: passed.
- HUD Rust unit tests: 16 passed, 0 failed.
- Existing release executable smoke test: remained alive for 6 seconds.

Live Forza gameplay and a running Suite/WebSocket session were not available during this baseline; those require a manual in-game or end-to-end environment.

## Behavior at the baseline

- **Direct UDP:** the HUD can own `127.0.0.1:5301`, decode FH6 Data Out locally, and render normalized telemetry. Direct mode is authoritative and does not use the Suite WebSocket for telemetry.
- **Suite/WebSocket:** the HUD can consume normalized telemetry from `ws://127.0.0.1:3001/_ws`. Suite mode does not start the HUD UDP receiver. Direct and Suite frames enter the same `queueTelemetry` path and have parity tests.
- **HUD:** the overlay presents tires, throttle/brake, steering, gear/speed/RPM, input history, the game-clock/lap timing surface, and the source diagnostics in Configuration.
- **Asphalt Coach:** HUD-owned, asphalt-only, zero-reference current-run coaching with bounded calibration and evidence-based cues. Direct and Suite normalized replay tests produce identical findings; no track identity, ideal line, score, or exact time-loss claims are made.
- **Shift Light:** HUD-owned learning and presentation in both source modes, with calibration state and reset exposed through Configuration. Purple cues latch for at least 250 ms and use RPM-rate lead.
- **Configuration:** first-launch settings window and tray entry; `HUD`, `SHIFT LIGHT`, and `SETTINGS` tabs; independent visibility/position preferences; selected telemetry source and diagnostics; speed units and shift-light brightness.
- **Local SQLite:** `hud.sqlite` is stored in the HUD application data directory, separate from the provider database. The schema stores cars, immutable gearbox variants, per-gear profiles, bounded samples, and schema version; Rust tests cover idempotent creation, migrations, variant resolution, monotonic merges, and reset behavior.

This document records the source working baseline; the initial commit of this standalone repository is expected to have a different Git SHA because its repository history starts here.
