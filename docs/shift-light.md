# Shift Light

## Purpose

Shift Light is the FDC HUD feature that learns a shift target for each source
gear and presents a timing cue in the browser overlay. It uses the normalized
Forza Horizon 6 (FH6) telemetry stream, keeps learning local to the FDC HUD,
and stores calibration in the FDC application data directory.

The feature has a useful fallback before calibration is complete. It does not
require a car-name database or a manual car-card workflow.

## Runtime data flow

The release runtime follows this path:

```text
FH6 Data Out → UDP 127.0.0.1:5301 → native decoder → direct_telemetry
  → queueTelemetry → HudShiftLightRuntime.update
  → ShiftLightLearner.update → hud_shift_light
  → queueShiftLight → ShiftLightPresentation → HUD render
```

The native receiver accepts the normalized 324-byte FH6 packet format and emits
valid packets as `direct_telemetry`. `queueTelemetry` rejects invalid telemetry,
then updates Shift Light before updating the other HUD features. The runtime
creates or reuses the learner, registers and loads the current database
configuration, and publishes a `ShiftLightSnapshot` through the FDC-local
`hud_shift_light` event. The overlay maps the snapshot phase to the light-bar
presentation and schedules a render.

## Vehicle and tune identity

The stable base key is:

```text
fh6:<carOrdinal>:<carClass>:<carPerformanceIndex>:<drivetrainType>:<numCylinders>:<rpmMax>
```

`gameId` is currently `fh6`. All fields come directly from normalized FH6 Data
Out. `carOrdinal` identifies a car model rather than a Garage instance, so
class, performance index, drivetrain, cylinder count, and RPM limit keep
distinct builds apart. The base key is stable across runs.

The UI exposes the current FH6 car ordinal, PI, and RPM limit. It does not
depend on a localized or user-maintained vehicle name.

## Garage association

Shift Light profiles remain owned by their full game-data key and numeric
configuration ID. Garage presents them as part of the matching local
car. This uses the same `fdc.sqlite` database and does not copy calibration
data.

Garage does not render a second Shift Light control or status. Detailed
diagnostics and reset stay in the Shift Light tab for the live vehicle.

## Configuration selection

FH6 sends the current gear, not the transmission maximum. Neither an observed
gear nor repeated limiter observations prove how many gears the gearbox has.
The runtime does not use the learner's legacy `gearCount` estimate to select,
reset, or save a configuration.

On the first forward-gear sample, `resolve_shift_light_config` selects the
most recently used configuration for the full base identity, breaking timestamp
ties by numeric ID. If none exists, it creates one immediately. The learner and
configuration ID remain stable when a higher gear is observed. Qualifying
learning progress is saved without requiring top-gear or limiter evidence.

Existing configurations and profiles retain their immutable numeric SQLite IDs.
No profiles are merged across historical configurations. The legacy `gear_count`
column and older registration commands remain for storage compatibility; new
configurations record the first observed gear there as creation metadata, not
as a transmission maximum. The live runtime does not route by that column.

The existing learner validates targets using adjacent-gear ratio evidence.
Compatible signature growth extends evidence; a contradictory live signature
sets diagnostic state without deleting persisted calibration. Stored optimal
targets remain available while being validated, and incompatible observed
targets are hidden by the learner's compatibility checks.

Resolution and loading are serialized with profile writes. Progress collected
before loading completes is buffered, and storage failures retry after at least
one second on subsequent telemetry without recreating the learner. Responses
from a previous car cannot replace the current car's state.

## Learning evidence

The learner keeps independent evidence for source gears 1 through 10. A pull
is considered only while throttle is at least `0.95`, and a useful limiter or
upshift peak must reach at least `82%` of `rpmMax`.

For observed learning, the learner records the peak RPM from a qualifying
upshift. FH6 may report an upshift through neutral gear `11`; the learner holds
the source-gear pull and accepts the transition only when it completes within
both `200 ms` and `64` telemetry frames. A same-gear RPM drop can also provide
limiter evidence after a second confirming observation. The in-progress pull is
reset for an invalid pull, gear change, or telemetry gap that exceeds `1000 ms`;
stored profile evidence is not erased by these boundaries.

