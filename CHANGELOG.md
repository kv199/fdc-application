# Changelog

All user-facing changes to FDC are listed here, newest release first. The
format and rules are described in [Releasing FDC](docs/releasing.md#changelog).

## Unreleased

### Fixed

- **Configuration**: slider titles line up with their value and RESET again,
  and every "nothing here yet" message now uses the same framed style.

### Added

- **Configuration**: **HELP** at the bottom of the window opens the bug report
  form with your version filled in, GitHub Discussions for ideas, or Q&A for
  questions. Click the version to copy it.

### Improved

- **Garage**: a car is shown the same way everywhere — by its Garage name, or
  by its car number when it has no name — and renaming it updates Events,
  Driver Analysis, and Shift Light right away.
- **Configuration**: tabs are now ordered HUD, Events, Driver, Shift Light,
  Garage, Settings, and each tab opens with a short explanation of what it
  does, with fewer technical labels and clearer empty-state hints.
- **Settings**: the note that all FDC data stays on this PC is now part of the
  tab's intro instead of looking like a setting.

## 7.19.55 - 2026-09-30

### Fixed

- **HUD**: in Freeform layout, **EDIT** no longer hides the block you are
  moving while **Show HUD with telemetry** is on and the game is in a menu.

## 7.19.54 - 2026-09-27

### Fixed

- **Driver Analysis**: corner stats now show time above 100% tire slip
  instead of a misleading front-vs-rear number.

### Added

- **Events**: bigger lap map with Throttle, Brake, Coast, and Slip layers.
  Hover the trace to see speed, gear, pedals, and tire data.
- **Driver Analysis**: one recording can now include several cars. Each race
  is detected automatically and has its own map showing where you made
  mistakes.

## 7.16.48 - 2026-09-25

First public release of FDC.

- **HUD**: tire temperatures, throttle and brake, steering, gear, speed and
  RPM, boost, power and torque, and an eight-second input graph, in one panel
  or as freely placed blocks.
- **Shift Light**: per-gear shift points learned for each car and tune, with a
  red approach cue and a purple optimal shift cue.
- **Events**: a local event library with run recording, lap and sector times,
  top-down traces, and a live Delta against the fastest saved run.
- **Driver Analysis** (beta): recorded asphalt sessions that report the
  dominant recurring problem.
- **Garage**: automatic vehicle library with class, PI, and drivetrain
  configurations.
