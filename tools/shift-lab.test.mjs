import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { decodePacket, f32ToJson } from './shift-lab-decoder.mjs'
import {
  checkExpectations, findFixtures, findUpshifts, formatReport, loadFixture, referenceModel, replayFrames, replayLab, toFixture, writeFixture
} from './shift-lab.mjs'

const DASH = 244
const CAR_A = { ordinal: 3766, class: 1, pi: 800, drivetrain: 1, cylinders: 10 }
const CAR_B = { ordinal: 1234, class: 2, pi: 650, drivetrain: 2, cylinders: 8 }
const RPM_PER_KMH = { 1: 80, 2: 52, 3: 38, 4: 29 }
const WHEEL_RADIUS_M = 0.33
const RPM_TO_RAD_S = 2 * Math.PI / 60
const roadWheelRadS = speedKmh => speedKmh / 3.6 / WHEEL_RADIUS_M
// The engine-to-wheel ratio of a gear that turns the engine rpmPerKmh RPM per km/h with the wheels rolling at road speed.
const wheelRatioOf = rpmPerKmh => rpmPerKmh * RPM_TO_RAD_S * 3.6 * WHEEL_RADIUS_M

// Unless given, every wheel rolls at road speed without slip.
function encodePacket({
  car = CAR_A, timestampMs = 0, rpm = 0, speedKmh = 0, power = 0, gear = 0, throttle = 255, brake = 0, clutch = 0, wheelRotation = null
}) {
  const buffer = new ArrayBuffer(324)
  const view = new DataView(buffer)
  view.setInt32(0, 1, true)
  view.setUint32(4, timestampMs, true)
  view.setFloat32(8, 9200, true)
  view.setFloat32(12, 900, true)
  view.setFloat32(16, rpm, true)
  const road = roadWheelRadS(speedKmh)
  const wheels = wheelRotation ?? { fl: road, fr: road, rl: road, rr: road }
  ;['fl', 'fr', 'rl', 'rr'].forEach((wheel, index) => view.setFloat32(100 + index * 4, wheels[wheel], true))
  view.setFloat32(DASH + 12, speedKmh / 3.6, true)
  view.setFloat32(DASH + 16, power, true)
  view.setUint8(DASH + 71, throttle)
  view.setUint8(DASH + 72, brake)
  view.setUint8(DASH + 73, clutch)
  view.setUint8(DASH + 75, gear)
  view.setInt32(212, car.ordinal, true)
  view.setInt32(216, car.class, true)
  view.setInt32(220, car.pi, true)
  view.setInt32(224, car.drivetrain, true)
  view.setInt32(228, car.cylinders, true)
  return Buffer.from(buffer)
}

// A full-throttle pull through gears 1-4 with limiter bounces at the top of each gear and direct upshifts between them.
function pullPackets(car, startMs = 0) {
  const packets = []
  let timestampMs = startMs
  let speedKmh = 62
  for (const gear of [1, 2, 3, 4]) {
    const ratio = RPM_PER_KMH[gear]
    const startRpm = Math.round(speedKmh * ratio)
    const steps = 300
    const sweep = Array.from({ length: steps + 1 }, (_, index) => startRpm + (9100 - startRpm) * index / steps)
    const bounces = gear === 4 ? [] : [9080, 9110, 9060, 9105]
    for (const rpm of [...sweep, ...bounces]) {
      const speed = rpm / ratio
      packets.push(encodePacket({ car, timestampMs, rpm, speedKmh: speed, power: 500000 - (rpm - 7000) ** 2 * 0.02, gear }))
      timestampMs += 16
    }
    speedKmh = 9100 / ratio
  }
  return packets
}

