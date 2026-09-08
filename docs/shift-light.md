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
of gearbox ratios, so FDC creates a pair only after observing a real `G → G+1`
transition.

## Safe baseline and usable ceiling

The usable engine ceiling is the safe baseline target for every unlearned gear
pair. Until the limiter has been measured reliably, the current positive
game-reported redline is used instead. This means `LEARNING` still has a usable
purple cue; it does not mean "no guidance".

A learned ceiling requires three stable limiter observations. An observation
comes from a continuous same-gear full-throttle pull with a meaningful rise,
a local peak, a limiter drop, and recovery near that peak. The median of three
observations whose total spread is no more than `100 RPM` becomes the usable
ceiling. A single maximum or flat RPM value is not sufficient limiter evidence.

If the next gear remains less powerful all the way to the ceiling, no special
fallback learner is started. The baseline simply remains the answer: keep
revving to the usable ceiling.

## Comparable shift capture

For a real `G → G+1` upshift, FDC keeps a short window of clean telemetry before
the transition, waits past the immediate torque cut, and then collects clean
positive-power frames in the destination gear. Median values from the two
windows provide:

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

A comparable sample requires full throttle, released clutch, brake and
handbrake, positive RPM, positive power and positive vehicle speed. The
temporary shift interval itself may contain zero or negative power; those
torque-cut frames are skipped rather than treated as the destination gear's
power. Partial-throttle, incomplete, stale or otherwise uncapturable shifts are
ignored silently. They are not labelled bad or too early.

Torque, wheel speed, slip and a reconstructed `power / speed` force proxy are
not inputs to this decision.

## Per-pair learning states

Each observed source/destination pair has one of three states:

- `LEARNING` — no earlier crossover has been demonstrated. The effective target
  is the learned usable ceiling or, until then, the reported redline.
- `POTENTIAL` — a comparable shift produced `PowerDeltaPercent >= 0` and created
  an earlier candidate.
- `OPTIMAL` — three non-negative candidates fit within a `100 RPM` range. Their
  median is the confirmed target.

A negative comparison is retained as bounded diagnostic evidence but does not
create a candidate and does not replace the redline baseline. A later
non-negative observation outside the current candidate's `100 RPM` range starts
a new potential sequence. Confirmed targets remain per gear pair.

## Cue timing

The desired shift RPM and cue-on RPM are different values:

```text
leadRPM = currentPositiveRpmRate × 0.15 seconds
cueOnRPM = effectiveTargetRPM - leadRPM
```

The lead is clamped to `100–500 RPM`; when a reliable acceleration rate is not
available it defaults to `200 RPM`. The effective target is the pair's
confirmed/potential target when one exists, otherwise the usable ceiling or
reported redline.

## Persistence

Schema version 15 contains exactly four Shift Light tables:

- `shift_light_configs` — stable configuration identity, reported redline,
  learned usable ceiling, model version, and first/last-seen timestamps;
- `shift_light_ceiling_samples` — up to three positive limiter RPM samples for
  a configuration;
- `shift_light_gear_targets` — one row per real `G → G+1` pair with state,
  candidate RPM, confirmed RPM, and confirmation count;
- `shift_light_shift_samples` — a bounded journal of accepted before/after RPM,
  positive before/after power, delta percent, timestamps and classification.

There is no learner JSON blob, RPM power-bin table, materialized legacy state,
gear-ratio signature, torque/speed history, or separate no-crossover table.
Writes replace the compact state transactionally, and unchanged snapshots are
not written repeatedly.

This is learning model version 4 and a breaking persistence migration. Upgrading
to schema 15 preserves stable configuration identities where possible but
discards older Shift Light learning facts whose meanings are incompatible.
Garage and Events data are not changed. Reset removes learning rows only for
the active configuration.

## Settings

The settings page shows the active configuration, reported redline, learned
ceiling progress, effective target, state, accepted sample count and last power
comparison for each observed pair. It does not diagnose the driver's shift as
"bad" or "too early" when the capture was unusable or the next gear was weaker.

Redline brightness and FDC Shift Light brightness remain independent visual
preferences. The FDC Shift Light toggle defaults to ON and affects only cue
visibility.
