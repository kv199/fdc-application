const test = require('node:test')
const assert = require('node:assert/strict')

const timing = require('./lap-timing.js')

function telemetry(overrides = {}) {
  return {
    isRaceOn: true,
    car: { ordinal: 12345 },
    lap: {
      number: 0,
      current: 0,
      last: 0,
      raceTime: 0,
      distance: 0
    },
    ...overrides
  }
}

function sequence() {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 40, last: 0, raceTime: 40, distance: 2000 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 40, distance: 2000 } }))
  state = timing.update(state, telemetry({ isRaceOn: true, lap: { number: 0, current: 40.2, last: 0, raceTime: 40.2, distance: 2010 } }))
  return state
}

test('Direct UDP telemetry sequences produce the expected live and pause state', () => {
  assert.deepEqual(sequence(), sequence())
  assert.equal(sequence().phase, 'live')
  assert.equal(sequence().currentTimeMs, 40200)
})

test('pause packets do not complete or erase the last useful game time', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 12.5, last: 0, raceTime: 12.5, distance: 500 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 55.418, raceTime: 12.5, distance: 0 } }))

  assert.equal(state.phase, 'paused')
  assert.equal(state.finalTimeMs, null)
  assert.equal(state.currentTimeMs, 12500)
})

test('a circuit LastLap packet creates a final time that survives stale packets', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 1, current: 0, last: 55.418, raceTime: 55.4, distance: 5950 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 1, current: 0, last: 0, raceTime: 55.4, distance: 5950 } }))

  assert.equal(state.phase, 'circuit_complete')
  assert.equal(state.finalTimeMs, 55418)
  assert.equal(timing.displayTimeMs(state), 55418)
})

test('persistent LastLap does not freeze the next circuit lap', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 40, last: 0, raceTime: 40, distance: 2000 } }))
  state = timing.update(state, telemetry({ lap: { number: 1, current: 0, last: 55.418, raceTime: 55.4, distance: 5950 } }))
  assert.equal(state.phase, 'circuit_complete')
  assert.equal(state.finalTimeMs, 55418)

  state = timing.update(state, telemetry({ lap: { number: 1, current: 0.1, last: 55.418, raceTime: 55.5, distance: 10 } }))
  state = timing.update(state, telemetry({ lap: { number: 1, current: 2.1, last: 55.418, raceTime: 57.5, distance: 120 } }))
  state = timing.update(state, telemetry({ lap: { number: 1, current: 4.2, last: 55.418, raceTime: 59.6, distance: 240 } }))

  assert.equal(state.phase, 'live')
  assert.equal(state.currentTimeMs, 4200)
  assert.equal(state.finalTimeMs, null)

  state = timing.update(state, telemetry({ lap: { number: 2, current: 0, last: 54.9, raceTime: 114.5, distance: 5950 } }))
  assert.equal(state.phase, 'circuit_complete')
  assert.equal(state.finalTimeMs, 54900)
})

test('equal official times on consecutive circuit laps still finalize at each boundary', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 40, last: 0, raceTime: 40, distance: 2000 } }))
  state = timing.update(state, telemetry({ lap: { number: 1, current: 0, last: 55.418, raceTime: 55.418, distance: 5950 } }))
  state = timing.update(state, telemetry({ lap: { number: 1, current: 0.1, last: 55.418, raceTime: 55.518, distance: 10 } }))
  state = timing.update(state, telemetry({ lap: { number: 1, current: 40, last: 55.418, raceTime: 95.418, distance: 2000 } }))
  state = timing.update(state, telemetry({ lap: { number: 2, current: 0, last: 55.418, raceTime: 110.836, distance: 5950 } }))

  assert.equal(state.phase, 'circuit_complete')
  assert.equal(state.finalTimeMs, 55418)
  assert.equal(state.lapNumber, 1)
})

test('a sprint finish can use an advancing non-live game clock', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 108.713, last: 0, raceTime: 108.713, distance: 5951 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 108.713, distance: 5951 } }))
  assert.equal(state.phase, 'paused')
  assert.equal(state.currentTimeMs, 108713)

  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 108.720, last: 0, raceTime: 108.720, distance: 5951 } }))
  assert.equal(state.phase, 'paused')
  assert.equal(state.finalTimeMs, null)
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 108.720, last: 0, raceTime: 108.720, distance: 5951 } }))
  assert.equal(state.phase, 'sprint_complete')
  assert.equal(state.finalTimeMs, 108720)
  assert.equal(state.finalTimeSource, timing.COMPLETE_SOURCES.sprint)
})

