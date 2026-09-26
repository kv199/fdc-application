# Changelog

All user-facing changes to FDC are listed here, newest release first. The
format and rules are described in [Releasing FDC](docs/releasing.md#changelog).

## Unreleased

### Fixed

- **Driver Analysis**: corner statistics now show how much of the cornering
  time the front and rear tires spent above 100% slip, the level at which the
  in-game tire friction telemetry turns red, instead of a front-versus-rear
  comparison that read above 90% for almost every recording.

### Added

- **Events**: the lap map of a saved run now draws the track outline with
  Throttle, Brake, Coast, and Slip layers that can be switched on and off.
  Hovering the trace shows the recorded speed, gear, RPM, pedals, steering,
  acceleration, and per-wheel slip, tire temperature, suspension travel, curb,
  and puddle values at that point. Laps recorded before this version show the
  pedal layers only.

### Improved

- **Driver Analysis**: the Front scrub description now spells "tires" like the
  rest of FDC.

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
