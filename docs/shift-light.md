# Shift Light

## Purpose

Shift Light learns a practical full-throttle upshift point independently for
each real next-gear pair (`1 → 2`, `2 → 3`, and so on). It deliberately does
not attempt to reconstruct a complete engine or gearbox model.

The red game redline and the purple FDC cue are separate displays. The purple
cue is timed before the desired shift RPM so the driver reaches the target
instead of reacting after it. Disabling the purple display does not stop
learning or persistence.

## Runtime data flow

```text
FH6 Data Out → UDP 127.0.0.1:5301 → native decoder → direct_telemetry
  → queueTelemetry → HudShiftLightRuntime.update
  → ShiftLightLearner.update → hud_shift_light → HUD render
```

Shift Light uses the existing normalized telemetry path and local
`fdc.sqlite`. It does not add another transport or external dependency.

## Vehicle configuration

The stable learning key is:

```text
fh6:<carOrdinal>:<carClass>:<carPerformanceIndex>:<drivetrainType>:<numCylinders>
```

The game-reported redline is not part of this key. A PI or other key-field
change selects a separate configuration. FH6 does not report the total number
of gearbox ratios. A clean WOT observation in source gear `G` (`1–9`) creates
a provisional `G → G+1` row; accepted comparison evidence is added only after
a real transition to that next gear. Gear 10 never creates a `10 → 11` pair.
The native parser still accepts the former seventh redline suffix for migration
compatibility, but that suffix is not part of configuration identity.

## Safe baseline and usable ceiling

The usable engine ceiling is the safe baseline target for every unlearned gear
pair. Until the limiter has been measured reliably, the current positive
game-reported redline is used instead. This means `LEARNING` still has a usable
purple cue; it does not mean "no guidance".

A learned ceiling requires three stable limiter observations. An observation
comes from a continuous same-gear full-throttle pull that rises by at least
`100 RPM`, reaches a local peak, drops by at least `40 RPM`, and then recovers
to within `60 RPM` of that peak. The median of three observations whose total
spread is no more than `100 RPM` becomes the usable ceiling. A single maximum
or flat RPM value is not sufficient limiter evidence.

If a comparable shift produces a negative power delta, no special fallback
learner is started. The current safe baseline simply remains the answer.

## Comparable shift capture

For a real `G → G+1` upshift, FDC keeps at most five clean source-gear frames
from the preceding `200 ms`. It waits `80 ms` after the transition to pass the
initial torque cut, then requires three clean positive-power destination-gear
frames within a `600 ms` capture window. Median values from the two windows
provide:

```text
RPM before
RPM after
power before
power after
source gear
destination gear
```

The comparison is direct engine power:

```text
PowerDeltaPercent = (powerAfter - powerBefore) / powerBefore × 100
```

A direct adjacent-gear transition is accepted, as is a transition through FH6
neutral gear `11` when the destination gear appears within `400 ms`. A
comparable sample requires an active or unknown race state, throttle of at
least `0.95`, clutch no greater than `0.05`, brake and handbrake no greater than
`0.02`, positive RPM, power, and vehicle speed. The temporary shift interval
itself may contain zero or negative power; those torque-cut frames are skipped
rather than treated as the destination gear's power.
Partial-throttle, incomplete, stale or otherwise uncapturable shifts are
ignored silently. They are not labelled bad or too early.

A timestamp gap longer than `1000 ms` clears only in-progress capture, limiter,
and RPM-rate evidence. It does not erase completed learning or persisted state.

Torque, wheel speed, slip and a reconstructed `power / speed` force proxy are
not inputs to this decision.

## Per-pair learning states

Each observed source/destination pair has one of three states:

- `LEARNING` — no earlier crossover has been demonstrated. The effective target
  is the learned usable ceiling or, until then, the reported redline.
- `POTENTIAL` — a comparable shift produced `PowerDeltaPercent >= 0` at an RPM
  strictly below the known safe baseline and created an earlier candidate. The
  candidate immediately becomes the effective cue target while it is checked.
- `OPTIMAL` — three non-negative observations are each within `±100 RPM` of the
  current candidate. Their median RPM is the confirmed target.

A negative comparison is retained as bounded diagnostic evidence but does not
create or reset a candidate and does not replace the current safe baseline. A
later non-negative observation outside `±100 RPM` of the current candidate
starts a new potential sequence. A confirmed target is stable until the active
configuration is reset.

## Cue timing

The desired shift RPM and cue-on RPM are different values:

```text
leadRPM = currentPositiveRpmRate × 0.15 seconds
cueOnRPM = effectiveTargetRPM - leadRPM
```

The lead is clamped to `100–500 RPM`; when a reliable acceleration rate is not
available it defaults to `200 RPM`. The effective target priority is confirmed
target, potential candidate, usable ceiling, then reported redline. The visual
presentation latches the purple shift phase for at least `250 ms` so a brief
telemetry change cannot erase the cue immediately.