Five observed samples complete a gear profile. The target is the rounded
average of those peak RPM samples minus `75 RPM`. Before that point the gear
remains in `learning` and has no calibrated target.

Evidence is deliberately bounded. Observed profiles retain at most five RPM
samples per gear. Ratio learning retains at most 240 samples per gear, and
optimal-profile evidence is capped at a sample count of 999.

## Shift target calculation

FDC supports two profile methods:

- `observed` is the five-sample target learned from real full-throttle
  upshifts or limiter evidence. It is the fallback calibration method.
- `optimal` compares engine power before the shift with power at the predicted
  post-shift RPM. It uses WOT power bins and the ratio between engine RPM and
  driven-wheel angular speed, so it does not assume a final drive, tire radius,
  or drivetrain-efficiency value.

The optimal estimator accepts clean power and wheel-ratio evidence only at
full throttle (`≥ 0.95`), with clutch `≤ 0.05`, brake and handbrake released,
positive power, valid RPM, and no excessive driven-wheel combined slip. Power
is retained in bounded `200 RPM` bins; a bin needs two samples and uses its
median instead of a single peak. Wheel-ratio evidence uses forward gears,
engine RPM at least `1200`, and driven-wheel speed of at least `5 rad/s`.
After five samples, ratio outliers more than `8%` from the running median are
discarded. Both the current and next gear need at least 20 wheel-ratio samples.

Completed clean upshifts also contribute the direct post-shift/source-peak RPM
drop for their source gear. Three agreeing direct drops are preferred over the
wheel-derived fallback, avoiding a persistent wheel-speed dependency during a
pull. Valid ratio drops are bounded to `0.45` through `0.95`.

An optimal target requires at least eight reliable power bins and reliable
coverage through at least `90%` of `rpmMax`. Candidate targets are scanned in
`25 RPM` steps from `65%` to `99%` of `rpmMax`; the first crossover is accepted
after three consecutive confirming steps. If no crossover is found, a
validated limiter target at `98%` of `rpmMax` can be used. A confirmed live
limiter observation lowers that fallback by `100 RPM` when necessary; it is
kept in memory only and does not change the persistence format. Three similar
estimates, within `100 RPM`, confirm an optimal profile. Its evidence value is
bounded to 999.

Stored optimal profiles are cache-first: the target is published immediately
after loading and remains available while fresh telemetry validates it. Until a
ratio for the active gear is available the state is `OPTIMAL · VALIDATING`.
When that ratio differs from the stored ratio by more than `2.5%`, the state is
`OPTIMAL · GEARBOX CHECK`; this is non-destructive and does not erase the saved
target. A profile learned before the first live gearbox signature is bound to
that first signature rather than being invalidated. `observed` profiles remain
strict: confirmed incompatible gearbox evidence hides their target and returns
the gear to learning.

## Visual behavior

The learner publishes one of three phases: `normal`, `approach`, or `shift`.
With no usable target, the fallback phase is based on RPM fraction: approach
starts at approximately `85%` of `rpmMax`, and the shift phase starts at
`98%`.

With a calibrated target, the phase is based on that gear's target RPM. When a
positive RPM rate is available for the same forward gear under WOT, FDC leads
the cue predictively:

- shift lead: up to `180 ms`, capped at `1200 RPM`;
- approach lead: up to `380 ms`, capped at `1800 RPM`, while preserving a
  minimum approach window of `max(250 RPM, 4% of target RPM)`.

The `shift` phase is rendered as a flashing purple light bar. The `approach`
phase uses the redline presentation. The shift presentation has a minimum
`250 ms` latch, so a single short telemetry update cannot hide the cue
immediately.

## Configuration and reset

The `SHIFT LIGHT` settings tab shows the current car identity, PI, RPM limit,
current target, overall state, per-gear targets, and diagnostics. Its primary
states are `LEARNING`, `OBSERVED`, `OPTIMAL`, and `NEW GEARBOX · LEARNING`.
Power-curve and ratio collection reasons remain row-level detail instead of
being the primary state.

