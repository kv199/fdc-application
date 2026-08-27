const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  classifyDelta,
  createLapDeltaView,
  createDemoReference,
  cueHasMagnitude,
  formatCue,
  formatCoachStatus,
  formatLapDelta,
  formatLapTime,
  formatPhaseAction,
  formatSummary,
  formatSignedMilliseconds,
  hasLiveCoachGuidance,
  isRaceRestart,
  normalizeLapCompletePayload,
  normalizeReferencePayload,
  selectPrimaryCue
} = require('./reference-coach.js')

test('keeps the in-game Coach card to one instruction and compact corner context', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  const css = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8')
  const runtime = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')

  assert.match(html, /id="corner-identity"/)
  assert.match(html, /id="corner-distance"/)
  assert.match(html, /id="coach-status"/)
  assert.doesNotMatch(html, /id="corner-phase"/)
  assert.doesNotMatch(html, /id="coach-target(?:-|\")/)
  assert.doesNotMatch(css, /\.coachbar\[data-delta-state=/)
  assert.match(runtime, /DEMO_MODE && demoReference !== null/)
  assert.match(runtime, /const hasReferenceGuidance = window\.ReferenceCoach\.hasLiveCoachGuidance/)
  assert.match(runtime, /coachCard\.hidden = !isCoachEditing && \(!isCoachVisible \|\| !hasCoachGuidance\)/)
  assert.match(runtime, /ASPHALT COACH · READY/)
  assert.match(runtime, /Learning current speed range/)
  assert.match(runtime, /coachKicker\.textContent = 'REFERENCE COACH'/)
  assert.equal([...runtime.matchAll(/beginLapSummary\(\)/g)].length, 2)
  assert.match(runtime, /Only an explicit lap_complete may turn a live value into a final result/)
})

test('Direct keeps the game clock visible and lets live cue instructions wrap', () => {
  const css = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8')
  const runtime = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')

  assert.match(runtime, /const hasDirectClock = telemetrySource === 'direct'/)
  assert.match(runtime, /!hasReference && !hasAsphaltGuidance && !hasDirectClock/)
  assert.match(runtime, /AsphaltCoachLifecycle\.resolveAttemptRestart/)
  assert.match(runtime, /if \(!raceRestart\) handleAsphaltLapLifecycle/)
  assert.doesNotMatch(runtime, /showAsphaltBriefIfConfirmed/)
  assert.match(runtime, /showAsphaltBrief\(`provider:/)
  assert.match(runtime, /RUN CHECK · NOT FINAL/)
  assert.match(runtime, /AsphaltCoachLifecycle\.canSummarizeAttempt\(lapTimingState\)/)
  assert.match(runtime, /presentationAttemptBegan: raceRestart/)
  assert.match(runtime, /if \(options\.presentationAttemptBegan !== true\)/)
  assert.match(css, /data-coach-mode='cue'[\s\S]*white-space: normal/)
})

test('does not expose a cue when reference is unavailable', () => {
  const reference = normalizeReferencePayload({
    available: false,
    cue: { kind: 'brake_late', value: 12 }
  })

  assert.equal(reference.available, false)
  assert.equal(reference.cue, null)
  assert.equal(reference.deltaMs, null)
  assert.equal(reference.targets, null)
})

test('classifies pace deltas with null safety and hysteresis', () => {
  assert.equal(classifyDelta(-100), 'green')
  assert.equal(classifyDelta(0), 'amber')
  assert.equal(classifyDelta(100), 'red')
  assert.equal(classifyDelta(null, 'red'), 'neutral')
  assert.equal(classifyDelta(-25, 'green'), 'green')
  assert.equal(classifyDelta(25, 'red'), 'red')
})

test('formats signed milliseconds for reference diagnostics', () => {
  assert.equal(formatSignedMilliseconds(-38), '-38 ms')
  assert.equal(formatSignedMilliseconds(42), '+42 ms')
  assert.equal(formatSignedMilliseconds(null), '')
})

test('formats the lap delta with the correct faster/slower sign', () => {
  assert.equal(formatLapDelta(420), '+0.42 s')
  assert.equal(formatLapDelta(-180), '-0.18 s')
  assert.equal(formatLapDelta(0), '0.00 s')
  assert.equal(formatLapDelta(null), '')
})

test('maps lap delta to the strip direction and color state', () => {
  assert.deepEqual(createLapDeltaView(1000), {
    state: 'red',
    text: '+1.00 s',
    positionPercent: 0
  })
  assert.deepEqual(createLapDeltaView(-500), {
    state: 'green',
    text: '-0.50 s',
    positionPercent: 75
  })
  assert.deepEqual(createLapDeltaView(null), {
    state: 'neutral',
    text: '',
    positionPercent: 50
  })
})

test('selects one phase action without exposing reference and observed target rows', () => {
  assert.equal(formatPhaseAction('approach'), 'BRAKE')
  assert.equal(formatPhaseAction('entry'), 'RELEASE BRAKE')
  assert.equal(formatPhaseAction('apex'), 'APEX')
})

test('selects the highest-priority cue from a payload', () => {
  const cue = selectPrimaryCue({
    cues: [
      { kind: 'good' },
      { kind: 'throttle_late', value: 8 },
      { kind: 'brake_late', value: 12 }
    ]
  })

  assert.equal(cue.kind, 'brake_late')
  assert.equal(cue.value, 12)
})

test('formats the supported guidance cues as one actionable instruction', () => {
  assert.equal(formatCue({ kind: 'brake_late', value: 12 }), 'BRAKE 12 m EARLIER')
  assert.equal(formatCue({ kind: 'brake_early', value: 12 }), 'BRAKE 12 m LATER')
  assert.equal(formatCue({ kind: 'release_late' }), 'RELEASE EARLIER')
  assert.equal(formatCue({ kind: 'apex_too_fast', value: 4 }), 'APEX +4 km/h')
  assert.equal(formatCue({ kind: 'apex_too_slow', value: 4 }), 'APEX -4 km/h')
  assert.equal(formatCue({ kind: 'throttle_late', value: 8 }), 'THROTTLE 8 m EARLIER')
  assert.equal(formatCue({ kind: 'throttle_early', value: 8 }), 'THROTTLE 8 m LATER')
  assert.equal(formatCue({ kind: 'good' }), 'GOOD EXIT')
  assert.equal(formatCue({ kind: 'unknown', value: 99 }), '')
})

test('shows Coach only for live corner guidance, never for pace-only or final data', () => {
  assert.equal(hasLiveCoachGuidance({ available: true, corner: 'T3 LEFT' }), true)
  assert.equal(hasLiveCoachGuidance({ available: true, corner: '' }), false)
  assert.equal(hasLiveCoachGuidance({ available: true, corner: 'T3 LEFT' }, true), false)
  assert.equal(hasLiveCoachGuidance({ available: false, corner: 'T3 LEFT' }), false)
})

test('identifies cues whose correction already supplies the only numeric context', () => {
  assert.equal(cueHasMagnitude({ kind: 'brake_late', value: 12 }), true)
  assert.equal(cueHasMagnitude({ kind: 'release_late' }), false)
  assert.equal(cueHasMagnitude({ kind: 'good' }), false)
  assert.equal(cueHasMagnitude(null), false)
})

test('formats apex guidance in the selected speed unit', () => {
  assert.equal(formatCue({ kind: 'apex_too_fast', value: 16 }, 'mph'), 'APEX +10 mph')
  assert.equal(formatCoachStatus({
    available: true,
    corner: 'T3 LEFT',
    phase: 'apex',
    cue: { kind: 'apex_too_slow', value: 8 }
  }, false, 'mph'), 'APEX -5 mph')
})

test('formats a reference summary using the corner delta', () => {
  assert.equal(formatSummary({ deltaMs: 180 }, 'T3 LEFT'), 'T3 +0.18 s')
  assert.equal(formatSummary({ apexSpeedDeltaKmh: -4 }, 'T3 LEFT'), 'T3 APEX -4 km/h')
  assert.equal(formatSummary({ apexSpeedDeltaKmh: -16 }, 'T3 LEFT', 'mph'), 'T3 APEX -10 mph')
  assert.equal(formatSummary({ apexSpeedDeltaKmh: -0.4 }, 'T3 LEFT', 'mph'), 'T3 APEX 0 mph')
})

test('provides deterministic demo references for each MVP state', () => {
  const brakeLate = createDemoReference('brake-late')
  assert.equal(brakeLate.cue.kind, 'brake_late')
  assert.equal(brakeLate.deltaMs, 42)
  assert.equal(brakeLate.targets.brakeStartDistanceM, 560)
  assert.equal(brakeLate.observed.brakeStartDistanceM, 578)
  assert.equal(createDemoReference('release').cue.kind, 'release_late')
  assert.equal(createDemoReference('apex-slow').cue.kind, 'apex_too_fast')
  assert.equal(createDemoReference('throttle-late').cue.kind, 'throttle_late')
  assert.equal(createDemoReference('good').cue.kind, 'good')
  assert.equal(createDemoReference('summary').summary.deltaMs, 180)
})

test('formats the live lap time from telemetry seconds', () => {
  assert.equal(formatLapTime(50.376), '0:50.376')
  assert.equal(formatLapTime(65.004), '1:05.004')
  assert.equal(formatLapTime(null), '--:--.---')
})

test('shows TO FINISH when the live reference has no active corner', () => {
  assert.equal(formatCoachStatus({
    available: true,
    corner: '',
    phase: 'between',
    cue: null,
    lapDeltaMs: 420
  }), 'TO FINISH')
  assert.equal(formatCoachStatus({
    available: true,
    corner: 'T3 LEFT',
    phase: 'between',
    cue: null,
    lapDeltaMs: 420
  }), 'NEXT CORNER')
  assert.equal(formatCoachStatus({}, true), 'LAP COMPLETE')
})

test('normalizes a finish-anchored lap result', () => {
  assert.deepEqual(normalizeLapCompletePayload({
    sessionId: 32,
    eventId: 13,
    lapNumber: 11,
    lapTimeMs: 51250,
    referenceTimeMs: 50000,
    deltaMs: 1250,
    sourceSessionId: 29,
    timeSource: 'forza_lap_last'
  }), {
    sessionId: 32,
    eventId: 13,
    lapNumber: 11,
    lapTimeMs: 51250,
    referenceTimeMs: 50000,
    deltaMs: 1250,
    sourceSessionId: 29,
    timeSource: 'forza_lap_last'
  })
  assert.equal(normalizeLapCompletePayload({ lapNumber: 1, lapTimeMs: 0 }), null)
})

test('detects a new race when race time and lap number reset', () => {
  assert.equal(isRaceRestart(
    { lap: { raceTime: 336.7, number: 6 } },
    { lap: { raceTime: 0.1, number: 0 } }
  ), true)
})

test('does not treat a normal lap transition as a race restart', () => {
  assert.equal(isRaceRestart(
    { lap: { raceTime: 50.2, number: 3 } },
    { lap: { raceTime: 50.3, number: 4 } }
  ), false)
})

test('detects a point-to-point restart from route distance rollback', () => {
  assert.equal(isRaceRestart(
    { lap: { raceTime: 108.7, number: 0, distance: 5950 } },
    { lap: { raceTime: 0.2, number: 0, distance: 0 } }
  ), true)
})
