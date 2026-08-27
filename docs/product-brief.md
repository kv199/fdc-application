# fdc-application product brief

## Product identity

`fdc-application` is the logical product and development name for the
standalone Forza Horizon 6 HUD. The local folder intentionally remains
`50-59_2026_FDC_PRN`.

## User problem

Forza drivers need compact, always-on-top telemetry and useful current-run
technique feedback without switching away from the game. The application must
work either directly from FH6 Data Out or alongside the co-driver Suite, while
keeping HUD-owned learning data private to the local machine.

## Primary user journey

1. Start `fdc-application` while Forza is running.
2. Select `Direct Forza` or `co-driver Suite` in Configuration.
3. See telemetry, game-clock/lap timing, Shift Light, and the current Asphalt
   Coach state over the game.
4. Use Configuration to move or hide overlay targets, select units, inspect
   route diagnostics, tune Shift Light brightness, and reset the active profile.
5. Resume later with local layout preferences and bounded Shift Light evidence
   restored from the HUD-local SQLite database.

## Supported scope

- Direct FH6 Data Out over UDP `127.0.0.1:5301`.
- Normalized co-driver Suite telemetry over
  `ws://127.0.0.1:3001/_ws`.
- A shared normalized telemetry path for both sources.
- Compact telemetry HUD, lap timing, and independent overlay layout targets.
- Asphalt-only, zero-reference Coach with bounded calibration and evidence-based
  cues.
- HUD-owned Shift Light learning and presentation in both source modes.
- Configuration for visibility, placement, speed units, source selection,
  diagnostics, brightness, and profile reset.
- HUD-local `hud.sqlite` storage for cars, gearbox variants, profiles, and
  bounded samples.

## Non-goals

The first standalone product does not classify road surface from telemetry,
identify tracks, infer an ideal line, produce a single driving score, claim
exact metres or seconds of time loss, or replace the Suite's historical
reference analysis. It does not copy provider databases into the HUD.

## Repository and release constraints

The repository root is `C:\50-59_Projects\50-59_2026_FDC_PRN`, with the
application content directly under `overlay`, `src-tauri`, `docs`, and `ADR`.
`main` is the only permanent branch. There is no remote. Generated targets,
executables, SQLite files, telemetry recordings, logs, temporary exports, and
QA artifacts are local-only and must not be committed.

The source extraction baseline and verification results are recorded in
`BASELINE.md`.
