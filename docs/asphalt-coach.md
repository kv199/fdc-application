# Asphalt Coach

## Purpose and boundaries

Asphalt Coach is a local-first, zero-reference technique assistant for asphalt
driving in Forza Horizon 6. It is intended for Road, Street, Rivals, Circuit,
and Sprint asphalt events. The driver must select an asphalt event; the Coach
does not classify Road, Dirt, or Cross Country from telemetry.

The Coach analyzes the current driving attempt against a learned envelope from
the same car session. It can surface one brief technique cue when independent
evidence is strong enough. It is not a track analyzer or a lap-time authority.
It does not infer track identity, an ideal line, a driving score, exact metres
or seconds of loss, late-throttle claims, wrong-apex claims, or optimal-gear
advice. Its envelope is kept in memory and is not written to `fdc.sqlite`.

## Runtime data flow

The release path is:

```text
FH6 Data Out → UDP 127.0.0.1:5301 → native decoder → direct_telemetry
  → queueTelemetry → AsphaltCoachState.update
  → AsphaltCoachFindings.update → AsphaltCoachPresentation.update
  → Coach card render
```

The native receiver decodes valid FH6 packets into normalized telemetry and
emits `direct_telemetry`. `queueTelemetry` handles restart and lap lifecycle,
then passes each usable packet to the transport-independent Coach state. The
state machine produces a normalized snapshot and current calibration bin.
Findings apply evidence gates and return zero or more candidate events. The
presentation layer applies confidence, priority, duration, cooldown, and brief
rules before the overlay renders the Coach card.

The Coach has no network service or external analysis dependency. The same
state, findings, and presentation modules are used by the browser fixture and
demo tests, but demo data is not a production telemetry source.

## Attempt lifecycle

The state machine exposes the map-free phase sequence:

```text
STRAIGHT → BRAKING → TURN-IN → ROTATION → EXIT
```

The phases are derived from speed, brake, steering, throttle, and normalized
vehicle response. At useful speed, braking begins at brake `0.10`; steering is
considered turning at magnitude `0.12`; steering release is at magnitude
`0.08`; exit can begin when throttle reaches `0.20` or steering is being
released while acceleration is no longer strongly negative.

Findings are scoped to an attempt. A confirmed new attempt clears finding
counts and transient detection state, while retaining the learned envelope for
the same car. An ordinary multi-lap boundary resets transient state without
showing a full brief or discarding accumulated attempt evidence.

The Coach resets transient state and stays silent when telemetry is inactive,
invalid, rewound, or missing for more than `250 ms`. A negative race-clock
rewind of more than five seconds, a lap-number rewind, a lap-distance rewind of
more than `100 m`, a car identity change, or a Direct receiver restart resets
the current session envelope and finding state. A live retry after a confirmed
restart starts a new attempt; a normal resume is not treated as a retry.

An authoritative circuit or sprint completion can show a Driver Brief. If a
valid live attempt becomes paused or stale without an authoritative result,
the UI can show a non-final Run Check instead.

## Calibration

Calibration is a zero-reference envelope, not a reference lap. The in-memory
vehicle identity is:

```text
<carOrdinal>:<PI>:<rounded rpmMax>:<drivetrain>
```

It uses the truncated car ordinal, truncated PI, rounded RPM limit, and
truncated drivetrain value. There is deliberately no track, route, map, or
lap identity in this key. A different car or drivetrain discards the current
session envelope; a confirmed retry with the same identity keeps it.

The envelope has 12 fixed speed bins, each 25 km/h wide, covering 0–300 km/h
with the upper range clamped to the last bin. Samples below 25 km/h do not
calibrate the Coach. Each bin keeps bounded rolling percentile evidence with a
24-sample window for steering, brake, slip, response, and response-change
metrics.

The envelope becomes globally eligible after at least 36 accepted samples span
at least three bins. A bin becomes ready only after it has at least eight
accepted local samples and is frozen. The current snapshot is `ready` only
when both the global envelope requirements and the current bin requirement are
met. Unseen or insufficiently trained speed ranges remain silent and continue
calibrating.