function labDatabase(path, sessions) {
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE lab_schema_version (version INTEGER NOT NULL);
    INSERT INTO lab_schema_version (version) VALUES (1);
    CREATE TABLE lab_sessions (id INTEGER PRIMARY KEY, started_at_ms INTEGER NOT NULL, finished_at_ms INTEGER,
      app_version TEXT, shift_light_model_version INTEGER, car_ordinal INTEGER, car_class INTEGER, car_pi INTEGER,
      car_drivetrain INTEGER, car_cylinders INTEGER, packet_count INTEGER);
    CREATE TABLE lab_packets (id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES lab_sessions(id),
      sequence INTEGER NOT NULL, received_at_ms INTEGER NOT NULL, packet BLOB NOT NULL);
  `)
  const insertSession = db.prepare('INSERT INTO lab_sessions (id, started_at_ms, finished_at_ms, app_version, shift_light_model_version, car_ordinal, car_class, car_pi, car_drivetrain, car_cylinders, packet_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const insertPacket = db.prepare('INSERT INTO lab_packets (session_id, sequence, received_at_ms, packet) VALUES (?, ?, ?, ?)')
  db.exec('BEGIN')
  sessions.forEach((session, index) => {
    const id = index + 1
    insertSession.run(id, index * 100000, index * 100000 + 60000, 'test', 4, session.car.ordinal, session.car.class, session.car.pi,
      session.car.drivetrain, session.car.cylinders, session.packets.length)
    session.packets.forEach((packet, sequence) => insertPacket.run(id, sequence, sequence * 16, packet))
  })
  db.exec('COMMIT')
  db.close()
  return new DatabaseSync(path, { readOnly: true })
}

function sweepFrames(powerAt) {
  const frames = []
  for (let rpm = 5000; rpm <= 9400; rpm += 10) {
    const gear = rpm <= 7000 ? 1 : 2
    const ratio = gear === 1 ? 80 : 68
    frames.push({ isRaceOn: true, gear, rpm, speedKmh: rpm / ratio, throttle: 1, clutch: 0, brake: 0, handBrake: 0, power: powerAt(rpm), slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 } })
  }
  return frames
}

test('decodePacket matches the golden fixture exactly', () => {
  const golden = JSON.parse(readFileSync(new URL('./shift-lab-decoder-golden.json', import.meta.url), 'utf8'))
  assert.deepStrictEqual(decodePacket(Buffer.from(golden.packetHex, 'hex')), golden.expected)
})

test('decodePacket rejects packets that are not 324 bytes', () => {
  assert.equal(decodePacket(Buffer.alloc(323)), null)
  assert.equal(decodePacket(Buffer.alloc(325)), null)
})

test('f32ToJson prints the shortest decimal that round-trips as f32', () => {
  assert.equal(f32ToJson(Math.fround(128 / 255)), 0.5019608)
  assert.equal(f32ToJson(Math.fround(0.1)), 0.1)
  assert.equal(f32ToJson(Math.fround(7432.5)), 7432.5)
  assert.equal(f32ToJson(NaN), null)
  assert.equal(f32ToJson(Infinity), null)
  assert.ok(Object.is(f32ToJson(-0), -0))
})

test('an upshift through neutral is found only inside the 400 ms window', () => {
  const frame = (gear, timestampMs) => ({ gear, timestampMs, throttle: 1, clutch: 0, brake: 0, handBrake: 0, power: 1, rpm: 1, speedKmh: 1 })
  const within = [frame(1, 0), frame(11, 100), frame(11, 200), frame(2, 300)]
  const late = [frame(1, 0), frame(11, 100), frame(2, 600)]
  assert.deepEqual(findUpshifts(within).map(shift => [shift.sourceGear, shift.destinationGear, shift.via]), [[1, 2, 'neutral']])
  assert.deepEqual(findUpshifts(late), [])
})

test('the reference finds a crossover between the power peak and the ceiling', () => {
  const frames = sweepFrames(rpm => 500000 - (rpm - 7000) ** 2 * 0.05)
  const result = referenceModel(frames, 9000)
  assert.equal(result.pairs.length, 1)
  const [pair] = result.pairs
  assert.equal(pair.kind, 'crossover')
  assert.ok(pair.referenceRpm > 7000 && pair.referenceRpm < 9000, `crossover at ${pair.referenceRpm}`)
  assert.ok(Math.abs(pair.ratioStep - 0.85) < 1e-9)
  assert.equal(pair.coverage, 1)
})

test('the reference skips a gap between the power peak and the crossover', () => {
  const powerAt = rpm => 500000 - (rpm - 7000) ** 2 * 0.05
  const [full] = referenceModel(sweepFrames(powerAt), 9000).pairs
  const gapped = sweepFrames(powerAt).filter(frame => frame.rpm < 7200 || frame.rpm >= 7400)
  const [pair] = referenceModel(gapped, 9000).pairs
  assert.equal(pair.kind, 'crossover')
  assert.equal(pair.referenceRpm, full.referenceRpm)
  assert.ok(pair.coverage > 0.5 && pair.coverage < 1, `coverage ${pair.coverage}`)
})

test('the reference reports at-or-below when the next gear already wins at the first known point', () => {
  // The crossover of this curve is near 7,570 RPM, but without power below 6,600 the first comparable point is about 7,800.
  const frames = sweepFrames(rpm => 500000 - (rpm - 7000) ** 2 * 0.05).filter(frame => frame.rpm >= 6600)
  const [pair] = referenceModel(frames, 9000).pairs
  assert.equal(pair.kind, 'at-or-below')
  assert.ok(pair.referenceRpm > 7568 && pair.referenceRpm < 8000, `upper bound ${pair.referenceRpm}`)
})

test('the power curve keeps wheelspin frames while gear ratios skip them', () => {
  const powerAt = rpm => 500000 - (rpm - 7000) ** 2 * 0.05
  const spinning = sweepFrames(powerAt).map(frame => frame.gear === 1 ? { ...frame, slipRatio: { fl: 0.5, fr: 0.5, rl: 0.5, rr: 0.5 } } : frame)
  const result = referenceModel(spinning, 9000)
  assert.equal(result.curveBins, referenceModel(sweepFrames(powerAt), 9000).curveBins)
  assert.deepEqual(result.ratios.map(ratio => ratio.gear), [2])
  assert.equal(result.pairs[0].kind, 'insufficient-data')
  assert.equal(result.pairs[0].ratioStep, null)
})

// Power climbs steeply to 7,000 RPM and then fades slowly, so with a 0.85 ratio step the crossover is only near 8,170 RPM.
function peakThenFade(rpm) {
  return rpm <= 7000 ? 700000 - (7000 - rpm) * 200 : 700000 - (rpm - 7000) * 10
}

test('the reference reports insufficient-data when coverage stops far below the ceiling without a crossover', () => {
  const frames = sweepFrames(peakThenFade).filter(frame => frame.rpm <= 8000)
  const [pair] = referenceModel(frames, 9000).pairs
  assert.equal(pair.kind, 'insufficient-data')
  assert.equal(pair.referenceRpm, null)
  assert.ok(pair.coverage > 0 && pair.coverage < 0.5, `coverage ${pair.coverage}`)
})

test('the reference reports at-ceiling when coverage reaches within 200 RPM of the ceiling without a crossover', () => {
  const frames = sweepFrames(peakThenFade).filter(frame => frame.rpm <= 8000)
  const [pair] = referenceModel(frames, 8100).pairs
  assert.equal(pair.kind, 'at-ceiling')
  assert.equal(pair.referenceRpm, 8100)
  assert.equal(referenceModel(frames, 8150).pairs[0].kind, 'insufficient-data')
})

test('the reference reports at-ceiling when power rises to the ceiling', () => {
  const frames = sweepFrames(rpm => rpm * 100)
  const [pair] = referenceModel(frames, 9000).pairs
  assert.equal(pair.kind, 'at-ceiling')
  assert.equal(pair.referenceRpm, 9000)
})

// sweepFrames with wheel rotation: the driven wheels turn the engine through gear ratio 10 in gear 1 and 8.5 in gear 2.
// spin(rpm) is the driven wheels' slip ratio; the other wheels roll at road speed. driven picks which wheels the engine turns.
function wheelSweepFrames(powerAt, { drivetrain, driven = ['fl', 'fr', 'rl', 'rr'], spin = () => 0, flat = false }) {
  return sweepFrames(powerAt).map(frame => {
    const drivenRadS = frame.rpm * RPM_TO_RAD_S / (frame.gear === 1 ? 10 : 8.5)
    const slip = spin(frame.rpm)
    const roadRadS = drivenRadS / (1 + slip)
    const wheelRotation = {}
    const slipRatio = {}
    for (const wheel of ['fl', 'fr', 'rl', 'rr']) {
      wheelRotation[wheel] = driven.includes(wheel) ? drivenRadS : roadRadS
      slipRatio[wheel] = driven.includes(wheel) ? slip : 0
    }
    const identity = flat ? { drivetrain } : { car: { drivetrain } }
    return { ...frame, speedKmh: roadRadS * WHEEL_RADIUS_M * 3.6, slipRatio, wheelRotation, ...identity }
  })
}

test('the reference takes the gear ratio from the spinning driven wheels where rpm / speed has none', () => {
  const powerAt = rpm => 500000 - (rpm - 7000) ** 2 * 0.05
  const options = { drivetrain: 1, driven: ['rl', 'rr'], spin: rpm => 0.2 + (rpm % 400) / 1000 }
  const spinning = wheelSweepFrames(powerAt, options)
  const result = referenceModel(spinning, 9000)
  assert.deepEqual(result.ratios.map(item => [item.gear, item.source]), [[1, 'wheel'], [2, 'wheel']])
  assert.ok(Math.abs(result.ratios[0].ratio - 10) < 1e-9, `gear 1 ratio ${result.ratios[0].ratio}`)
  assert.ok(Math.abs(result.ratios[1].ratio - 8.5) < 1e-9, `gear 2 ratio ${result.ratios[1].ratio}`)
  const [pair] = result.pairs
  assert.equal(pair.ratioSource, 'wheel')
  assert.ok(Math.abs(pair.ratioStep - 0.85) < 1e-9)
  assert.equal(pair.kind, 'crossover')
  assert.equal(pair.referenceRpm, referenceModel(sweepFrames(powerAt), 9000).pairs[0].referenceRpm)

  // The same frames without wheel rotation fall back to rpm / speed, which every slipping frame fails.
  const [fallback] = referenceModel(spinning.map(frame => ({ ...frame, wheelRotation: null })), 9000).pairs
  assert.equal(fallback.kind, 'insufficient-data')
  assert.equal(fallback.ratioStep, null)
  assert.equal(fallback.ratioSource, null)
})

test('the reference uses the front pair for FWD and the rear pair for RWD and AWD', () => {
  const powerAt = rpm => 500000 - (rpm - 7000) ** 2 * 0.05
  // The front wheels spin 50% faster than the road while the rear roll at road speed.
  const frames = flat => wheelSweepFrames(powerAt, { drivetrain: null, driven: ['fl', 'fr'], spin: () => 0.5, flat })
  const gearOne = (drivetrain, flat = false) =>
    referenceModel(frames(flat).map(frame => flat ? { ...frame, drivetrain } : { ...frame, car: { drivetrain } }), 9000).ratios[0]
  assert.ok(Math.abs(gearOne(0).ratio - 10) < 1e-9, `FWD ${gearOne(0).ratio}`)
  assert.ok(Math.abs(gearOne(1).ratio - 15) < 1e-9, `RWD ${gearOne(1).ratio}`)
  assert.ok(Math.abs(gearOne(2).ratio - 15) < 1e-9, `AWD ${gearOne(2).ratio}`)
  // replaySession hands referenceModel frames with a flat drivetrain.
  assert.ok(Math.abs(gearOne(1, true).ratio - 15) < 1e-9, `flat RWD ${gearOne(1, true).ratio}`)
  assert.equal(gearOne(2, true).source, 'wheel')
})

test('the reference falls back to rpm / speed without a known drivetrain and drops wheels slower than 5 rad/s', () => {
  const powerAt = rpm => 500000 - (rpm - 7000) ** 2 * 0.05
  const clean = wheelSweepFrames(powerAt, { drivetrain: 7 })
  const unknown = referenceModel(clean, 9000)
  assert.deepEqual(unknown.ratios.map(item => item.source), ['speed', 'speed'])
  assert.equal(unknown.pairs[0].ratioSource, 'speed')
  assert.ok(Math.abs(unknown.pairs[0].ratioStep - 0.85) < 1e-9)
  const missing = referenceModel(clean.map(frame => ({ ...frame, car: { drivetrain: 1 }, wheelRotation: null })), 9000)
  assert.deepEqual(missing.ratios.map(item => item.source), ['speed', 'speed'])

  // Known drivetrain with nearly stopped driven wheels: neither source gives a ratio.
  const stalled = clean.map(frame => ({ ...frame, car: { drivetrain: 1 }, wheelRotation: { fl: 40, fr: 40, rl: 4.9, rr: -4.9 } }))
  const result = referenceModel(stalled, 9000)
  assert.deepEqual(result.ratios, [])
  assert.equal(result.pairs[0].kind, 'insufficient-data')
})

test('a reference ratio step never mixes wheel and rpm / speed ratios', () => {
  const powerAt = rpm => 500000 - (rpm - 7000) ** 2 * 0.05
  const frames = wheelSweepFrames(powerAt, { drivetrain: 2 })
  const mixed = frames.map(frame => frame.gear === 2 ? { ...frame, wheelRotation: null } : frame)
  const result = referenceModel(mixed, 9000)
  assert.deepEqual(result.ratios.map(item => [item.gear, item.source]), [[1, 'wheel'], [2, 'speed']])
  assert.equal(result.pairs[0].ratioStep, null)
  assert.equal(result.pairs[0].ratioSource, null)
  assert.equal(result.pairs[0].kind, 'insufficient-data')

  // When gear 2 has both sources, the step uses the wheel ratios of both gears.
  const both = [...frames, ...mixed.filter(frame => frame.gear === 2)]
  const [pair] = referenceModel(both, 9000).pairs
  assert.equal(pair.ratioSource, 'wheel')
  assert.ok(Math.abs(pair.ratioStep - 0.85) < 1e-9)
})

test('replayLab groups sessions by car and reports shifts, cues and a reference per pair', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shift-lab-'))
  let lab = null
  try {
    lab = labDatabase(join(dir, 'fdc-lab.sqlite'), [
      { car: CAR_A, packets: pullPackets(CAR_A) },
      { car: CAR_A, packets: pullPackets(CAR_A) },
      { car: CAR_B, packets: pullPackets(CAR_B) }
    ])
    const result = replayLab(lab)
    assert.equal(result.sessions, 3)
    assert.equal(result.cars.length, 2)
    assert.equal(result.fdc, null)

    const carA = result.cars.find(car => car.identity.carOrdinal === CAR_A.ordinal)
    assert.equal(carA.key, 'fh6:3766:1:800:1:10')
    assert.deepEqual(carA.sessionIds, [1, 2])
    assert.ok(carA.shifts.length >= 6, `shifts ${carA.shifts.length}`)
    assert.ok(carA.summary.acceptedCount >= 3, `accepted ${carA.summary.acceptedCount}`)
    assert.ok(carA.cues.length > 0)
    assert.deepEqual(carA.reference.pairs.map(pair => pair.pair), ['1->2', '2->3', '3->4'])
    assert.ok(carA.reference.pairs.every(pair => ['crossover', 'at-or-below', 'at-ceiling', 'insufficient-data'].includes(pair.kind)))
    assert.equal(result.cars.find(car => car.identity.carOrdinal === CAR_B.ordinal).sessionIds.length, 1)

    const report = formatReport({ ...result, source: { lab: 'fdc-lab.sqlite', fdc: null } })
    assert.match(report, /## Car fh6:3766:1:800:1:10/)
    assert.match(report, /1->2/)
    assert.match(report, /turbo boost/)
    assert.match(report, /\(cov \d\.\d\d\)/)
  } finally {
    lab?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('replayLab reports missing Shift Light tables in the game comparison', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shift-lab-'))
  let lab = null
  const fdc = new DatabaseSync(':memory:')
  try {
    lab = labDatabase(join(dir, 'fdc-lab.sqlite'), [{ car: CAR_A, packets: pullPackets(CAR_A) }])
    const result = replayLab(lab, { fdcDb: fdc })
    assert.equal(result.fdc.available, false)
    assert.match(result.fdc.message, /shift_light_configs/)
    assert.equal(result.cars[0].game, null)
  } finally {
    fdc.close()
    lab?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('replayLab reads the game config and gear targets from fdc.sqlite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shift-lab-'))
  let lab = null
  const fdc = new DatabaseSync(':memory:')
  fdc.exec(`
    CREATE TABLE shift_light_configs (id INTEGER PRIMARY KEY, game_id TEXT NOT NULL, car_ordinal INTEGER NOT NULL,
      car_class INTEGER NOT NULL, car_performance_index INTEGER NOT NULL, drivetrain_type INTEGER NOT NULL,
      num_cylinders INTEGER NOT NULL, usable_ceiling_rpm INTEGER);
    CREATE TABLE shift_light_gear_targets (config_id INTEGER NOT NULL, source_gear INTEGER NOT NULL,
      destination_gear INTEGER NOT NULL, status TEXT NOT NULL, candidate_rpm INTEGER, optimal_rpm INTEGER,
      confirmation_count INTEGER NOT NULL DEFAULT 0);
    INSERT INTO shift_light_configs VALUES (1, 'fh6', 3766, 1, 800, 1, 10, 9100);
    INSERT INTO shift_light_gear_targets VALUES (1, 1, 2, 'optimal', 7400, 7400, 3);
  `)
  try {
    lab = labDatabase(join(dir, 'fdc-lab.sqlite'), [{ car: CAR_A, packets: pullPackets(CAR_A) }])
    const result = replayLab(lab, { fdcDb: fdc })
    assert.equal(result.fdc.available, true)
    const [car] = result.cars
    assert.equal(car.game.found, true)
    assert.equal(car.game.usableCeilingRpm, 9100)
    assert.equal(car.comparison.find(row => row.pair === '1->2').game.rpm, 7400)
  } finally {
    fdc.close()
    lab?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

const KEY_A = 'fh6:3766:1:800:1:10'
const KEY_B = 'fh6:1234:2:650:2:8'
const FIXTURE_FIELDS = [
  'isRaceOn', 'timestampMs', 'rpm', 'rpmMax', 'speedKmh', 'power', 'gear', 'throttle', 'brake', 'clutch', 'handBrake', 'car', 'slipRatio', 'wheelRotation'
]
const SHIFT_LAB = fileURLToPath(new URL('./shift-lab.mjs', import.meta.url))

function decodedSessions(packetSessions) {
  return packetSessions.map((packets, index) => ({ id: index + 1, frames: packets.map(packet => decodePacket(packet)) }))
}

test('toFixture keeps only the fields the learner and the reference read', () => {
  const keyless = encodePacket({ car: { ordinal: 0, class: 0, pi: 0, drivetrain: 0, cylinders: 0 }, timestampMs: 5 })
  const mixed = [...pullPackets(CAR_A).slice(0, 10), keyless, ...pullPackets(CAR_B).slice(0, 5), ...pullPackets(CAR_A).slice(0, 10)]
  const fixture = toFixture(decodedSessions([mixed, pullPackets(CAR_B).slice(0, 5)]), KEY_A)
  assert.equal(fixture.format, 'fdc-shift-lab-fixture')
  assert.equal(fixture.formatVersion, 2)
  assert.equal(fixture.key, KEY_A)
  assert.deepEqual(fixture.sessions.map(session => session.id), [1])
  const { frames } = fixture.sessions[0]
  assert.equal(frames.length, 22)
  for (const frame of frames) {
    assert.deepEqual(Object.keys(frame), FIXTURE_FIELDS)
    assert.deepEqual(Object.keys(frame.car), ['ordinal', 'class', 'pi', 'drivetrain', 'cylinders'])
    assert.deepEqual(Object.keys(frame.slipRatio), ['fl', 'fr', 'rl', 'rr'])
    assert.deepEqual(Object.keys(frame.wheelRotation), ['fl', 'fr', 'rl', 'rr'])
  }
  assert.deepEqual(frames.slice(10, 12).map(frame => frame.car.ordinal), [0, 0])
  assert.equal(frames[0].car.ordinal, CAR_A.ordinal)
})

test('a fixture round-trips through a gzip file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shift-lab-'))
  try {
    const fixture = toFixture(decodedSessions([pullPackets(CAR_A).slice(0, 50)]), KEY_A)
    const path = join(dir, 'nested', 'car.json.gz')
    writeFixture(path, fixture)
    assert.deepEqual(loadFixture(path), fixture)
    const wrong = join(dir, 'wrong.json.gz')
    for (const formatVersion of [1, 3]) {
      writeFileSync(wrong, gzipSync(JSON.stringify({ ...fixture, formatVersion })))
      assert.throws(() => loadFixture(wrong), /fdc-shift-lab-fixture v2/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('replayFrames on fixture sessions matches replayLab on the same packets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shift-lab-'))
  let lab = null
  try {
    const packetSessions = [pullPackets(CAR_A), pullPackets(CAR_A)]
    lab = labDatabase(join(dir, 'fdc-lab.sqlite'), packetSessions.map(packets => ({ car: CAR_A, packets })))
    const fromLab = replayLab(lab)
    const fromFixture = replayFrames(toFixture(decodedSessions(packetSessions), KEY_A).sessions)
    assert.ok(fromLab.cars[0].summary.acceptedCount > 0)
    assert.deepEqual(fromFixture.cars, fromLab.cars)
    assert.equal(fromFixture.keyedFrames, fromLab.keyedFrames)
  } finally {
    lab?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('checkExpectations reports each kind of failure and passes a matching expectation', () => {
  const car = usable => ({
    ceiling: { usable },
    learner: {
      gearTargets: [
        { sourceGear: 1, destinationGear: 2, status: 'optimal', candidateRpm: 9300, targetRpm: 9350 },
        { sourceGear: 2, destinationGear: 3, status: 'potential', candidateRpm: 9450, targetRpm: null },
        { sourceGear: 3, destinationGear: 4, status: 'learning', candidateRpm: 8000, targetRpm: null }
      ]
    }
  })
  assert.deepEqual(checkExpectations(car(9500), {
    description: 'matches', usableCeilingRpm: [9450, 9550], minLearnedShiftRpm: 9300, pairs: { '1->2': 'optimal', '3->4': 'learning' }
  }), [])
  assert.deepEqual(checkExpectations(car(9500), {}), [])
  assert.deepEqual(checkExpectations(car(null), { usableCeilingRpm: [9450, 9550] }), ['usable ceiling is null, expected 9450-9550'])
  assert.deepEqual(checkExpectations(car(9600), { usableCeilingRpm: [9450, 9550] }), ['usable ceiling 9600 is outside 9450-9550'])
  assert.deepEqual(checkExpectations(car(9500), { minLearnedShiftRpm: 9400 }), ['1->2 optimal at 9350, expected at least 9400'])
  assert.deepEqual(checkExpectations(car(9500), { pairs: { '2->3': 'optimal', '4->5': 'learning' } }), [
    '2->3 is potential, expected optimal',
    '4->5 has no learner state, expected learning'
  ])
})

test('checkExpectations checks accepted shifts and reference crossovers', () => {
  const car = {
    ceiling: { usable: null },
    learner: { gearTargets: [] },
    summary: { acceptedCount: 4 },
    reference: {
      pairs: [
        { pair: '2->3', kind: 'crossover', referenceRpm: 7450 },
        { pair: '3->4', kind: 'at-ceiling', referenceRpm: 9010 }
      ]
    }
  }
  assert.deepEqual(checkExpectations(car, { minAcceptedShifts: 4, referenceRpm: { '2->3': [7200, 7700] } }), [])
  assert.deepEqual(checkExpectations(car, { minAcceptedShifts: 5 }), ['4 accepted shifts, expected at least 5'])
  assert.deepEqual(checkExpectations(car, { referenceRpm: { '2->3': [7500, 7700], '3->4': [6800, 7300], '4->5': [6000, 6500] } }), [
    '2->3 reference crossover 7450 is outside 7500-7700',
    '3->4 reference is at-ceiling, expected a crossover at 6800-7300',
    '4->5 has no reference, expected a crossover at 6000-6500'
  ])
})

test('checkExpectations checks the final shift point of each pair', () => {
  const model = (shiftAtRpm, extra = {}) => ({ modelRpm: shiftAtRpm, shiftAtRpm, ready: true, kind: 'crossover', coverage: 1, agree: 0, contradict: 0, rejected: false, ...extra })
  const car = {
    ceiling: { usable: 9000 },
    learner: { gearTargets: [] },
    comparison: [
      { pair: '2->3', model: model(7450) },
      { pair: '3->4', model: model(9000, { modelRpm: null, ready: false, kind: null }) },
      { pair: '4->5', model: null }
    ]
  }
  assert.deepEqual(checkExpectations(car, { shiftAtRpm: { '2->3': [7200, 7700] } }), [])
  assert.deepEqual(checkExpectations(car, { shiftAtRpm: { '2->3': [7500, 7700], '3->4': [6800, 7300], '4->5': [6000, 6500], '5->6': [6000, 6500] } }), [
    '2->3 shifts at 7450, outside 7500-7700',
    '3->4 shifts at 9000, outside 6800-7300',
    '4->5 has no shift point, expected 6000-6500',
    '5->6 has no shift point, expected 6000-6500'
  ])
})

test('the report shows the learner model point and readiness of each pair', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shift-lab-'))
  let lab = null
  try {
    lab = labDatabase(join(dir, 'fdc-lab.sqlite'), [{ car: CAR_A, packets: pullPackets(CAR_A) }, { car: CAR_A, packets: pullPackets(CAR_A) }])
    const result = replayLab(lab)
    const [car] = result.cars
    for (const row of car.comparison.filter(item => item.replay !== null)) {
      assert.deepEqual(Object.keys(row.model), ['modelRpm', 'shiftAtRpm', 'ready', 'kind', 'coverage', 'agree', 'contradict', 'rejected'])
      assert.equal(typeof row.model.shiftAtRpm, 'number')
      assert.equal(row.model.ready, row.model.modelRpm !== null || row.replay.status === 'optimal')
    }
    // The power peak at 7,000 RPM and the gear step put the 2 -> 3 model point at the reference crossover below the limiter.
    const row = car.comparison.find(item => item.pair === '2->3')
    assert.equal(row.model.kind, 'crossover')
    assert.ok(row.model.modelRpm > 7000 && row.model.modelRpm < 9100, `model ${row.model.modelRpm}`)
    assert.ok(Math.abs(row.model.modelRpm - row.reference.rpm) <= 50, `model ${row.model.modelRpm}, reference ${row.reference.rpm}`)
    assert.equal(row.model.shiftAtRpm, row.model.modelRpm)
    const report = formatReport({ ...result, source: { lab: 'fdc-lab.sqlite', fdc: null } })
    assert.match(report, /pair\s+replay\s+model\s+game\s+reference/)
    assert.match(report, new RegExp(`2->3\\s+\\S+(?: \\d+)?\\s+${row.model.modelRpm} ready`))
  } finally {
    lab?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findFixtures pairs fixtures with their expectations and tolerates a missing folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shift-lab-'))
  try {
    assert.deepEqual(findFixtures(join(dir, 'missing')), { fixtures: [], unmatched: [] })
    assert.deepEqual(findFixtures(dir), { fixtures: [], unmatched: [] })
    for (const name of ['a.json.gz', 'a.expect.json', 'b.json.gz', 'notes.txt']) writeFileSync(join(dir, name), '')
    assert.deepEqual(findFixtures(dir), {
      fixtures: [{ name: 'a', path: join(dir, 'a.json.gz'), expectPath: join(dir, 'a.expect.json') }],
      unmatched: ['b']
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the fixture export refuses a selection with several cars unless --car names one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shift-lab-'))
  try {
    const labPath = join(dir, 'fdc-lab.sqlite')
    labDatabase(labPath, [{ car: CAR_A, packets: pullPackets(CAR_A) }, { car: CAR_B, packets: pullPackets(CAR_B) }]).close()
    const out = join(dir, 'car.json.gz')
    const refused = spawnSync(process.execPath, [SHIFT_LAB, '--lab', labPath, '--fixture', out], { encoding: 'utf8' })
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, new RegExp(KEY_A))
    assert.match(refused.stderr, new RegExp(KEY_B))
    assert.equal(existsSync(out), false)

    const chosen = spawnSync(process.execPath, [SHIFT_LAB, '--lab', labPath, '--car', KEY_B, '--fixture', out], { encoding: 'utf8' })
    assert.equal(chosen.status, 0, chosen.stderr)
    const fixture = loadFixture(out)
    assert.equal(fixture.key, KEY_B)
    assert.deepEqual(fixture.sessions.map(session => session.id), [2])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// One packet per entry at full throttle with no wheelspin; an entry may override throttle or skip ahead in time.
function runPackets(car, startMs, stepMs, entries) {
  let timestampMs = startMs
  return entries.map(entry => {
    const packet = encodePacket({ car, timestampMs, power: 400000, throttle: 255, ...entry })
    timestampMs += stepMs
    return packet
  })
}

// A clutch upshift from 2 to 3 at full throttle: the engine was revved in neutral, so for the first frames of gear 3
// the RPM is far above what the road speed gives while the tyres do not slip at all.
function clutchShiftSession(car, startMs, settledFrames) {
  const gear2 = Array.from({ length: 40 }, (_, index) => {
    const rpm = 6000 + index * 75
    return { gear: 2, rpm, speedKmh: rpm / RPM_PER_KMH[2] }
  })
  const speedKmh = gear2.at(-1).speedKmh
  const slipping = Array.from({ length: 10 }, (_, index) => ({ gear: 3, rpm: 8800 - index * 100, speedKmh }))
  const settled = Array.from({ length: settledFrames }, (_, index) => {
    const rpm = speedKmh * RPM_PER_KMH[3] + index * 50
    return { gear: 3, rpm, speedKmh: rpm / RPM_PER_KMH[3] }
  })
  const lift = { gear: 3, rpm: 7000, speedKmh: 7000 / RPM_PER_KMH[3], throttle: 0 }
  return runPackets(car, startMs, 16, [...gear2, ...slipping, ...settled, lift])
}

test('the reference gear ratio ignores clutch slip right after an upshift', () => {
  // One pull settles in gear 3; in two more the driver lifts before gear 3 settles, so most gear-3 frames slip.
  const packetSessions = [clutchShiftSession(CAR_A, 0, 12), clutchShiftSession(CAR_A, 0, 0), clutchShiftSession(CAR_A, 0, 0)]
  const sessions = decodedSessions(packetSessions)
  const unfiltered = referenceModel(sessions.flatMap(session => session.frames), 9000)
  assert.ok(unfiltered.ratios.find(ratio => ratio.gear === 3).ratio > wheelRatioOf(40), 'the scenario must corrupt an unfiltered gear-3 ratio')

  const [car] = replayFrames(sessions).cars
  const gear3 = car.reference.ratios.find(ratio => ratio.gear === 3)
  assert.equal(gear3.frames, 12)
  assert.equal(gear3.source, 'wheel')
  assert.ok(Math.abs(gear3.ratio - wheelRatioOf(RPM_PER_KMH[3])) < 0.001, `gear 3 ratio ${gear3.ratio}`)
  const gear2 = car.reference.ratios.find(ratio => ratio.gear === 2)
  assert.equal(gear2.frames, 3 * 30)
  assert.ok(Math.abs(gear2.ratio - wheelRatioOf(RPM_PER_KMH[2])) < 0.001, `gear 2 ratio ${gear2.ratio}`)
  const pair = car.reference.pairs.find(item => item.pair === '2->3')
  assert.ok(Math.abs(pair.ratioStep - RPM_PER_KMH[3] / RPM_PER_KMH[2]) < 0.001, `2->3 step ${pair.ratioStep}`)
})

test('the reference uses no frame from the first 150 ms of a clean run', () => {
  // Every segment is 20 frames 10 ms apart, so only the frames at 150-190 ms into the run are settled.
  const segment = (gear, overrides = {}) => Array.from({ length: 20 }, (_, index) => {
    const rpm = 6000 + index * 20
    return { gear, rpm, speedKmh: rpm / RPM_PER_KMH[gear], ...(index === 0 ? overrides : {}) }
  })
  const lift = { gear: 4, rpm: 6400, speedKmh: 6400 / RPM_PER_KMH[4], throttle: 0 }
  const first = [
    ...runPackets(CAR_A, 1000, 10, segment(4)),
    ...runPackets(CAR_A, 1200, 10, [lift, ...segment(4)]),
    ...runPackets(CAR_A, 2900, 10, segment(4)),
    ...runPackets(CAR_A, 2500, 10, segment(4)),
    ...runPackets(CAR_B, 2700, 10, [{ gear: 4, rpm: 6000, speedKmh: 6000 / RPM_PER_KMH[4] }]),
    ...runPackets(CAR_A, 2710, 10, segment(4)),
    ...runPackets(CAR_A, 2910, 10, segment(3))
  ]
  // The second session continues seamlessly in the same gear, so only the session start restarts the run.
  const second = runPackets(CAR_A, 3110, 10, segment(3))
  const car = replayFrames(decodedSessions([first, second])).cars.find(item => item.key === KEY_A)
  const frames = gear => car.reference.ratios.find(ratio => ratio.gear === gear)?.frames ?? 0
  // Runs restart at the session start, after a lift, after a 1.5 s gap, when time goes back, after another car and in a new gear.
  assert.equal(frames(4), 5 * 5)
  assert.equal(frames(3), 2 * 5)
})
