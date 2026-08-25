const assert = require('node:assert/strict')
const test = require('node:test')

const { resolveLapAction } = require('./asphalt-coach-lifecycle.js')

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

test('a live packet after a confirmed finish starts a fresh attempt', () => {
  assert.equal(resolveLapAction({
    previousTimingState: { phase: 'circuit_complete' },
    timingState: { phase: 'live' },
    previousLapNumber: 6,
    telemetry: { isRaceOn: true, lap: { number: 1 } }
  }), 'begin_attempt')
})
