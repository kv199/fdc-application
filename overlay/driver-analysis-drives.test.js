const test = require('node:test')
const assert = require('node:assert/strict')
const { createDriveSegmenter, isZeroedResultPacket } = require('./driver-analysis-drives.js')

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

test('an online circuit that stops one lap past its last boundary is finished', () => {
  const drives = run([
    ...drive(0, 1000, 50, { number: 0 }),
    ...drive(1050, 2000, 50, { number: 1, last: 30 }),
    ...drive(2050, 3050, 50, { number: 2, last: 29 }),
    ...drive(0, 400, 50, { number: 0, last: 0 })
  ])

  assert.equal(drives.length, 2)
  assert.deepEqual([drives[0].kind, drives[0].finished, drives[0].lapCount], ['circuit', true, 3])
})

test('an online circuit that stops mid-lap stays unfinished', () => {
  const drives = run([
    ...drive(0, 1000, 50, { number: 0 }),
    ...drive(1050, 2000, 50, { number: 1, last: 30 }),
    ...drive(2050, 2600, 50, { number: 2, last: 29 }),
    ...drive(0, 400, 50, { number: 0, last: 0 })
  ])

  assert.equal(drives.length, 2)
  assert.deepEqual([drives[0].kind, drives[0].finished, drives[0].lapCount], ['circuit', false, 2])
})