## Persistence

Schema version 15 contains exactly four Shift Light tables:

```text
shift_light_configs
  id                                      primary key
  game_id + car_ordinal + car_class
    + car_performance_index
    + drivetrain_type + num_cylinders    unique configuration identity
  reported_redline_rpm                    nullable current game value
  usable_ceiling_rpm                      nullable trusted limiter median
  model_version                           4
  first_seen_at + last_seen_at

shift_light_ceiling_samples
  id                                      primary key
  config_id                               cascading foreign key
  rpm                                     positive; at most 3 per save

shift_light_gear_targets
  config_id + source_gear
    + destination_gear                    primary key
  source_gear                             1–9
  destination_gear                        exactly source_gear + 1
  status                                  learning | potential | optimal
  candidate_rpm
  optimal_rpm
  confirmation_count                      0–3
  updated_at

shift_light_shift_samples
  id                                      primary key
  config_id                               cascading foreign key
  source_gear + destination_gear          real next-gear pair
  before_timestamp_ms + after_timestamp_ms
  before_rpm + after_rpm                  positive
  before_power_w + after_power_w          positive
  delta_percent
  classification                          crossover | not_better
```

The state constraints are explicit: `LEARNING` has no candidate and zero
confirmations, `POTENTIAL` has a candidate and one or two confirmations, and
`OPTIMAL` has candidate and optimal RPM values with exactly three
confirmations. `crossover` requires a non-negative delta; `not_better` requires
a negative delta. At most nine targets and 64 accepted comparable shift
captures are retained per configuration.

There is no learner JSON blob, RPM power-bin table, materialized legacy state,
gear-ratio signature, torque/speed history, or separate no-crossover table.
Writes replace the compact state transactionally, and unchanged snapshots are
not written repeatedly.

This is learning model version 4 and a breaking persistence migration. The v15
migration runs transactionally, removes all retired Shift Light child tables,
preserves compatible configuration identities and moves a positive legacy
`rpm_max` into `reported_redline_rpm`. Older learning facts are discarded
because their meanings are incompatible. Garage and Events tables are not
changed.

Reset deletes the active configuration's ceiling samples, gear targets and
shift samples, and clears its usable ceiling. It preserves the configuration
row and reported redline. Other configurations are untouched.

## Native persistence contract

The browser runtime uses four native commands:

- `resolve_shift_light_config` validates the vehicle key and observed gear,
  creates or resolves the numeric configuration ID, and updates a supplied
  reported redline;
- `load_shift_light_calibration` verifies that the numeric ID belongs to the
  supplied key and returns the compact model-version-4 state;
- `save_shift_light_calibration` transactionally replaces ceiling samples,
  targets and shift samples for that configuration; malformed child records
  are skipped instead of invalidating the remaining compact state;
- `clear_shift_light_config` performs the scoped reset described above.

The runtime coalesces identical snapshots, serializes writes, retries failed
saves with bounded backoff, and merges a delayed database load with any live
facts collected while that load was in flight. A persistence failure appears
in Configuration as `SHIFT LIGHT SAVE ERROR` instead of being silently hidden.
Potential confirmation progress survives restart: the candidate and count are
stored directly, while the individual confirmation RPMs are reconstructed from
the bounded crossover journal.

## Known limitations

- The six-field identity has no gearbox-ratio fingerprint. A gearing change
  that leaves all identity fields unchanged can reuse an older target; reset
  the active calibration after such a change.
- `PowerDeltaPercent >= 0` is an intentionally simple crossover threshold. The
  three-confirmation rule supplies stability; there is no additional power
  hysteresis or curve fitting.
- Learning is WOT-only. Partial-throttle shifts continue to receive the current
  cue but do not train the model.
- Until three stable limiter observations exist, fallback accuracy depends on
  the redline reported by the game.

## Settings

The settings page shows the active configuration, reported redline, learned
ceiling progress, effective target, state, accepted sample count and last power
comparison for each observed pair. It does not diagnose the driver's shift as
"bad" or "too early" when the capture was unusable or the next gear was weaker.

Redline brightness and FDC Shift Light brightness remain independent visual
preferences. The FDC Shift Light toggle defaults to ON and affects only cue
visibility.

## Source, build, and release boundary

Canonical Shift Light TypeScript lives in `src/shift-light/`.
`tools/build-shift-light.mjs` generates the checked-in browser runtime bundle
at `overlay/shift-light-engine.js`; the release application does not execute
TypeScript and does not require Node.js or esbuild at runtime.

After changing the canonical source or build tooling, run
`npm run build:shift-light` before the final Node.js test suite. The generated
bundle must retain `src/shift-light/` source labels and contain no obsolete
source path. Completed runtime changes must pass the release verification cycle
and launch check documented in [README](../README.md#build-and-verify) before
the Windows installer is distributed.
