const test = require('node:test')
const assert = require('node:assert/strict')

const timing = require('./lap-timing.js')

function telemetry(overrides = {}) {
  return {
    isRaceOn: true,
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

test('Direct and Suite telemetry sequences produce the same live and pause state', () => {
  assert.deepEqual(sequence(), sequence())
  assert.equal(sequence().phase, 'live')
  assert.equal(sequence().currentTimeMs, 40200)
})

test('pause packets do not complete or erase the last useful game time', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 12.5, last: 0, raceTime: 12.5, distance: 500 } }))
  state = timing.update(state, telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 12.5, distance: 0 } }))

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

test('provider sprint completion persists the Forza current clock until the next attempt', () => {
  let state = timing.createState()
  state = timing.update(state, telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  state = timing.update(state, telemetry({ lap: { number: 0, current: 108.713, last: 0, raceTime: 108.713, distance: 5951 } }))
  state = timing.complete(state, { lapNumber: 1, lapTimeMs: 108713, timeSource: 'forza_lap_current' })
  assert.equal(state.phase, 'sprint_complete')
  assert.equal(timing.displayTimeMs(state), 108713)

  state = timing.update(state, telemetry({ lap: { number: 0, current: 0.1, last: 0, raceTime: 0.1, distance: 0 } }))
  assert.equal(state.phase, 'live')
  assert.equal(state.finalTimeMs, null)
})

test('source switching resets volatile timing state', () => {
  const state = timing.complete(timing.createState(), {
    lapNumber: 1,
    lapTimeMs: 50000,
    timeSource: 'forza_lap_current'
  })
  assert.deepEqual(timing.resetForSourceSwitch(), timing.createState())
  assert.equal(state.finalTimeMs, 50000)
})