test('an online circuit finish allows a small distance difference', () => {
  const drives = run([
    ...drive(0, 1000, 50, { number: 0 }),
    ...drive(1050, 2000, 50, { number: 1, last: 30 }),
    ...drive(2050, 3030, 10, { number: 2, last: 29 }),
    ...drive(0, 400, 50, { number: 0, last: 0 })
  ])

  assert.equal(drives.length, 2)
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

test('an online start that reports distance while the race clock runs on stays one drive', () => {
  const packets = []
  for (let index = 0; index <= 120; index++) {
    const clock = index * 0.016
    // Every fourth packet reports a distance ahead of the others, like FH6 online starts.
    packets.push(live(index % 4 === 3 ? 40 : 0, { current: clock, raceTime: clock }))
  }
  for (let distance = 100; distance <= 3000; distance += 50) {
    packets.push(live(distance, { current: 2 + distance / 50, raceTime: 2 + distance / 50 }))
  }
  packets.push(result({ number: 1, last: 61.2 }))
  const drives = run(packets)

  assert.equal(drives.length, 1)
  assert.equal(drives[0].firstSequence, 0)
  assert.equal(drives[0].kind, 'sprint')
  assert.equal(drives[0].finished, true)
})

test('a clean start after the race clock went back still starts a new drive', () => {
  const drives = run([
    ...drive(0, 1000),
    ...drive(0, 400)
  ])

  assert.equal(drives.length, 2)
  assert.equal(drives[0].distanceM, 1000)
  assert.equal(drives[1].distanceM, 400)
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

test('resetting the car to the track mid-race keeps one drive', () => {
  const resume = []
  for (let distance = 2400; distance <= 3050; distance += 50) {
    const clock = 52 + (distance - 2400) / 50
    resume.push(live(distance, { current: clock, raceTime: clock, number: 2, last: 29 }))
  }
  const drives = run([
    ...drive(0, 1000, 50, { number: 0 }),
    ...drive(1050, 2000, 50, { number: 1, last: 30 }),
    ...drive(2050, 2500, 50, { number: 2, last: 29 }),
    // The reset to the track: distance and lap fall back while the race clock runs on.
    live(0, { current: 0, raceTime: 51, number: 0 }),
    live(0, { current: 0, raceTime: 51, number: 0 }),
    live(0, { current: 0, raceTime: 51, number: 0 }),
    ...resume,
    ...drive(0, 400, 50, { number: 0, last: 0 })
  ])

  assert.equal(drives.length, 2)
  assert.equal(drives[0].kind, 'circuit')
  assert.equal(drives[0].finished, true)
  assert.equal(drives[0].lapCount, 3)
  assert.equal(drives[0].distanceM, 3050)
  assert.equal(drives[1].firstSequence, drives[0].lastSequence + 1)
})

test('a fall back to another lap that never resumes still ends the drive', () => {
  const drives = run([
    ...drive(0, 1000, 50, { number: 0 }),
    ...drive(1050, 2000, 50, { number: 1, last: 30 }),
    ...drive(2050, 2500, 50, { number: 2, last: 29 }),
    live(300, { current: 6, raceTime: 6, number: 0 }),
    live(350, { current: 7, raceTime: 7, number: 0 }),
    live(400, { current: 8, raceTime: 8, number: 0 })
  ])

  assert.equal(drives.length, 1)
  assert.equal(drives[0].kind, 'circuit')
  assert.equal(drives[0].finished, false)
  assert.equal(drives[0].lapCount, 2)
  assert.equal(drives[0].distanceM, 2500)
  assert.equal(drives[0].lastSequence, 50)
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

test('a sprint that ends with zeroed result packets and then finalize is finished', () => {
  const drives = run([
    ...drive(0, 3000),
    result({ distance: 0, current: 0, raceTime: 0 }),
    result({ distance: 0, current: 0, raceTime: 0 })
  ])

  assert.equal(drives.length, 1)
  assert.deepEqual(
    { kind: drives[0].kind, finished: drives[0].finished, lapCount: drives[0].lapCount },
    { kind: 'sprint', finished: true, lapCount: null }
  )
})

test('a zeroed sprint result followed by a new start gives two finished sprints', () => {
  const drives = run([
    ...drive(0, 3000),
    result({ distance: 0, current: 0, raceTime: 0 }),
    result({ distance: 0, current: 0, raceTime: 0 }),
    ...drive(0, 2000, 50, { current: 0, raceTime: 0 }),
    result({ distance: 0, current: 0, raceTime: 0 })
  ])

  assert.equal(drives.length, 2)
  assert.equal(drives[0].finished, true)
  assert.deepEqual([drives[1].kind, drives[1].finished], ['sprint', true])
})

test('free roam after a zeroed result is not part of the finished sprint', () => {
  const drives = run([
    ...drive(0, 3000),
    result({ distance: 0, current: 0, raceTime: 0 }),
    live(50, { current: 5, raceTime: 2, number: 0 })
  ])

  assert.equal(drives.length, 1)
  assert.equal(drives[0].finished, true)
  assert.equal(drives[0].lastSequence, 60)
})

test('a race that continues after zeroed packets keeps the drive open', () => {
  const drives = run([
    live(0, { current: 0, raceTime: 0 }),
    ...drive(50, 3000),
    result({ distance: 0, current: 0, raceTime: 0 }),
    live(3000, { current: 60.5, raceTime: 60.5 })
  ])

  assert.equal(drives.length, 1)
  assert.equal(drives[0].finished, false)
})

test('a drive that ends with a zeroed result within its first 25 m is not saved', () => {
  const drives = run([
    live(0, { current: 0, raceTime: 0 }),
    live(25, { current: 0.5, raceTime: 0.5 }),
    result({ distance: 0, current: 0, raceTime: 0 })
  ])

  assert.equal(drives.length, 0)
})

test('zeroed packets do not finish a circuit', () => {
  const drives = run([
    ...drive(0, 1000, 50, { number: 0 }),
    ...drive(1050, 2000, 50, { number: 1, last: 30 }),
    result({ distance: 0, current: 0, raceTime: 0 }),
    result({ distance: 0, current: 0, raceTime: 0 })
  ])

  assert.equal(drives.length, 1)
  assert.deepEqual([drives[0].kind, drives[0].finished], ['circuit', false])
})

test('an advancing non-live Current Lap repeated in two packets is the sprint finish', () => {
  const drives = run([
    live(0, { current: 0, raceTime: 0 }),
    ...drive(50, 2000),
    { isRaceOn: false, lap: { distance: 100, current: 52, raceTime: 50, number: 0, last: 0 }, car: { ordinal: 1 } },
    { isRaceOn: false, lap: { distance: 100, current: 52, raceTime: 50, number: 0, last: 0 }, car: { ordinal: 1 } },
    live(2000, { current: 50, raceTime: 50 })
  ])

  assert.equal(drives.length, 1)
  assert.equal(drives[0].finished, true)
})

test('an advancing non-live Current Lap that does not repeat is not a finish', () => {
  const drives = run([
    live(0, { current: 0, raceTime: 0 }),
    ...drive(50, 2000),
    { isRaceOn: false, lap: { distance: 100, current: 52, raceTime: 50, number: 0, last: 0 }, car: { ordinal: 1 } },
    { isRaceOn: false, lap: { distance: 100, current: 53, raceTime: 50, number: 0, last: 0 }, car: { ordinal: 1 } }
  ])

  assert.equal(drives.length, 1)
  assert.equal(drives[0].finished, false)
})

test('a clean start followed by stationary packets and finalize creates no drive', () => {
  const drives = run([
    live(0, { current: 0, raceTime: 0 }),
    live(0, { current: 2, raceTime: 2 }),
    live(0, { current: 4, raceTime: 4 }),
    live(0, { current: 6, raceTime: 6 }),
    live(0, { current: 8, raceTime: 8 }),
    live(0, { current: 10, raceTime: 10 }),
    live(0, { current: 12, raceTime: 12 }),
    live(0, { current: 14, raceTime: 14 }),
    live(0, { current: 16, raceTime: 16 }),
    live(0, { current: 18, raceTime: 18 }),
    live(0, { current: 20, raceTime: 20 })
  ])

  assert.equal(drives.length, 0)
})

test('a finished sprint followed by a clean start where car never moves creates one drive', () => {
  const drives = run([
    ...drive(0, 3000),
    result({ number: 1, last: 61.2 }),
    live(238, { current: 0, raceTime: 0, number: 1 }),
    live(0, { current: 0, raceTime: 0, number: 0 }),
    live(0, { current: 2, raceTime: 2, number: 0 }),
    live(0, { current: 4, raceTime: 4, number: 0 })
  ])

  assert.equal(drives.length, 1)
  assert.equal(drives[0].kind, 'sprint')
  assert.equal(drives[0].finished, true)
  assert.equal(drives[0].distanceM, 3000)
})

test('a drive of exactly 30 m is kept', () => {
  const drives = run([
    live(0, { current: 0, raceTime: 0 }),
    live(10, { current: 0.2, raceTime: 0.2 }),
    live(20, { current: 0.4, raceTime: 0.4 }),
    live(30, { current: 0.6, raceTime: 0.6 }),
    result({ number: 1, last: 1.2, distance: 30 })
  ])

  assert.equal(drives.length, 1)
  assert.equal(drives[0].distanceM, 30)
})

test('isZeroedResultPacket returns true for zeroed packet', () => {
  const zeroed = result({ distance: 0, current: 0, raceTime: 0 })
  assert.ok(isZeroedResultPacket(zeroed))
})

test('isZeroedResultPacket returns false for live packet', () => {
  const livePacket = live(1000)
  assert.ok(!isZeroedResultPacket(livePacket))
})

test('isZeroedResultPacket returns false when distance is non-zero', () => {
  const nonZeroed = result({ distance: 100, current: 0, raceTime: 0 })
  assert.ok(!isZeroedResultPacket(nonZeroed))
})