The learned bin stores local percentile and response information, including
steering magnitude and rate, brake load, front and driven slip, lateral and
yaw response, effective acceleration, and transient change rates. Findings use
these local values to scale response and slip thresholds instead of relying on
one global driving cutoff.

## Evidence filtering

Only normalized, continuous, race-on frames with a valid timestamp and speed
can contribute. Repeated packets from the same FH game-clock tick are
coalesced: they do not advance evidence time, while the latest normalized
sample is retained for the next tick.

Calibration excludes a sample when it shows an obvious local failure or a
disturbed surface. The fixed gates include:

- front failure: steering magnitude `≥ 0.28` and front slip `≥ 0.16`;
- power failure: throttle `≥ 0.65` and driven slip `≥ 0.12`;
- combined overload: brake `≥ 0.25`, steering magnitude `≥ 0.22`, and front
  combined slip `≥ 0.85`;
- abrupt release: a previous brake load `≥ 0.35` followed by brake rate
  `≤ -1.5` per second;
- local transient outlier: a transient rate above `2.5` times the learned
  recent 90th-percentile rate.

Rumble contact, any positive puddle depth, and complete four-wheel suspension
extension are always treated as surface disturbance. Once a bin has enough
local evidence, excessive vertical, lateral, or longitudinal change relative
to that bin's learned rate is also excluded. Response values are stabilized
with a bounded three-frame median before change rates are calculated; this
avoids turning ordinary FH6 frame noise into a calibration failure.

The calibration envelope is intentionally permissive only for clean local
evidence. It is not a classifier for asphalt surface type and does not claim
that every accepted frame represents an ideal driving technique.

## Supported findings

The Coach currently supports four negative and two positive findings:

| Finding | Evidence pattern | Live instruction |
| --- | --- | --- |
| `FRONT SCRUB` | Turning with growing steering and front slip while lateral response or yaw response stops improving | Reduce steering and let the front recover |
| `EXIT WHEELSPIN` | Exit phase with rising throttle, high driven slip, and weak acceleration response against the learned baseline | Build throttle after the car is settled |
| `BRAKE + STEERING OVERLOAD` | Turning with brake and steering load, high front combined slip, and stalled response | Release brake and let the front recover |
| `ABRUPT BRAKE RELEASE` | A sharp brake release followed within a bounded window by response/yaw loss or rear-slip growth | Release brake smoothly and keep the car settled |
| `CLEAN EXIT` | Exit phase with rising throttle, low driven slip, positive acceleration, and stable steering | Keep the throttle build and clean exit |
| `CONTROLLED RELEASE` | Turning with a progressive brake release, controlled combined slip, and stable response | Keep the brake release smooth |

Negative findings are `FRONT SCRUB`, `EXIT WHEELSPIN`, `BRAKE + STEERING
OVERLOAD`, and `ABRUPT BRAKE RELEASE`. Positive findings are `CLEAN EXIT` and
`CONTROLLED RELEASE`. The presentation chooses one eligible cue at a time.
When counts tie, its priority is abrupt brake release, brake-plus-steering
overload, front scrub, exit wheelspin, controlled release, then clean exit.

## Confidence model

Every finding carries component evidence rather than a fixed confidence
constant. Components combine local percentile rank, threshold margin, measured
response loss or strength, and sustained evidence duration. The final
confidence is the minimum of the duration confidence and the minimum component
confidence. A weak component therefore keeps the complete finding below the
cue gate even when other measurements are strong.

Negative sustained findings require more than `140 ms` of continuous evidence;
positive findings require more than `180 ms`. Abrupt brake release uses its
own response window of up to `250 ms` and can be issued once its independent
components reach the cue gate. The default cue gate is confidence `0.84`.

After a cue is issued, it remains visible for up to `1800 ms` and the Coach
uses a `4200 ms` cooldown before presenting another cue. A new cue candidate
must again pass calibration, evidence, and confidence gates. The accumulated
counts are attempt-local and feed the later brief.

