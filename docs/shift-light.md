# Shift Light

## Purpose

Shift Light finds a practical full-throttle upshift point independently for
each real next-gear pair (`1 → 2`, `2 → 3`, and so on). It works the point out
from the engine's power curve and the gear ratios seen in telemetry, checks it
against real shifts, and otherwise learns it from the shifts themselves. See
[Model shift points](#model-shift-points).

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
pair. Until the limiter has been measured reliably, the provisional ceiling
stands in for it. It is the highest limiter observation at or above 85% of the
reported redline, raised to the highest RPM the engine has reached on clean
full throttle in this run, because the engine cannot run above its limiter. A
first limiter hit is usually within about 2% below the real limiter, and the
value only rises during a run. Without such an observation there is no
provisional ceiling, even after high RPM: following the climbing RPM alone
would light the cue on every pull.
The Configuration shows it as `LEARNING · 1/3 · ~9,195 RPM`.

The learner's fallback effective target is the provisional ceiling. Before one
exists, it is the current positive game-reported redline. The learner's
comparison baseline is the usable ceiling or, before one exists, the reported
redline; the provisional ceiling is not used there. This means `LEARNING` still
has a usable purple cue; it does not mean "no guidance".

The HUD limiter, which sets the red flash and caps the Shift Bar fill, uses the
usable ceiling, then the provisional ceiling. Before either exists, it estimates
the limiter at 89% of the game's maximum RPM, because real limiters sit at
87–97% of it. See [the HUD shift cue](hud.md#shift-cue).

A learned ceiling requires three stable limiter observations. An observation
comes from a continuous same-gear full-throttle pull that rises by at least
`100 RPM`, reaches a local peak, drops by at least `40 RPM`, and then recovers
to within `60 RPM` of that peak. FDC keeps the highest 12 observations; lower
observations are discarded. When the reported redline is known, only observations
at or above 85% of it are considered, because the limiter is the highest RPM the
engine holds and lower detections are false. For the same reason, an
observation more than `400 RPM` below the highest RPM the engine has reached on
clean full throttle in this run is not a limiter hit: it is not recorded, and
existing observations are removed, and the usable ceiling derived again, as
soon as the engine passes them by that margin. Wheelspin on full throttle can
make RPM rise, dip, and recover well below the limiter; without this rule such
peaks became the provisional ceiling and moved the cue hundreds of RPM early.
That highest RPM is kept in memory only and starts again after a restart or a
reset. A group is one considered
observation together with the considered observations within `100 RPM` below it.
Scanning from the highest considered observation down, the usable ceiling is the
median of the first group that holds at least three observations; for an
even-sized group the lower of the two middle values is used. If a considered
observation lies above that group's top by no more than `400 RPM`, no ceiling is
accepted yet, because the real limiter is probably still collecting evidence;
a group of six or more observations is accepted regardless, so one stray high
observation cannot block the ceiling permanently. Observations more than
`400 RPM` above are isolated spikes and do not block it.
A single maximum or flat RPM value is not sufficient limiter evidence.

If a comparable shift produces a negative power delta, no special fallback
learner is started. The current safe baseline simply remains the answer.

## Comparable shift capture

For a real `G → G+1` upshift, FDC keeps at most five clean source-gear frames
from the preceding `200 ms`. A source-gear frame counts only after `150 ms` of
uninterrupted clean full-throttle power in that gear, and a frame that is not
clean, or a different gear, starts that period again. After the limiter or any
other interruption cuts power, it comes back reduced and ramps up; in one
recorded case it was still about 5% low `94 ms` later. A shift made inside that
ramp would compare the next gear against too little power and report a
crossover that does not exist, so it is ignored: the first clean frame after
an interruption starts a new period and discards the frames collected before
it. A frame that is not clean only ends the period. Frames collected before it
stay usable within the `200 ms` window, because pressing the clutch or lifting
off is how a shift starts; a driver who presses the clutch at full throttle
still gets the shift compared against the settled power before the press.
FDC waits
`80 ms` after the transition to pass the initial torque cut, then requires
three clean positive-power destination-gear frames within a `600 ms` capture
window. Median values from the two windows
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
  is the learned usable ceiling, then the provisional ceiling, or until either
  exists, the reported redline.
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

These states learn a point only at an RPM where the driver actually shifted,
so they never find a point below it. A model shift point, when one is in use,
outranks them.

## Model shift points

While driving, the learner keeps a power curve and gear ratios for the active
configuration in memory. They start empty in every run and are cleared by a
reset.

- **Power curve.** Every clean full-throttle frame that is at least `150 ms`
  into an uninterrupted clean run in its gear (the same settle rule as
  comparable shift capture) adds its engine power to a `100 RPM` bin. A bin
  keeps its latest 32 values, needs at least 3, and its value is the 90th
  percentile. Frames with wheelspin count, because engine power does not
  depend on it.
- **Gear ratios.** The same frames above `20 km/h` with every wheel's slip
  ratio below `0.15` add `rpm / speed` to their gear. A gear keeps its latest
  64 values, needs at least 10, and its ratio is the median.

For a pair `G → G+1` with both ratios and a known ceiling (the usable ceiling,
else the provisional ceiling), the step is `ratio(G+1) / ratio(G)`. From the
power-peak bin up to the ceiling, every `50 RPM` where the power at that RPM
and at that RPM times the step are both known is compared, with linear
interpolation between bin centres; unknown points are skipped. The model point
is the first RPM where the next gear has at least as much power, but only
after a known point where the current gear was still stronger, because
otherwise the crossover may lie in a gap. Without a crossover, the model point
is the ceiling when the known points reach within `200 RPM` of it. The known
points must be at least half of the points scanned up to the result; otherwise
there is no model point. The model is recomputed when its data or the ceiling
changes, at most every `250 ms` of telemetry time.

Real comparable shifts check the point. A shift more than `150 RPM` above it
agrees when the next gear had at least as much power and contradicts it
otherwise; a shift more than `150 RPM` below it agrees when the next gear had
less power and contradicts it otherwise; shifts within `150 RPM` are neutral.
With at least two contradictions that outnumber the agreements, the point is
rejected for that pair, and the pair uses the learning states above. A turbo
lag after a shift, which the steady power curve cannot show, appears this way.
The game's `boost` value is not used: it stays almost constant while driving.

The point in use is saved with the pair's target. After a restart the saved
point is used, and checked against the saved comparisons, until the new run's
model places a point for the pair, which then replaces it. A rejected point is
not saved.

## Cue timing

The desired shift RPM and cue-on RPM are different values:

```text
leadRPM = currentPositiveRpmRate × 0.15 seconds
cueOnRPM = effectiveTargetRPM - leadRPM
```

The lead is clamped to `100–1000 RPM`; when a reliable acceleration rate is not
available it defaults to `200 RPM`. FH6 sends two different packets for each
game timestamp, so a frame with the same timestamp as the previous one keeps
the current rate instead of resetting it; otherwise the lead would jump to
the default on every second frame. The effective target priority is model
shift point, confirmed target, potential candidate, usable ceiling,
provisional ceiling, then reported redline. The snapshot status is
`calibrated` when the current gear's pair has a model point in use or is
`POTENTIAL` or `OPTIMAL`. The visual
presentation latches the purple shift phase for at least `250 ms` so a brief
telemetry change cannot erase the cue immediately.

## Last known gear

The published state includes `lastKnownGear: boolean`. It is `true` when the
current forward gear is the highest gear known for the configuration, meaning
the car has never been upshifted from it:

```text
lastKnownGear = currentGear !== null && currentGear >= highestKnownGear
highestKnownGear = max(highest gear observed this session,
  highest gear proven by the learning state)
```

The learning state proves a gear in two ways: any gear target row proves its
source gear exists, and a row with accepted shift evidence for `G → G+1` also
proves gear `G+1` exists. Gear 10 is always the last known gear. The field is
derived from existing state and is not persisted; its value is `false` in
empty and fallback states. `phase` keeps its `normal`, `approach` and `shift`
values. The field is excluded from the Configuration change signature because
the Configuration window does not render it and it only changes with
`currentGear`.

## Persistence

The schema contains exactly four Shift Light tables. They were rebuilt in
schema version 15; version 24 added the nullable `model_rpm` to
`shift_light_gear_targets`, with existing rows keeping `NULL`.

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
  rpm                                     positive; at most 12 per save, in ascending RPM order

shift_light_gear_targets
  config_id + source_gear
    + destination_gear                    primary key
  source_gear                             1–9
  destination_gear                        exactly source_gear + 1
  status                                  learning | potential | optimal
  candidate_rpm
  optimal_rpm
  confirmation_count                      0–3
  model_rpm                               nullable positive model point in use
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
`RESET CURRENT CALIBRATION` first asks `ARE YOU SURE?` with `YES` and `NO`.
`NO` is selected, and Escape or a click outside the question also answers
`NO`. If the current car changes while the question is open, `YES` resets
nothing and the status line says so.

## Native persistence contract

The browser runtime uses four native commands:

- `resolve_shift_light_config` validates the vehicle key and observed gear,
  creates or resolves the numeric configuration ID, and updates a supplied
  reported redline;
- `load_shift_light_calibration` verifies that the numeric ID belongs to the
  supplied key and returns the compact model-version-4 state;
- `save_shift_light_calibration` transactionally replaces ceiling samples,
  targets and shift samples for that configuration; malformed child records
  are skipped instead of invalidating the remaining compact state, and a
  target's malformed `modelRpm` is saved as `NULL`;
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
  hysteresis.
- The model point needs a full-throttle pull across the RPM range and enough
  frames without wheelspin in both gears of a pair; a gear that always spins
  gets no ratio and its pairs keep the learning states. A turbo lag after a
  shift is only caught through contradicting real shifts.
- Learning is WOT-only. Partial-throttle shifts continue to receive the current
  cue but do not train the model.
- Until three stable limiter observations exist, fallback accuracy depends on
  the provisional ceiling and, before the first limiter hit, on the redline
  reported by the game.

## Settings

The Shift Light tab in Configuration opens with a short intro. Once a car has a
profile, a `CURRENT CAR PROFILE` card shows the car, its class, the reported
RPM limit, learned ceiling progress, current target and state. CURRENT TARGET
reads `READY · 7,500 RPM` or `LEARNING · 9,001 RPM` for the current gear's
pair, and STATE reads `READY · GEAR 2` or `LEARNING · GEAR 2`. Reported and
learned RPM values use thousands separators, for example `9,360 RPM`, matching
the in-game HUD. The LEARNED CEILING row shows `9,195 RPM · 3/3` once a ceiling
exists, where the trailing count is the size of the accepted group, capped at
three. Before a ceiling exists it shows `LEARNING · 2/3 · ~9,195 RPM` once any
observation is at or above 85% of the redline. The tilde value is the
provisional ceiling, and the count is the size of the group at the highest
considered observation, capped at three. When every observation is below 85% of
the redline it shows `LEARNING · 0/3`, and `NOT OBSERVED` when there are none.
Below the metadata, a table has three columns for each observed pair: GEAR
(`1 → 2`), SHIFT AT (the pair's effective target, or the fallback ceiling when
it has none) and STATUS. STATUS is `READY` when the pair has a model point in
use or is `OPTIMAL`, and `LEARNING` otherwise. Model details, confirmations and
power comparisons are not shown there; they are in the snapshot diagnostics
and the Shift Lab report. The help panel explains `LEARNING` and `READY`. The
`RESET CURRENT CALIBRATION` button sits
directly below the card and stays hidden until a car profile exists. The
tab does not diagnose the driver's shift as "bad" or "too early" when the
capture was unusable or the next gear was weaker.

Redline brightness and FDC Shift Light brightness remain independent visual
preferences. Redline uses five explicit 96%-opaque background-color anchors:
`#120302` at 0%, `#4D0D0C` at 25%, `#8F1B18` at 50%, `#CF2824` at 75%, and
`#FF312B` at 100%; intermediate values are linearly interpolated per RGB
channel, so the 80% default is `#D92A25`. FDC Shift Light keeps its animated
purple background and maps 80% to `filter: brightness(1)`. Its toggle defaults
to ON and affects only cue visibility. Existing saved redline brightness
values remain unchanged.

## Shift Lab recording

Shift Lab keeps real drives so the learner can be replayed and checked against
them. It does not change Shift Light learning, its cue, or `fdc.sqlite`.

The Direct Data Out receiver hands every valid 324-byte packet whose
`IsRaceOn` is `1` to a recorder that stores it unchanged in `fdc-lab.sqlite`,
next to `fdc.sqlite` in the application-data directory. Menu and pause packets
are not stored. Recording is always on and has no setting. The recorder runs on
its own thread behind a bounded channel of 4,096 packets; when the channel is
full, packets are dropped instead of delaying the HUD, and a failing database
only stops recording.

```text
lab_schema_version   version 1
lab_sessions         id, started_at_ms, finished_at_ms, app_version,
                     shift_light_model_version, car_ordinal, car_class,
                     car_pi, car_drivetrain, car_cylinders, packet_count
lab_packets          id, session_id, sequence, received_at_ms,
                     packet (324 bytes)
```

Times are wall-clock UNIX milliseconds of reception. A new session starts when
the car identity (ordinal, class, PI, drivetrain, cylinders) changes or when
more than `2000 ms` passes between packets. Packets are written in one
transaction at least every `500 ms`. FH6 sends about 130 packets a second, two
different packets per game timestamp, and both are stored. The database is
limited to 200 MB, about one hour of driving: when it is larger, the oldest
sessions are deleted
first, and if only the current session remains, its oldest packets are. The
file uses the default rollback journal, so it is complete after every commit.

`tools/shift-lab.mjs` replays a copy of the file. It decodes each packet into
the same payload the HUD receives, feeds every car's sessions in order into one
fresh Shift Light learner from the checked-in bundle, and reports per car:

- the learned ceiling, and every gear pair's state and shift point, including
  the model shift point with READY or LEARNING, and whether real shifts
  rejected it;
- each purple cue, each real upshift, whether the learner accepted it, the
  tool's own guess at why not (`partial-throttle`, `clutch`, `brake`,
  `no-power`, `capture-incomplete`), and the time from the cue to the shift;
- an independent reference shift point per pair, flagged when it differs from
  the learner by more than `150 RPM`. The power curve uses full-throttle
  frames in 100-RPM bins, including frames with wheelspin, because engine
  power does not depend on it; gear ratios use only frames without wheelspin.
  From the power peak to the ceiling, every 50 RPM where both the current gear
  and the next gear's RPM are known is compared, and gaps are skipped. The
  first point where the next gear has at least as much power is a `crossover`;
  if the next gear already wins at the first known point, the result is
  `at-or-below` that RPM. Without a crossover, the result is `at-ceiling` when
  the known points reach within `200 RPM` of the ceiling, otherwise
  `insufficient-data`. `cov` is the share of points that were known. The
  reference ignores the boost drop after a shift, so turbocharged cars can show
  an earlier reference point;
- with `--fdc`, the ceiling and pair states stored in a copy of `fdc.sqlite`
  next to the replay result.

A fair comparison with `fdc.sqlite` needs a calibration that was reset before
the recorded drives, because older learning is not in the recording. See
[the replay command](development.md#shift-lab-replay).

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
