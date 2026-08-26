const assert = require('node:assert/strict')
const test = require('node:test')

const {
  canSummarizeAttempt,
  resolveAttemptRestart,
  resolveLapAction
} = require('./asphalt-coach-lifecycle.js')

test('a zeroed non-live tail cannot erase the completed Direct attempt', () => {
  assert.equal(resolveAttemptRestart({
    previousTelemetry: { lap: { raceTime: 108.7, number: 0, distance: 5950 } },
    previousTimingState: { lastRaceTimeS: 108.7, lastLapNumber: 0, lastDistanceM: 5950 },
    telemetry: { isRaceOn: false, lap: { raceTime: 0, number: 0, distance: 0 } }
  }), false)
})

test('the next live retry uses the remembered live clock after a zeroed tail', () => {
  assert.equal(resolveAttemptRestart({
    previousTelemetry: { isRaceOn: false, lap: { raceTime: 0, number: 0, distance: 0 } },
    previousTimingState: { lastRaceTimeS: 108.7, lastLapNumber: 0, lastDistanceM: 5950 },
    telemetry: { isRaceOn: true, lap: { raceTime: 0.1, number: 0, distance: 5 } }
  }), true)
})

test('resuming a paused Direct attempt is not a retry', () => {
  assert.equal(resolveAttemptRestart({
    previousTelemetry: { isRaceOn: false, lap: { raceTime: 108.7, number: 0, distance: 5950 } },
    previousTimingState: { lastRaceTimeS: 108.7, lastLapNumber: 0, lastDistanceM: 5950 },
    telemetry: { isRaceOn: true, lap: { raceTime: 108.8, number: 0, distance: 5960 } }
  }), false)
})

test('confirmed final circuit packet wins over the ordinary lap-boundary branch', () => {
  assert.equal(resolveLapAction({
    previousTimingState: { phase: 'live' },
    timingState: { phase: 'circuit_complete', lapNumber: 6, finalTimeMs: 51250 },
    previousLapNumber: 5,
    telemetry: { isRaceOn: false, lap: { number: 6 } }
  }), 'brief')
})

test('ordinary multi-lap boundary resets transient state without starting a new attempt', () => {
  assert.equal(resolveLapAction({
    previousTimingState: { phase: 'live' },
    timingState: { phase: 'live' },
    previousLapNumber: 5,
    telemetry: { isRaceOn: true, lap: { number: 6 } }
  }), 'lap_boundary')
})

test('a live sprint result shows the brief when LastLap completes without a lap boundary', () => {
  assert.equal(resolveLapAction({
    previousTimingState: {
      phase: 'live',
      attemptStartValid: true,
      lastLiveCurrentTimeMs: 81250
    },
    timingState: { phase: 'sprint_complete', lapNumber: 0, finalTimeMs: 51250 },
    previousLapNumber: 0,
    telemetry: { isRaceOn: true, lap: { number: 0 } }
  }), 'brief')
})

test('a live circuit result remains an ordinary lap boundary', () => {
  assert.equal(resolveLapAction({
    previousTimingState: { phase: 'live', attemptStartValid: true },
    timingState: { phase: 'circuit_complete', lapNumber: 6, finalTimeMs: 51250 },
    previousLapNumber: 5,
    telemetry: { isRaceOn: true, lap: { number: 6 } }
  }), 'lap_boundary')
})

test('the stopped packet after a live final circuit boundary shows the brief', () => {
  assert.equal(resolveLapAction({
    previousTimingState: { phase: 'circuit_complete', attemptStartValid: true },
    timingState: { phase: 'circuit_complete', lapNumber: 6, finalTimeMs: 51250 },
    previousLapNumber: 6,
    telemetry: { isRaceOn: false, lap: { number: 6 } }
  }), 'brief')
})

test('a valid live attempt becoming ambiguous non-live telemetry shows a run check', () => {
  assert.equal(resolveLapAction({
    previousTimingState: {
      phase: 'live',
      attemptStartValid: true,
      lastLiveCurrentTimeMs: 81250
    },
    timingState: { phase: 'paused', finalTimeMs: null },
    previousLapNumber: 0,
    telemetry: { isRaceOn: false, lap: { number: 0 } }
  }), 'run_check')
})

test('a mid-run attachment does not show a run check', () => {
  assert.equal(resolveLapAction({
    previousTimingState: { phase: 'live', attemptStartValid: false },
    timingState: { phase: 'paused', finalTimeMs: null },
    previousLapNumber: 0,
    telemetry: { isRaceOn: false, lap: { number: 0 } }
  }), 'none')
})

test('a live circuit continuation does not invent a new driving attempt', () => {
  assert.equal(resolveLapAction({
    previousTimingState: { phase: 'circuit_complete' },
    timingState: { phase: 'live' },
    previousLapNumber: 6,
    telemetry: { isRaceOn: true, lap: { number: 6 } }
  }), 'none')
})

test('a stale Direct stream can summarize only a valid live attempt', () => {
  assert.equal(canSummarizeAttempt({
    phase: 'live',
    attemptStartValid: true,
    lastLiveCurrentTimeMs: 81250
  }), true)
  assert.equal(canSummarizeAttempt({
    phase: 'live',
    attemptStartValid: false,
    lastLiveCurrentTimeMs: 81250
  }), false)
  assert.equal(canSummarizeAttempt({
    phase: 'live',
    attemptStartValid: true,
    lastLiveCurrentTimeMs: null
  }), false)
})