## Silence conditions

The Coach intentionally shows status or no cue when:

- the frame is paused, in a menu, inactive, invalid, rewound, or outside a
  continuous telemetry window;
- calibration is not ready for the current speed bin;
- the car is on a straight or no supported phase-specific pattern is present;
- rumble, puddle, suspension extension, or a learned transient gate marks the
  sample as disturbed;
- a candidate does not remain present for its duration gate;
- a candidate's weakest confidence component stays below `0.84`; or
- presentation cooldown is active.

Silence is not an error state. The overlay distinguishes `ASPHALT COACH ·
LEARNING` from `ASPHALT COACH · READY` while no cue is active, and it does not
invent a finding from missing or ambiguous evidence.

## Driver Brief

When `HudLapTiming` confirms a circuit or sprint completion, the current
attempt summary can be shown for 25 seconds as:

```text
DRIVER BRIEF · ASPHALT
MAIN HABIT — recurring finding + evidence count
STRONG — one demonstrated positive pattern
NEXT RUN — one focused technique instruction
```

`MAIN HABIT` selects the most frequent negative finding, with the supported cue
priority resolving ties. `STRONG` selects the most frequent positive finding.
`NEXT RUN` uses the main negative finding's focused instruction, or asks the
driver to collect more evidence when no recurring negative pattern exists.
An empty summary explicitly reports insufficient evidence rather than
inventing a strength, score, or time loss.

The brief is labelled `ASPHALT` and contains evidence counts, not an official
finish judgment. Ordinary multi-lap boundaries do not trigger it, and
`HudLapTiming` remains the only official time authority.

## Run Check

If a valid live attempt becomes non-live because the Direct stream pauses or
goes stale, and no authoritative finish is available, the same current-run
summary can be shown as:

```text
RUN CHECK · NOT FINAL
CURRENT PATTERN — current finding + evidence count
CURRENT STRENGTH — current positive pattern
FOCUS — next focused technique instruction
```

Run Check reuses the attempt evidence but makes no finish, official time, or
lap-result claim. It is dismissed when the same attempt resumes, while the
current evidence remains available. A mid-run attachment without a valid
attempt start does not produce a Run Check.

## Fixtures and verification

The checked-in [`overlay/asphalt-coach-fixtures.js`](../overlay/asphalt-coach-fixtures.js)
contains sanitized, rounded, coordinate-free segments derived from saved FH6
replays. The grounded responsive braking turn verifies that a real analyzable
turn does not produce a false negative cue. The airborne segment verifies that
full suspension extension and contact loss exclude both calibration and
findings. Synthetic strong and borderline episodes cover supported cues,
confidence, lifecycle, and silence gates.

Fixture tests prove deterministic behavior of the normalized state, findings,
presentation, and lifecycle modules. They do not prove live Forza behavior,
identify an asphalt surface from telemetry, or validate a track-specific
reference line.

The checked-in fixtures are covered by the full Node.js test suite. Run that
suite once after changes to the Coach runtime or fixtures. For a completed
runtime code task, use the release verification cycle described in
[README.md](../README.md#build-and-verify). Do not repeat checks that already
passed for the same final state.

## Current limitations

- The Coach is asphalt-only by product boundary; telemetry does not identify
  the surface type for the driver.
- It has no track identity, map, ideal line, driving score, exact metres or
  seconds of time loss, or optimal-gear recommendation.
- Calibration and findings are current-session/current-run data. The Coach
  envelope is not persisted in `fdc.sqlite` and is cleared by a Direct receiver
  restart or incompatible car identity.
- Every speed bin must earn its own local readiness. An unseen speed range
  remains silent until enough clean evidence is collected there.
- Supported findings are technique patterns with bounded confidence, not a
  complete driving assessment. Unsupported behavior remains silent.
- A non-live stop without an authoritative result can produce only `RUN CHECK ·
  NOT FINAL`; it cannot be promoted to a finished Driver Brief.
