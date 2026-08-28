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
variant, and publishes a `ShiftLightSnapshot` through the FDC-local
`hud_shift_light` event. The overlay maps the snapshot phase to the light-bar
presentation and schedules a render.

## Vehicle and tune identity

The learner key is:

```text
fh6:<carOrdinal>:<PI>:<rpmMax>
```

`gameId` is currently `fh6`. `carOrdinal`, `PI`, and `rpmMax` must be finite
positive values; the key uses rounded ordinal, PI, and RPM-limit values. PI and
RPM max are part of the base tune identity, so changing either starts a
separate learning context. The key is stable across runs and is the
compatibility contract for persisted profiles.

The UI exposes the current FH6 car ordinal, PI, and RPM limit. It does not
depend on a localized or user-maintained vehicle name.

## Gearbox variants

Each base identity can have more than one gearbox variant. A variant is
identified by an immutable numeric SQLite `variantId` and stores a normalized
gearbox signature made from adjacent-gear ratio drops.

The first valid vehicle identity creates or reuses a provisional variant,
before calibration is complete. Once at least two adjacent ratio drops are
reliably detected, FDC compares the signature with resolved variants for the
same car ordinal, PI, and RPM max:

- no detected signature keeps the variant provisional;
- one compatible resolved match promotes or merges into that resolved row;
- no compatible resolved match promotes the provisional row into a new
  resolved variant;
- multiple compatible matches remain ambiguous and keep learning on the
  provisional variant.

Known ratio features must agree within an absolute `0.005` tolerance. New
higher-gear features can extend a compatible signature. A material ratio
contradiction creates a separate resolved variant. When records are merged,
the surviving numeric ID is retained; the ID is not recomputed from the
signature.

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

The optimal estimator accepts power samples at throttle `≥ 0.95`, clutch `≤
0.05`, positive power, and valid RPM data. Power is binned at `100 RPM`; a bin
needs at least three samples. Ratio evidence uses forward gears, engine RPM
at least `1200`, clutch `≤ 0.05`, and driven-wheel speed of at least `5 rad/s`.
Both the current and next gear need at least 20 ratio samples. Valid ratio
drops are bounded to `0.45` through `0.95`.

An optimal target requires at least eight reliable power bins and reliable
coverage through at least `90%` of `rpmMax`. Candidate targets are scanned in
`25 RPM` steps from `65%` to `99%` of `rpmMax`; the first crossover is accepted
after three consecutive confirming steps. If no crossover is found, a
validated limiter target at `98%` of `rpmMax` can be used. Three similar
estimates, within `100 RPM`, confirm an optimal profile. Its evidence value is
bounded to 999.

When a stored optimal profile is loaded, its live ratio drop must remain within
`2.5%` relative difference. Otherwise the gear is reported as a gearbox
mismatch instead of using the stored optimal target.

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
current target, overall state, per-gear targets, and diagnostics. Diagnostics
distinguish observed, optimal, learning, waiting-for-WOT, waiting-for-ratio,
confirming, and gearbox-mismatch states.

Light-bar brightness is configurable from `0%` to `100%` in the UI and defaults
to `80%`. The preference is stored separately in the browser preference key
`fdc.display-preferences.v1`. Brightness filters the light-bar background; it
does not dim the gear, speed, or RPM text.

`RESET CURRENT CALIBRATION` targets the active numeric variant. The native
reset also deletes the provisional variant for the same car ordinal, PI, and
RPM max, while leaving other resolved gearbox variants intact. The result is
reported only after the SQLite operation completes. The in-memory learner is
then cleared and the HUD returns to its normal phase.

Pause, disconnect, and short telemetry gaps clear only the in-progress pull.
They do not discard the current car identity, loaded targets, or persisted
learning evidence.

## Local persistence

Shift Light profiles are stored in the FDC-local `fdc.sqlite` under the native
application data directory.

The versioned schema contains:

- `shift_light_cars` for `game_id` and `car_ordinal`;
- `shift_light_variants` for PI, RPM max, gearbox signature, provisional state,
  and immutable numeric IDs;
- `shift_light_profiles` for one method/target record per variant and gear;
- `shift_light_profile_samples` for bounded observed evidence.

Profile writes are transactional and monotonic. Existing and incoming records
are merged rather than blindly replaced: calibrated status and stronger
evidence are preferred, samples are unioned and deduplicated up to the five
sample limit, and five observed samples can complete a stored profile. Foreign
keys keep profiles and samples attached to their variant.

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

- the key format `fh6:<carOrdinal>:<PI>:<rpmMax>`;
- the learner exports used by `HudShiftLight`;
- normalized telemetry fields consumed by the learner;
- the `overlay/shift-light-engine.js` browser bundle path;
- FDC-local `hud_shift_light` and reset-result events;
- the HUD-local SQLite schema and migration behavior;
- the separation between provisional and resolved numeric variant IDs.

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
- A valid positive car ordinal, PI, and RPM max are required to establish a
  persisted vehicle identity; without them the runtime cannot create or load a
  matching identity.
- Learning is per source gear and requires driving the gear. It does not
  pre-populate targets for unseen gears.
- Optimal targets are unavailable until enough WOT power and adjacent-gear
  ratio evidence has been collected; the feature then remains on observed or
  fallback behavior while candidates are being confirmed.
- Multiple compatible gearbox records can remain ambiguous, in which case
  learning continues provisionally instead of selecting a database row by
  guesswork.
- There is no manual target-entry workflow or car-name database. Calibration
  comes from live telemetry and the local FDC database.
