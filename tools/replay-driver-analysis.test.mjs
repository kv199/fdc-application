import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import {
  compareSession, exportFromDatabase, readExportFile, replayExport, replaySample, validateExport
} from './replay-driver-analysis.mjs'

const require = createRequire(import.meta.url)
const analysis = require('../overlay/driver-analysis.js')
const engineApi = require('../overlay/driver-analysis-engine.js')

const WHEELS = ['fl', 'fr', 'rl', 'rr']
const QUAD_COLUMNS = ['slip_ratio', 'slip_angle', 'combined_slip', 'tire_temp', 'suspension', 'rumble', 'puddle']
const SAMPLE_COLUMNS = [
  'sequence', 'timestamp_ms', 'speed_kmh', 'throttle', 'brake', 'steer', 'gear', 'rpm', 'rpm_max',
  'acceleration_x', 'acceleration_y', 'acceleration_z', 'yaw_rate',
  ...QUAD_COLUMNS.flatMap(name => WHEELS.map(wheel => `${name}_${wheel}`)),
  'lap_time', 'lap_number', 'lap_distance', 'position_x', 'position_y', 'position_z'
]
const IDENTITY = { key: '3494:800:9000:2', ordinal: 3494, pi: 800, drivetrain: 2, rpmMax: 9000 }

