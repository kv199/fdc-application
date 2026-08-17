const assert = require('node:assert/strict')
const test = require('node:test')

const {
  classifyDelta,
  createLapDeltaView,
  createDemoReference,
  formatCue,
  formatLapDelta,
  formatLapTime,
  formatPhaseAction,
  formatPedalPoint,
  formatSummary,
  formatSignedMilliseconds,
  getActivePedalPoint,
  isRaceRestart,
  normalizeLapCompletePayload,
  normalizeReferencePayload,
  selectPrimaryCue
} = require('./reference-coach.js')

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

test('formats signed milliseconds and pedal points for the Coach card', () => {
  assert.equal(formatSignedMilliseconds(-38), '-38 ms')
  assert.equal(formatSignedMilliseconds(42), '+42 ms')
  assert.equal(formatSignedMilliseconds(null), '')
  assert.equal(formatPedalPoint(560, 'REF'), 'REF 560 m')
  assert.equal(formatPedalPoint(null, 'YOU'), 'YOU —')
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

test('selects one phase action and one active pedal point', () => {
  const targets = {
    brakeStartDistanceM: 560,
    brakeReleaseDistanceM: 690,
    throttlePickupDistanceM: 835
  }
  const observed = {
    brakeStartDistanceM: 578,
    brakeReleaseDistanceM: null,
    throttlePickupDistanceM: null
  }

  assert.equal(formatPhaseAction('approach'), 'BRAKE')
  assert.equal(formatPhaseAction('entry'), 'RELEASE BRAKE')
  assert.equal(formatPhaseAction('apex'), 'APEX')
  assert.deepEqual(getActivePedalPoint('approach', targets, observed), {
    label: 'BRAKE',
    reference: 'REF 560 m',
    observed: 'YOU 578 m'
  })
  assert.deepEqual(getActivePedalPoint('entry', targets, observed), {
    label: 'RELEASE BRAKE',
    reference: 'REF 690 m',
    observed: 'YOU —'
  })
  assert.equal(getActivePedalPoint('apex', targets, observed), null)
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

test('formats the supported guidance cues without inventing advice', () => {
  assert.equal(formatCue({ kind: 'brake_late', value: 12 }), 'BRAKE 12 m LATE')
  assert.equal(formatCue({ kind: 'release_late' }), 'RELEASE BRAKE')
  assert.equal(formatCue({ kind: 'apex_too_fast', value: 4 }), 'APEX 4 km/h SLOW')
  assert.equal(formatCue({ kind: 'throttle_late', value: 8 }), 'THROTTLE 8 m LATE')
  assert.equal(formatCue({ kind: 'unknown', value: 99 }), '')
})

test('formats a reference summary using the corner delta', () => {
  assert.equal(formatSummary({ deltaMs: 180 }, 'T3 LEFT'), 'T3 +0.18 s')
  assert.equal(formatSummary({ apexSpeedDeltaKmh: -4 }, 'T3 LEFT'), 'T3 APEX -4 km/h')
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

test('normalizes a finish-anchored lap result', () => {
  assert.deepEqual(normalizeLapCompletePayload({
    sessionId: 32,
    eventId: 13,
    lapNumber: 11,
    lapTimeMs: 51250,
    referenceTimeMs: 50000,
    deltaMs: 1250,
    sourceSessionId: 29
  }), {
    sessionId: 32,
    eventId: 13,
    lapNumber: 11,
    lapTimeMs: 51250,
    referenceTimeMs: 50000,
    deltaMs: 1250,
    sourceSessionId: 29
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
