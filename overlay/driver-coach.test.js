const assert = require('node:assert/strict')
const test = require('node:test')

const { DriverCoach, PHASES } = require('./driver-coach.js')

function frame(timestampMs, overrides = {}) {
  return {
    timestampMs,
    isRaceOn: true,
    speedKmh: 120,
    throttle: 0,
    brake: 0,
    steer: 0,
    ...overrides
  }
}

function createSummaryCoach() {
  const coach = new DriverCoach()
  coach.update(frame(0, { brake: 0.5, steer: 0.2, speedKmh: 120 }))
  coach.update(frame(150, { brake: 0.3, steer: 0.2, speedKmh: 110 }))
  coach.update(frame(390, { brake: 0.3, steer: 0.2, speedKmh: 100 }))
  coach.update(frame(640, { steer: 0.2, speedKmh: 95 }))
  coach.update(frame(840, { steer: 0.2, speedKmh: 96 }))
  coach.update(frame(940, { steer: 0.07, speedKmh: 94 }))
  coach.update(frame(1190, { steer: 0.07, speedKmh: 98 }))
  return { coach, snapshot: coach.update(frame(1340, { steer: 0.07, speedKmh: 110 })) }
}

test('reports BRAKE before a sustained turn', () => {
  const coach = new DriverCoach()
  const snapshot = coach.update(frame(0, { brake: 0.6 }))

  assert.equal(snapshot.phase, PHASES.BRAKE)
  assert.equal(snapshot.turnActive, false)
})

test('enters BLEND after the turn-on sustain period', () => {
  const coach = new DriverCoach()
  coach.update(frame(0, { brake: 0.6, steer: 0.2 }))
  const snapshot = coach.update(frame(150, { brake: 0.3, steer: 0.2 }))

  assert.equal(snapshot.phase, PHASES.BLEND)
  assert.equal(snapshot.turnActive, true)
})

test('reports COAST when both pedals are released in a turn', () => {
  const coach = new DriverCoach()
  coach.update(frame(0, { brake: 0.5, steer: 0.2 }))
  coach.update(frame(150, { brake: 0.3, steer: 0.2 }))
  const snapshot = coach.update(frame(300, { steer: 0.2 }))

  assert.equal(snapshot.phase, PHASES.COAST)
  assert.equal(snapshot.turnActive, true)
})

test('reports POWER when throttle is applied during a turn', () => {
  const coach = new DriverCoach()
  coach.update(frame(0, { brake: 0.5, steer: 0.2 }))
  coach.update(frame(150, { brake: 0.3, steer: 0.2 }))
  const snapshot = coach.update(frame(300, { throttle: 0.4, steer: 0.2 }))

  assert.equal(snapshot.phase, PHASES.POWER)
})

test('uses steering hysteresis and sustain windows', () => {
  const coach = new DriverCoach()
  coach.update(frame(0, { steer: 0.13 }))
  coach.update(frame(100, { steer: 0.11 }))
  coach.update(frame(150, { steer: 0.13 }))
  assert.equal(coach.getSnapshot().turnActive, false)

  coach.update(frame(289, { steer: 0.13 }))
  assert.equal(coach.getSnapshot().turnActive, false)
  coach.update(frame(290, { steer: 0.13 }))
  assert.equal(coach.getSnapshot().turnActive, true)

  coach.update(frame(300, { steer: 0.07 }))
  coach.update(frame(500, { steer: 0.07 }))
  assert.equal(coach.getSnapshot().summary, null)
  const snapshot = coach.update(frame(700, { steer: 0.07 }))
  assert.equal(snapshot.turnActive, false)
  assert.notEqual(snapshot.summary, null)
})

test('accumulates BLEND and COAST using irregular timestamps', () => {
  const { snapshot } = createSummaryCoach()

  assert.equal(snapshot.summary.blendMs, 490)
  assert.equal(snapshot.summary.coastMs, 700)
  assert.equal(snapshot.summary.minSpeedKmh, 94)
  assert.equal(snapshot.summary.exitSpeedKmh, 110)
})

test('keeps the summary visible briefly, then expires it', () => {
  const { coach, snapshot } = createSummaryCoach()
  assert.notEqual(snapshot.summary, null)

  assert.notEqual(coach.getSnapshot(3740).summary, null)
  assert.equal(coach.getSnapshot(3940).summary, null)
})

test('clears the current turn and summary when racing stops', () => {
  const { coach, snapshot } = createSummaryCoach()
  assert.notEqual(snapshot.summary, null)

  const resetSnapshot = coach.update(frame(1500, { isRaceOn: false }))
  assert.equal(resetSnapshot.phase, PHASES.NEUTRAL)
  assert.equal(resetSnapshot.turnActive, false)
  assert.equal(resetSnapshot.summary, null)
})

test('resets without a false summary when the game clock rolls back', () => {
  const coach = new DriverCoach()
  coach.update(frame(0, { brake: 0.5, steer: 0.2 }))
  coach.update(frame(150, { brake: 0.3, steer: 0.2 }))
  const snapshot = coach.update(frame(100, { steer: 0.2 }))

  assert.equal(snapshot.phase, PHASES.NEUTRAL)
  assert.equal(snapshot.turnActive, false)
  assert.equal(snapshot.summary, null)
})

test('resets without a false summary after a large packet gap', () => {
  const coach = new DriverCoach()
  coach.update(frame(0, { brake: 0.5, steer: 0.2 }))
  coach.update(frame(150, { brake: 0.3, steer: 0.2 }))
  const snapshot = coach.update(frame(500, { steer: 0.05 }))

  assert.equal(snapshot.phase, PHASES.NEUTRAL)
  assert.equal(snapshot.turnActive, false)
  assert.equal(snapshot.summary, null)
})

test('does not grow a telemetry history while processing many frames', () => {
  const coach = new DriverCoach()
  for (let index = 0; index < 10000; index += 1) {
    coach.update(frame(index * 100, { steer: 0.2, brake: 0.3 }))
  }

  assert.equal(Object.values(coach).some(value => Array.isArray(value)), false)
  assert.equal(Object.keys(coach).length, 11)
})