// The Driver Analysis tables as FDC creates them, reduced to the columns the export reads.
function createDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE driver_analysis_recordings (id INTEGER PRIMARY KEY, started_at_ms INTEGER NOT NULL);
    CREATE TABLE driver_analysis_sessions (
      id INTEGER PRIMARY KEY, recording_id INTEGER, started_at_ms INTEGER NOT NULL, finished_at_ms INTEGER,
      status TEXT NOT NULL, result TEXT, main_kind TEXT, label TEXT NOT NULL DEFAULT '', instruction TEXT NOT NULL DEFAULT '',
      sample_count INTEGER NOT NULL DEFAULT 0, maneuver_count INTEGER NOT NULL DEFAULT 0,
      opportunity_count INTEGER NOT NULL DEFAULT 0, evidence_count INTEGER NOT NULL DEFAULT 0,
      detector_confidence REAL, attribution_confidence REAL, severity REAL, storage_bytes INTEGER NOT NULL DEFAULT 0,
      algorithm_version TEXT NOT NULL, vehicle_identity TEXT NOT NULL, vehicle_ordinal INTEGER, vehicle_pi INTEGER,
      vehicle_drivetrain INTEGER, vehicle_rpm_limit REAL, stats_json TEXT, drives_recorded INTEGER NOT NULL DEFAULT 0,
      app_version TEXT
    );
    CREATE TABLE driver_analysis_samples (
      id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL,
      ${SAMPLE_COLUMNS.map(name => `${name} ${/^(sequence|timestamp_ms|gear|lap_number|rumble_)/.test(name) ? 'INTEGER' : 'REAL'}`).join(', ')}
    );
    CREATE TABLE driver_analysis_drives (
      id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, drive_index INTEGER NOT NULL, kind TEXT NOT NULL,
      finished INTEGER NOT NULL, lap_count INTEGER, first_sequence INTEGER NOT NULL, last_sequence INTEGER NOT NULL,
      started_at_ms INTEGER NOT NULL, finished_at_ms INTEGER NOT NULL, started_wall_ms INTEGER NOT NULL, distance_m REAL NOT NULL
    );
    CREATE TABLE driver_analysis_opportunities (
      id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL, maneuver_id TEXT NOT NULL, opportunity_type TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL, finished_at_ms INTEGER NOT NULL, speed_bin INTEGER, gear INTEGER,
      outcome TEXT NOT NULL, valid INTEGER NOT NULL, invalid_reason TEXT, context_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE driver_analysis_evidence (
      id INTEGER PRIMARY KEY, opportunity_id INTEGER NOT NULL, problem_type TEXT NOT NULL, is_primary INTEGER NOT NULL,
      detector_confidence REAL NOT NULL, attribution_confidence REAL NOT NULL, severity REAL NOT NULL,
      metrics_json TEXT NOT NULL DEFAULT '{}'
    );
  `)
  return db
}

// Laps of braking, turning with front slip and lateral loss, and exits with wheelspin, sampled every 16 ms.
function drive(laps = 6) {
  const samples = []
  let time = 100000
  let distance = 0
  for (let lap = 0; lap < laps; lap += 1) {
    for (let step = 0; step < 220; step += 1) {
      const phase = step < 60 ? 'straight' : step < 90 ? 'brake' : step < 150 ? 'turn' : 'exit'
      const turn = phase === 'turn' ? Math.min(1, (step - 90) / 20) : 0
      const speed = phase === 'straight' ? 160 : phase === 'brake' ? 160 - (step - 60) * 2.5 : phase === 'turn' ? 85 : 85 + (step - 150) * 0.6
      const frontSlip = phase === 'turn' ? 0.6 + turn * (lap % 2 === 0 ? 0.9 : 0.3) : 0.1
      const drivenSlip = phase === 'exit' && step < 175 ? (lap % 3 === 0 ? 1.6 : 0.2) : 0.05
      distance += speed / 3.6 * 0.016
      samples.push({
        sequence: samples.length,
        timestampMs: time,
        speedKmh: speed,
        throttle: phase === 'straight' ? 1 : phase === 'exit' ? Math.min(1, (step - 150) / 10) : phase === 'turn' ? 0.2 : 0,
        brake: phase === 'brake' ? 0.9 : 0,
        steer: (lap % 2 === 0 ? 1 : -1) * (phase === 'turn' ? 0.2 + turn * 0.6 : phase === 'exit' ? 0.2 : 0),
        gear: phase === 'straight' ? 5 : 3,
        rpm: 6000,
        rpmMax: 9000,
        accelerationX: phase === 'turn' ? 9 - turn * (lap % 2 === 0 ? 2 : 0) : 0,
        accelerationY: 0,
        accelerationZ: phase === 'brake' ? -8 : phase === 'exit' ? 2 : 0,
        yawRate: phase === 'turn' ? 0.5 - turn * (lap % 2 === 0 ? 0.2 : 0) : 0,
        slipRatio: [drivenSlip, drivenSlip, drivenSlip, drivenSlip],
        slipAngle: [frontSlip, frontSlip, 0.2, 0.2],
        combinedSlip: [frontSlip, frontSlip, drivenSlip, drivenSlip],
        tireTempC: [80, 80, 82, 82],
        suspension: [0.5, 0.5, 0.5, 0.5],
        rumble: [false, false, false, false],
        puddle: [0, 0, 0, 0],
        lapTime: (time - 100000) / 1000,
        lapNumber: lap,
        lapDistance: distance,
        position: lap === 0 ? null : [distance, 0, lap]
      })
      time += 16
    }
  }
  return samples
}

// Saves one car the way FDC does: the live engine sees the samples, and the persistence payload is stored.
function saveCar(db, recordingId, startedAtMs, samples) {
  const engine = engineApi.createDriverAnalysisEngine()
  for (const sample of samples) engine.update(analysis.replayTelemetry(sample, IDENTITY))
  const payload = analysis.persistencePayload(engine.finalize(), false)
  const { result } = payload
  const sessionId = db.prepare(`
    INSERT INTO driver_analysis_sessions (recording_id, started_at_ms, finished_at_ms, status, result, main_kind, label, instruction,
      sample_count, opportunity_count, evidence_count, detector_confidence, attribution_confidence, severity,
      algorithm_version, vehicle_identity, vehicle_ordinal, vehicle_pi, vehicle_drivetrain, vehicle_rpm_limit, stats_json, app_version)
    VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '7.22.59')`).run(
    recordingId, startedAtMs, startedAtMs + 60000, result.result, result.mainKind, result.label, result.instruction,
    samples.length, payload.opportunities.length, payload.evidence.length, result.detectorConfidence, result.attributionConfidence,
    result.severity, engine.snapshot().algorithmVersion, JSON.stringify(IDENTITY), 3494, 800, 2, 9000, result.statsJson
  ).lastInsertRowid
  const insertSample = db.prepare(`INSERT INTO driver_analysis_samples (session_id, ${SAMPLE_COLUMNS.join(', ')}) VALUES (${['?', ...SAMPLE_COLUMNS.map(() => '?')].join(', ')})`)
  for (const sample of samples) {
    const quads = ['slipRatio', 'slipAngle', 'combinedSlip', 'tireTempC', 'suspension', 'rumble', 'puddle']
      .flatMap(key => sample[key].map(value => (typeof value === 'boolean' ? Number(value) : value)))
    insertSample.run(sessionId, sample.sequence, sample.timestampMs, sample.speedKmh, sample.throttle, sample.brake, sample.steer,
      sample.gear, sample.rpm, sample.rpmMax, sample.accelerationX, sample.accelerationY, sample.accelerationZ, sample.yawRate,
      ...quads, sample.lapTime, sample.lapNumber, sample.lapDistance, ...(sample.position ?? [null, null, null]))
  }
  const opportunityIds = payload.opportunities.map(item => db.prepare(`
    INSERT INTO driver_analysis_opportunities (session_id, maneuver_id, opportunity_type, started_at_ms, finished_at_ms, speed_bin, gear,
      outcome, valid, invalid_reason, context_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    sessionId, item.maneuverId, item.opportunityType, item.startedAtMs, item.finishedAtMs, item.speedBin, item.gear,
    item.outcome, item.valid ? 1 : 0, item.invalidReason, item.contextJson
  ).lastInsertRowid)
  for (const item of payload.evidence) {
    db.prepare(`INSERT INTO driver_analysis_evidence (opportunity_id, problem_type, is_primary, detector_confidence,
      attribution_confidence, severity, metrics_json) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      opportunityIds[item.opportunityIndex], item.problemType, item.primary ? 1 : 0, item.detectorConfidence,
      item.attributionConfidence, item.severity, item.metricsJson)
  }
  return { sessionId, payload }
}

function recordedDatabase() {
  const db = createDatabase()
  const recordingId = db.prepare('INSERT INTO driver_analysis_recordings (started_at_ms) VALUES (?)').run(1_759_000_000_000).lastInsertRowid
  const first = saveCar(db, recordingId, 1_759_000_000_000, drive())
  const second = saveCar(db, recordingId, 1_759_000_100_000, drive(3))
  return { db, recordingId: Number(recordingId), first, second }
}

test('a recording saved by the live analysis replays without differences', () => {
  const { db, recordingId, first } = recordedDatabase()
  assert.ok(first.payload.opportunities.length > 0, 'the synthetic drive must produce checks')
  assert.ok(first.payload.evidence.length > 0, 'the synthetic drive must produce evidence')

  const results = replayExport(exportFromDatabase(db, recordingId, '7.22.59'))

  assert.equal(results.length, 2)
  for (const result of results) assert.equal(result.exact, true, JSON.stringify(result.sections))
})

test('evidence and statistics deviations are measured without failing the car', () => {
  const { db, recordingId } = recordedDatabase()
  const exported = exportFromDatabase(db, recordingId, null)
  const car = exported.recording.sessions[0]
  car.evidence[0].severity += 1e-15
  car.stats.distanceM += 10

  const [result] = replayExport(exported)

  assert.equal(result.match, true)
  assert.equal(result.exact, false)
  assert.equal(result.sections.evidence.count, 1)
  assert.equal(result.sections.stats.count, 1)
  assert.equal(result.sections.stats.maxAbsolute.toFixed(6), '10.000000')
})

test('an exported file reads back and replays like the database', () => {
  const { db, recordingId } = recordedDatabase()
  const exported = exportFromDatabase(db, recordingId, '7.22.59')
  const folder = mkdtempSync(join(tmpdir(), 'fdc-replay-'))
  try {
    const file = join(folder, 'fdc-driver-analysis-1.json.gz')
    writeFileSync(file, gzipSync(JSON.stringify(exported)))
    const data = readExportFile(file)
    assert.deepEqual(data, exported)
    assert.ok(replayExport(data).every(result => result.match))
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('the export follows format version 1 without database ids', () => {
  const { db, recordingId } = recordedDatabase()
  const exported = exportFromDatabase(db, recordingId, '7.22.59')
  const [car, second] = exported.recording.sessions

  assert.equal(exported.recording.startedAt, '2025-09-27T19:06:40.000Z')
  assert.equal(exported.recording.durationMs, 160000)
  assert.equal(second.startedOffsetMs, 100000)
  assert.deepEqual(car.recordedWith.fdcVersion, '7.22.59')
  assert.deepEqual(car.vehicle.identity, IDENTITY)
  assert.deepEqual(car.samples.columns, SAMPLE_COLUMNS)
  assert.equal(car.evidence.every(item => Number.isInteger(item.opportunityIndex)), true)
  assert.doesNotMatch(JSON.stringify(exported), /"(id|session_id|recording_id)"/)
})

test('a changed saved value is reported with its size', () => {
  const { db, recordingId } = recordedDatabase()
  const exported = exportFromDatabase(db, recordingId, null)
  const car = exported.recording.sessions[0]
  car.evidence[0].detectorConfidence += 1e-12
  car.opportunities[0].outcome = car.opportunities[0].outcome === 'clean' ? 'problem' : 'clean'

  const [result] = replayExport(exported)

  assert.equal(result.match, false)
  assert.equal(result.sections.evidence.count, 1)
  assert.ok(result.sections.evidence.maxAbsolute > 0 && result.sections.evidence.maxAbsolute < 1e-11)
  assert.equal(result.sections.opportunities.count, 1)
  assert.equal(result.sections.opportunities.examples[0].path, 'opportunities[0].outcome')
  assert.equal(result.sections.result.count, 0)
})

test('an interrupted car compares its analysis but not its result', () => {
  const { db, recordingId } = recordedDatabase()
  const car = exportFromDatabase(db, recordingId, null).recording.sessions[0]
  car.status = 'interrupted'
  car.result = 'interrupted'
  const replayed = { opportunities: [], evidence: car.evidence, result: { result: 'issue' }, stats: car.stats }

  const { sections } = compareSession(car, replayed)

  assert.equal(sections.result.count, 0)
  assert.ok(sections.opportunities.count > 0)
})

test('replay samples restore wheels, curb contact, and a missing position', () => {
  const samples = { columns: ['rumble_fl', 'rumble_fr', 'rumble_rl', 'rumble_rr', 'position_x', 'position_y', 'position_z', 'speed_kmh'], values: [[1], [0], [0], [1], [1], [null], [3], [120]] }

  const sample = replaySample(samples, 0)

  assert.deepEqual(sample.rumble, [true, false, false, true])
  assert.equal(sample.position, null)
  assert.equal(sample.speedKmh, 120)
})

test('other formats and versions are rejected', () => {
  assert.throws(() => validateExport({ format: 'other', formatVersion: 1, recording: { sessions: [] } }), /not an FDC Driver Analysis export/)
  assert.throws(() => validateExport({ format: 'fdc-driver-analysis-export', formatVersion: 2, recording: { sessions: [] } }), /unsupported export format version 2/)
  assert.doesNotThrow(() => validateExport({ format: 'fdc-driver-analysis-export', formatVersion: 1, recording: { sessions: [] } }))
})
