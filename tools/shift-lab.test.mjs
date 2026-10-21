import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { decodePacket, f32ToJson } from './shift-lab-decoder.mjs'
import { findUpshifts, formatReport, referenceModel, replayLab } from './shift-lab.mjs'

const DASH = 244
const CAR_A = { ordinal: 3766, class: 1, pi: 800, drivetrain: 1, cylinders: 10 }
const CAR_B = { ordinal: 1234, class: 2, pi: 650, drivetrain: 2, cylinders: 8 }
const RPM_PER_KMH = { 1: 80, 2: 52, 3: 38, 4: 29 }

function encodePacket({ car = CAR_A, timestampMs = 0, rpm = 0, speedKmh = 0, power = 0, gear = 0, throttle = 255, brake = 0, clutch = 0 }) {
  const buffer = new ArrayBuffer(324)
  const view = new DataView(buffer)
  view.setInt32(0, 1, true)
  view.setUint32(4, timestampMs, true)
  view.setFloat32(8, 9200, true)
  view.setFloat32(12, 900, true)
  view.setFloat32(16, rpm, true)
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
})

test('the reference reports at-ceiling when power rises to the ceiling', () => {
  const frames = sweepFrames(rpm => rpm * 100)
  const [pair] = referenceModel(frames, 9000).pairs
  assert.equal(pair.kind, 'at-ceiling')
  assert.equal(pair.referenceRpm, 9000)
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
    assert.ok(carA.reference.pairs.every(pair => ['crossover', 'at-ceiling', 'insufficient-data'].includes(pair.kind)))
    assert.equal(result.cars.find(car => car.identity.carOrdinal === CAR_B.ordinal).sessionIds.length, 1)

    const report = formatReport({ ...result, source: { lab: 'fdc-lab.sqlite', fdc: null } })
    assert.match(report, /## Car fh6:3766:1:800:1:10/)
    assert.match(report, /1->2/)
    assert.match(report, /turbo boost/)
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
