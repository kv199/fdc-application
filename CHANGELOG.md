# Changelog

All user-facing changes to FDC are listed here, newest release first. The
format and rules are described in [Releasing FDC](docs/releasing.md#changelog).

## Unreleased

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