Light-bar brightness is configurable from `0%` to `100%` in the UI and defaults
to `80%`. The preference is stored separately in the browser preference key
`fdc.display-preferences.v1`. Brightness filters the light-bar background; it
does not dim the gear, speed, or RPM text.

`RESET CURRENT CALIBRATION` clears profiles for the active numeric
configuration while retaining its game-data identity. The result is reported
only after the SQLite operation completes. The in-memory learner is then
cleared and the HUD returns to its normal phase.

Pause, disconnect, and short telemetry gaps clear only the in-progress pull.
They do not discard the current car identity, loaded targets, or persisted
learning evidence.

## Local persistence

Shift Light profiles are stored in the FDC-local `fdc.sqlite` under the native
application data directory.

The versioned schema contains:

- `shift_light_cars` for `game_id` and `car_ordinal`;
- `shift_light_configs` for the full game-data identity, legacy gear-count metadata,
  gearbox signature, and immutable numeric IDs;
- `shift_light_config_profiles` for one method/target record per configuration
  and gear;
- `shift_light_config_profile_samples` for bounded observed evidence.

Profile writes are transactional and monotonic. Existing and incoming records
are merged rather than blindly replaced: calibrated status and stronger
evidence are preferred, samples are unioned and deduplicated up to the five
sample limit, and five observed samples can complete a stored profile. Foreign
keys keep profiles and samples attached to their configuration.

## Source and build boundary

The canonical TypeScript source is:

- `src/shift-light/shift-light.ts` — learner, identity, phases, and profile
  methods;
- `src/shift-light/optimal-shift.ts` — power and gearbox-ratio estimator;
- `src/shift-light/telemetry.ts` — the local normalized telemetry type.

`tools/build-shift-light.mjs` bundles the learner into the checked-in browser
module `overlay/shift-light-engine.js`. The bundle exposes `HudShiftLight` and
is loaded by the overlay. The release executable consumes this generated
bundle; it does not run TypeScript or require Node.js or esbuild at runtime.

## Compatibility constraints

The following are runtime and persistence contracts:

- the base key format
  `fh6:<carOrdinal>:<carClass>:<carPerformanceIndex>:<drivetrainType>:<numCylinders>:<rpmMax>`;
- the learner exports used by `HudShiftLight`;
- normalized telemetry fields consumed by the learner;
- the `overlay/shift-light-engine.js` browser bundle path;
- FDC-local `hud_shift_light` and reset-result events;
- the HUD-local SQLite schema and migration behavior;
- immutable numeric configuration IDs and full base-identity isolation.

Source relocation must not change learner behavior, profile identity,
serialized profile fields, native/browser event names, or the database schema.

## Verification

When Shift Light source or build tooling changes, rebuild the generated bundle
from the repository root:

```powershell
npm run build:shift-light
```

Run the full Node.js test suite once after the final Shift Light changes and
verify `overlay/shift-light-engine.js`. The generated bundle must use the
canonical `src/shift-light/` source labels and contain no obsolete source path.
Runtime behavior and compatibility contracts must remain unchanged.

For a completed runtime code task, use the release verification cycle described
in [README.md](../README.md#build-and-verify). Do not repeat checks that
already passed for the same final state. Run `npm ci` only when dependencies
are not installed or dependency manifests have changed.

## Current limitations

- The implementation is for FH6 normalized Direct Data Out telemetry only.
- Valid car ordinal, class, performance index, drivetrain, cylinder count, and
  RPM limit are required to establish a persisted base identity.
- The total gear count is unknown. A gearbox change that preserves the full
  base identity is assessed through the existing ratio diagnostics; automatic
  archival and selection of separate gearbox generations is not implemented.
- Learning is per source gear and requires driving the gear. It does not
  pre-populate targets for unseen gears.
- Optimal targets are unavailable until enough WOT power and adjacent-gear
  ratio evidence has been collected; the feature then remains on observed or
  fallback behavior while candidates are being confirmed.
- There is no manual target-entry workflow or car-name database. Calibration
  comes from live telemetry and the local FDC database.
