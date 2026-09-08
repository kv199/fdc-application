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
shift. The evidence outcome is:

- `better` with reason `POWER_CROSSOVER` when the next gear's proxy is higher;
- `rpm_ceiling` with reason `RPM_CEILING` when the next gear is weaker but the
  shift occurred within `100 RPM` of a trusted learned engine ceiling;
- `too_early` when the next gear is weaker and more usable RPM remained; or
- `invalid` when the transition failed the clean-data requirements.

The ceiling is global to the active vehicle configuration, while shift targets
remain per source gear. A ceiling sample is accepted only from a continuous
clean same-gear WOT pull that rises to a local peak, drops by at least `40 RPM`,
and recovers to within `60 RPM` of that peak. A plain WOT maximum or plateau is
not limiter evidence. The limiter's power-cut frame may report zero or negative
engine power; it remains usable for the RPM pattern but is never added to power
bins or shift-force evidence. Only one ceiling sample is accepted from a
continuous pull.
Three independent samples with a total spread no greater than `100 RPM`
produce the median `usableCeiling`. Three consistent observations at a
materially different limiter replace a stale ceiling after a tune change.

`rpmMax` remains the game-reported redline and a telemetry sanity value. Most
cars learn through a power crossover without touching the limiter. Limiter
learning is used only for the no-crossover fallback and never reintroduces a
ratio estimate, predicted post-shift RPM, or power-curve coverage requirement.

## Learning states and target selection

Each source gear has exactly these visible states:

- `LEARNING` — collecting clean power data, learning the limiter ceiling when
  necessary, or waiting for a clean accepted shift. No purple cue is displayed.
  A clean early shift remains `LEARNING` and states that the next gear produced
  less wheel force.
- `CONFIRMING 1/3` or `CONFIRMING 2/3` — the first clean power-crossover or
  RPM-ceiling shift created a candidate. Purple is displayed at the candidate
  RPM while it is being confirmed.
- `OPTIMAL` — three accepted clean shifts within a `100 RPM` total range
  confirmed the target. The target is the earliest RPM in that confirmation
  range, and purple flashes at that RPM so the driver can shift as soon as it
  appears.

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
per-gear state and candidates, RPM power bins, completed shift evidence, and
the configuration-level limiter samples and usable ceiling. The current
in-progress pull is deliberately transient. All completed power data, candidate
counts, confirmed targets, and ceiling samples survive application restart and
switching away from and back to a car.

The state carries an internal learning-model version. FDC loads only a
compatible version, preventing a later learner from silently interpreting old
facts under changed rules. Database writes are transactional and retry after a
failure; a save failure is surfaced in the Shift Light settings status rather
than being silently ignored.

This learned-ceiling generation is a breaking Shift Light model migration. On
first launch it clears the previous generation's Shift Light learning facts
because former `too_early` evidence cannot be reinterpreted safely without a
trusted historical ceiling. Stable vehicle configuration rows remain available;
Garage and Events data are not changed. Old Shift Light records are not used or
shown as current calibration.

`RESET CURRENT CALIBRATION` removes the active configuration's Shift Light
learning facts and restarts that configuration at `LEARNING`. Other cars and
configurations remain intact.

## Settings and presentation

The Shift Light settings tab shows the current FH6 car ordinal, PI,
game-reported RPM limit, and learned ceiling progress. Its table lists each
source gear's shift point, number of RPM power bins, completed-shift count and
last clean-shift reason, and its visible state. It intentionally omits legacy
ratio, predicted-after-shift, coverage, and Observed fields.

Redline brightness and FDC Shift Light brightness are separate preferences.
Redline defaults to `60%`; FDC Shift Light defaults to `80%`. Both are visual
only. The FDC Shift Light toggle defaults to ON and affects only purple cue
visibility; the learner remains active while it is off.
