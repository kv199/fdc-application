# Shift Light

## Purpose

Shift Light learns a useful upshift point independently for each source gear
from live, normalized Forza Horizon 6 telemetry. It provides two separate
visual cues in the FDC HUD:

- the red redline, driven by the RPM limit reported by the game; and
- a flashing purple FDC Shift Light once a gear has a confirmed shift point.

The purple ON/OFF preference controls only the purple display. It never stops
data collection, transition evaluation, or persistence.

## Runtime data flow

```text
FH6 Data Out → UDP 127.0.0.1:5301 → native decoder → direct_telemetry
  → queueTelemetry → HudShiftLightRuntime.update
  → ShiftLightLearner.update → hud_shift_light → HUD render
```

Shift Light uses the existing normalized telemetry path. It does not create an
additional telemetry transport or use a car-name database.

## Vehicle configuration

The stable learning key is:

```text
fh6:<carOrdinal>:<carClass>:<carPerformanceIndex>:<drivetrainType>:<numCylinders>
```

The key identifies a car build from FH6 data. `rpmMax` is intentionally not a
learning-key field: it is a current game-reported redline value, not evidence
that a different Shift Light calibration is needed. A PI or other key-field
change selects a separate saved configuration.

FH6 reports the current gear, not a gearbox's total number of gears. FDC does
not infer or require that total. A final gear without a following gear can
still collect its power data, but cannot form an upshift target until a real
next-gear transition exists.

## What is collected

For every clean full-throttle sample in a forward gear, FDC retains bounded
power data for that source gear: RPM buckets, power, torque when available,
and speed. This collection is continuous; it is not restricted to candidate
or Optimal learning.

A clean sample requires:

- an active race when FH6 explicitly reports race state;
- throttle of at least `0.95`;
- clutch at most `0.05`, brake and handbrake released;
- valid positive RPM, power, and vehicle speed; and
- no excessive driven-wheel combined slip.

On a completed clean real `Gx → Gx+1` shift, FDC records bounded evidence with
the source and destination RPM, power, torque, speed, timestamps, and outcome.
The decision compares a traction proxy, `power / speed`, before and after the
shift. The next gear is `better` only when its proxy is higher; otherwise the
clean shift is recorded as `too_early`. Invalid transitions are retained only
as bounded internal evidence and never become a separate UI status.

`rpmMax` drives the red redline and is a telemetry sanity value. FDC never
requires a limiter hit, a limiter observation, a ratio estimate, a predicted
post-shift RPM, or a power-curve coverage percentage to learn a purple target.

## Learning states and target selection

Each source gear has exactly these visible states:

- `LEARNING` — collecting clean power data or waiting for a clean shift where
  the next gear pulls harder. No purple cue is displayed. A clean early shift
  remains `LEARNING` and states that the next gear produced less wheel force.
- `CONFIRMING 1/3` or `CONFIRMING 2/3` — the first clean `better` shift created
  a candidate. Purple is displayed at the candidate RPM while it is being
  confirmed.
- `OPTIMAL` — three clean `better` shifts within a `100 RPM` range confirmed
  the target. The target is the earliest RPM in that confirmation range, and
  purple flashes at that RPM so the driver can shift as soon as it appears.

Later engine power by itself does not displace an earlier target. For example,
if two shifts improve by the same amount, a later RPM only confirms the first
candidate when they are within the confirmation range. An existing Optimal
point stays active if it is contradicted by a clean shift at that point; FDC
then requires a separate three-shift later candidate before it replaces the
confirmed point. This avoids changing a proven cue because of one run.

There is no `OBSERVED` state and no five-shift average-minus-75-RPM rule.

## Persistence and reset

Shift Light stores its structured learning state in FDC-local `fdc.sqlite` in
the application-data directory. It persists only bounded normalized facts:
per-gear state and candidates, RPM power bins, and completed shift evidence.
The current in-progress pull is deliberately transient. All completed power
data, candidate counts, and confirmed targets survive application restart and
switching away from and back to a car.

The state carries an internal learning-model version. FDC loads only a
compatible version, preventing a later learner from silently interpreting old
facts under changed rules. Database writes are transactional and retry after a
failure; a save failure is surfaced in the Shift Light settings status rather
than being silently ignored.

This learner generation is a breaking persistence migration. On first launch,
it removes only legacy Shift Light rows from `fdc.sqlite` and starts fresh with
the structured state. Garage and Events data are not changed. Old Shift Light
records are not used or shown as current calibration.

`RESET CURRENT CALIBRATION` removes the active configuration's Shift Light
learning facts and restarts that configuration at `LEARNING`. Other cars and
configurations remain intact.

## Settings and presentation

The Shift Light settings tab shows the current FH6 car ordinal, PI, and
game-reported RPM limit. Its table lists each source gear's shift point, number
of RPM power bins, completed-shift count and last clean-shift reason, and its
visible state. It intentionally omits legacy ratio, predicted-after-shift,
coverage, and Observed fields.

Redline brightness and FDC Shift Light brightness are separate preferences.
Redline defaults to `60%`; FDC Shift Light defaults to `80%`. Both are visual
only. The FDC Shift Light toggle defaults to ON and affects only purple cue
visibility; the learner remains active while it is off.
