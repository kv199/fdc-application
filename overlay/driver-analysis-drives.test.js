const test = require('node:test')
const assert = require('node:assert/strict')
const { createDriveSegmenter } = require('./driver-analysis-drives.js')

// Feeds packets and persists every live one with an increasing sequence and a 16 ms telemetry clock.
function run(packets) {
  let wall = 1_000_000
  const segmenter = createDriveSegmenter({ now: () => wall })
  let sequence = 0
  let timestampMs = 5000
  for (const packet of packets) {
    wall += 16
    timestampMs += 16
    const persisted = packet.isRaceOn ? { sequence: sequence++, timestampMs } : null
    segmenter.update(packet, persisted)
  }
  return segmenter.finalize()
}

const live = (distance, { current = distance / 50, raceTime = distance / 50, number = 0, last = 0 } = {}) => ({
  isRaceOn: true, lap: { distance, current, raceTime, number, last }
})
const result = ({ number = 0, last = 0, distance = 0 } = {}) => ({
  isRaceOn: false, lap: { distance, current: 0, raceTime: 0, number, last }
})
const drive = (from, to, step = 50, options = {}) => {
  const packets = []
  for (let distance = from; distance <= to; distance += step) packets.push(live(distance, options))
  return packets
}

test('a sprint that reaches the finish is one finished sprint', () => {
  const drives = run([
    ...drive(0, 3000),
    result({ number: 1, last: 61.2 }),
    live(238, { current: 0, raceTime: 0, number: 1 })
  ])

  assert.equal(drives.length, 1)
  assert.deepEqual(
    { kind: drives[0].kind, finished: drives[0].finished, lapCount: drives[0].lapCount, distanceM: drives[0].distanceM },
    { kind: 'sprint', finished: true, lapCount: null, distanceM: 3000 }
  )
  assert.equal(drives[0].firstSequence, 0)
  assert.equal(drives[0].lastSequence, 60)
  assert.ok(drives[0].finishedAtMs > drives[0].startedAtMs)
})

test('a circuit counts laps that the race continued past and its finish lap', () => {
  const drives = run([
    ...drive(0, 1000, 50, { number: 0 }),
    ...drive(1050, 2000, 50, { number: 1, last: 30 }),
    ...drive(2050, 3000, 50, { number: 2, last: 29 }),
    result({ number: 3, last: 28.5, distance: 3000 })
  ])

  assert.equal(drives.length, 1)
  assert.deepEqual([drives[0].kind, drives[0].finished, drives[0].lapCount], ['circuit', true, 3])
})

test('a restart ends an unfinished circuit and starts the next drive', () => {
  const drives = run([
    ...drive(0, 1000, 50, { number: 0 }),
    ...drive(1050, 2000, 50, { number: 1, last: 30 }),
    ...drive(2050, 2500, 50, { number: 2, last: 29 }),
    ...drive(0, 400, 50, { number: 0, last: 0 })
  ])

  assert.equal(drives.length, 2)
  assert.deepEqual([drives[0].kind, drives[0].finished, drives[0].lapCount], ['circuit', false, 2])
  assert.deepEqual([drives[1].kind, drives[1].finished, drives[1].distanceM], ['sprint', false, 400])
  assert.equal(drives[1].firstSequence, drives[0].lastSequence + 1)
})

test('an in-race rewind and a pause keep one drive', () => {
  const drives = run([
    ...drive(0, 1500),
    live(1300, { current: 20, raceTime: 20 }),
    result({ distance: 1300 }),
    result({ distance: 1300 }),
    ...drive(1350, 2500)
  ])

  assert.equal(drives.length, 1)
  assert.equal(drives[0].kind, 'sprint')
  assert.equal(drives[0].finished, false)
})

test('driving on after the finish line does not turn a sprint into a circuit', () => {
  const drives = run([
    ...drive(0, 2000),
    result({ number: 1, last: 40 }),
    ...drive(2050, 2600, 50, { number: 1, current: 45, raceTime: 45 })
  ])

  assert.equal(drives.length, 1)
  assert.deepEqual([drives[0].kind, drives[0].finished, drives[0].distanceM], ['sprint', true, 2000])
})

test('driving without a clean race start creates no drive', () => {
  assert.deepEqual(run(drive(500, 3000, 50, { current: 30, raceTime: 30 })), [])
})

test('a start without persisted samples is discarded', () => {
  const segmenter = createDriveSegmenter()
  segmenter.update(live(0), null)
  segmenter.update(live(10), null)
  assert.deepEqual(segmenter.finalize(), [])
})
