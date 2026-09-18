# Driver Analysis

## Purpose and boundaries

Driver Analysis is a local-first, zero-reference review tool for asphalt driving
in Forza Horizon 6. It is an MVP/beta feature. The driver explicitly enables it
and starts and stops each recording from Configuration or with the global
recording hotkey.

The feature does not identify the road surface from telemetry. The driver must
record on asphalt. It does not infer track identity, an ideal line, a driving
score, exact metres or seconds of loss, a wrong apex, or optimal gear advice.

## Runtime data flow

```text
FH6 Data Out → UDP 127.0.0.1:5301 → native decoder → direct_telemetry
  → queueTelemetry → Driver Analysis recorder
  → AsphaltCoachState.update → AsphaltCoachFindings.update
  → one dominant recurring problem → local history
  → Configuration / Driver Analysis
```

The internal `AsphaltCoachState`, `AsphaltCoachFindings`, and
`AsphaltCoachPresentation` modules remain the existing analysis engine. They
consume the normalized `queueTelemetry` stream and do not create another
telemetry transport. Driver Analysis has no HUD widget and does not show live
driving cues.

Raw telemetry is analyzed in memory and is not written to disk. When a
recording stops, FDC persists only the compact result in the webview's versioned
local storage under `fdc.driver-analysis.history.v1`. History is displayed from
newest to oldest and is limited to 100 results.

## Controls

Driver Analysis is disabled by default. Its Configuration tab is the second
tab after HUD and provides:

- an enable toggle;
- a `RECORD` / `STOP` button;
- an editable global recording hotkey;
- the beta/MVP and asphalt-only warning; and
- saved recording history.

The default global hotkey is `Ctrl+Shift+F9`. Windows-key combinations, bare
keys, `Alt+F4`, `Alt+Tab`, `Ctrl+Escape`, and `Ctrl+Shift+Escape` are rejected.
If Windows or another application already owns a requested shortcut, FDC keeps
the previous shortcut and reports the registration error.

## Analysis lifecycle

Starting a recording clears the previous in-memory calibration and finding
counts. While recording, normalized telemetry is passed through the existing
asphalt state and evidence gates. Paused, invalid, rewound, duplicate, or
disturbed samples do not create findings. A telemetry gap resets transient
evidence without inventing a result.

Stopping a recording builds one result. The selected problem is the most
frequent supported negative finding. Ties use this priority:

1. abrupt brake release;
2. brake plus steering overload;
3. front scrub;
4. exit wheelspin.

If no negative pattern has enough evidence, the recording is saved as `NO
RECURRING PROBLEM DETECTED`; FDC asks for a longer asphalt recording instead of
inventing a problem.

## Supported findings

| Finding | Evidence pattern | Focus |
| --- | --- | --- |
| `FRONT SCRUB` | Steering and front slip grow while lateral or yaw response stops improving | Reduce steering and let the front recover |
| `EXIT WHEELSPIN` | Throttle and driven slip rise while acceleration response is weak | Build throttle after the car is settled |
| `BRAKE + STEERING OVERLOAD` | Brake, steering, and front combined slip are high while response stalls | Release brake as steering builds |
| `ABRUPT BRAKE RELEASE` | Sharp brake release is followed by response/yaw loss or rear-slip growth | Release brake smoothly through rotation |

The engine also recognizes clean exits and controlled brake releases as
positive evidence, but the MVP history intentionally stores and displays only
one negative problem. Positive evidence is not shown as a second recommendation.

## Calibration and confidence

Calibration is a zero-reference envelope for the current car session. The
vehicle identity is derived from car ordinal, PI, rounded RPM limit, and
drivetrain. Twelve fixed 25 km/h speed bins cover 0–300 km/h. The global
envelope requires at least 36 accepted samples across three bins; a current bin
requires at least eight accepted samples.

Samples are excluded from calibration when they show obvious front scrub,
wheelspin, combined brake/steering overload, abrupt release, rumble contact,
puddle depth, complete suspension extension, or a learned transient outlier.
Negative sustained findings require more than 140 ms of evidence and a minimum
confidence of 0.84. These gates are unchanged from the previous analysis
engine.

## Persistence and privacy

The enable preference and hotkey use
`fdc.driver-analysis.settings.v1`. Completed compact results use
`fdc.driver-analysis.history.v1`. Both are local browser storage shared by the
FDC windows. The calibration envelope, raw telemetry, and candidate evidence
remain in memory and are not stored in `fdc.sqlite`.

## Current limitations

- Driver Analysis is beta/MVP functionality and may be inaccurate.
- It is asphalt-only by product boundary; telemetry does not identify surface
  type.
- Short recordings or unseen speed ranges may produce no recurring problem.
- It has no track identity, map, reference lap, ideal line, score, exact time
  loss, or optimal-gear recommendation.
- Supported findings are bounded technique patterns, not a complete driving
  assessment.
