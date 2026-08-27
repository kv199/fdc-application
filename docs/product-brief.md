# fdc-application product brief

## Product identity

`fdc-application` is the logical product and development name for **FDC**,
expanded as **Feedback-Driven Companion**, the standalone Forza Horizon 6 HUD.
The initial platform is Windows PC and the local folder intentionally remains
`50-59_2026_FDC_PRN`.

## User problem

Forza drivers need compact, always-on-top telemetry and useful current-run
technique feedback without switching away from the game. The application owns
one local-first Data Out flow and keeps learning data private to the local
machine.

## Primary user journey

1. Start `fdc-application` while Forza is running.
2. FDC listens for FH6 Data Out on UDP `127.0.0.1:5301`.
3. See telemetry, game-clock/lap timing, Shift Light, and the current Asphalt
   Coach state over the game.
4. Use Configuration to move or hide overlay targets, select units, inspect
   route diagnostics, tune Shift Light brightness, and reset the active profile.
5. Resume later with local layout preferences and bounded Shift Light evidence
   restored from the HUD-local SQLite database.

## Supported scope

- Direct FH6 Data Out over UDP `127.0.0.1:5301`.
- One normalized telemetry path after UDP packet decoding.
- Compact telemetry HUD, lap timing, and independent overlay layout targets.
- Asphalt-only, zero-reference Coach with bounded calibration and evidence-based
  cues.
- HUD-owned Shift Light learning and presentation from the Direct Data Out path.
- Configuration for visibility, placement, speed units, receiver diagnostics,
  brightness, and profile reset.
- FDC-local `fdc.sqlite` storage for cars, gearbox variants, profiles, and
  bounded samples.

## Non-goals

The first standalone product does not classify road surface from telemetry,
identify tracks, infer an ideal line, produce a single driving score, or claim
exact metres or seconds of time loss. Provider-owned reference messages are not
part of the FDC runtime contract.

## Repository and release constraints

The repository root is `C:\50-59_Projects\50-59_2026_FDC_PRN`, with the
application content directly under `overlay`, `src-tauri`, `docs`, and `ADR`.
`main` is the only permanent branch. The private GitHub mirror is
`https://github.com/kv199/fdc-application`. Generated targets, executables,
SQLite files, telemetry recordings, logs, temporary exports, and QA artifacts
are local-only and must not be committed.

The Tauri identifier `dev.kv199.fdc` creates FDC's new application-data
directory. FDC starts with fresh `fdc.sqlite` and `fdc.*.v1` localStorage keys;
it never imports, modifies, or deletes data belonging to the old HUD identity.

The source extraction baseline and verification results are recorded in
`BASELINE.md`.