test('a stale LastLap field does not block an advancing sprint finish', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 108.713, last: 55.418, raceTime: 108.713, distance: 5951 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 108.720, last: 55.418, raceTime: 108.720, distance: 5951 } }))
  assert.equal(state.phase, 'paused')
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 108.720, last: 55.418, raceTime: 108.720, distance: 5951 } }))

  assert.equal(state.phase, 'sprint_complete')
  assert.equal(state.finalTimeMs, 108720)
  assert.equal(state.finalTimeSource, timing.COMPLETE_SOURCES.sprint)
})

test('a persistent stale LastLap cannot become a sprint finish', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 55.418, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 20, last: 55.418, raceTime: 20, distance: 1000 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, car: { ordinal: 0 }, lap: { number: 0, current: 0, last: 55.418, raceTime: 0, distance: 0 } }))

  assert.equal(state.phase, 'paused')
  assert.equal(state.finalTimeMs, null)
  assert.equal(state.currentTimeMs, 20000)
})

test('a single slightly advancing pause sample is not a sprint finish', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 12.500, last: 0, raceTime: 12.500, distance: 500 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, car: { ordinal: 0 }, lap: { number: 0, current: 12.516, last: 0, raceTime: 12.516, distance: 500 } }))

  assert.equal(state.phase, 'paused')
  assert.equal(state.finalTimeMs, null)
  assert.equal(state.currentTimeMs, 12500)

  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 12.516, distance: 0 } }))
  assert.equal(state.phase, 'paused')
  assert.equal(state.finalTimeMs, null)
  assert.equal(state.currentTimeMs, 12500)
})

test('a confirmed CurrentLap pause candidate is cleared when live driving resumes', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 12.5, last: 0, raceTime: 12.5, distance: 500 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 12.516, last: 0, raceTime: 12.516, distance: 500 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 12.516, last: 0, raceTime: 12.516, distance: 500 } }))
  assert.equal(state.phase, 'sprint_complete')

  state = timing.update(state, telemetry({ lap: { number: 0, current: 12.6, last: 0, raceTime: 12.6, distance: 510 } }))
  assert.equal(state.phase, 'live')
  assert.equal(state.currentTimeMs, 12600)
  assert.equal(state.finalTimeMs, null)
})

test('a post-finish LastLap advancing beyond the live clock is immediate evidence', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 108.713, last: 0, raceTime: 108.713, distance: 5951 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 108.720, raceTime: 108.713, distance: 5951 } }))

  assert.equal(state.phase, 'sprint_complete')
  assert.equal(state.finalTimeMs, 108720)
  assert.equal(state.finalTimeSource, timing.COMPLETE_SOURCES.circuit)
})

test('a new non-live LastLap equal to the last live clock completes a sprint', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 108.713, last: 0, raceTime: 108.713, distance: 5951 } }))
  state = timing.update(state, telemetry({
    isRaceOn: false,
    lap: { number: 0, current: 0, last: 108.713, raceTime: 108.713, distance: 5951 }
  }))

  assert.equal(state.phase, 'sprint_complete')
  assert.equal(state.finalTimeMs, 108713)
  assert.equal(state.finalTimeSource, timing.COMPLETE_SOURCES.circuit)
})

test('zero or equal stopped clocks remain paused instead of finishing a sprint', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 108.713, last: 0, raceTime: 108.713, distance: 5951 } }))

  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 108.713, last: 0, raceTime: 108.713, distance: 5951 } }))
  assert.equal(state.phase, 'paused')
  assert.equal(state.finalTimeMs, null)

  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 108.713, distance: 0 } }))
  assert.equal(state.phase, 'paused')
  assert.equal(state.currentTimeMs, 108713)
  assert.equal(state.finalTimeMs, null)
})

test('a zeroed non-live pause packet cannot masquerade as a restart', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 12.5, last: 0, raceTime: 12.5, distance: 500 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))

  assert.equal(state.phase, 'paused')
  assert.equal(state.currentTimeMs, 12500)
  assert.equal(state.finalTimeMs, null)

  state = timing.update(state, telemetry({ lap: { number: 0, current: 12.6, last: 0, raceTime: 12.6, distance: 510 } }))
  assert.equal(state.phase, 'live')
  assert.equal(state.currentTimeMs, 12600)
})

test('direct restart resets volatile timing state', () => {
  assert.deepEqual(timing.resetForRestart(), timing.createState())
})
