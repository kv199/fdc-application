import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { loadSamples, loadSessions, samplesAt, summarizeSamples } from './slip-report.mjs'

function sample(timestampMs, { front = 0.2, rear = 0.2, angle = 0.1, speed = 120, lateral = 5 } = {}) {
  return {
    timestamp_ms: timestampMs,
    speed_kmh: speed,
    acceleration_x: lateral,
    slip_angle_fl: angle, slip_angle_fr: -angle, slip_angle_rl: angle, slip_angle_rr: angle,
    slip_ratio_fl: 0, slip_ratio_fr: 0, slip_ratio_rl: 0, slip_ratio_rr: 0,
    combined_slip_fl: front, combined_slip_fr: -front, combined_slip_rl: rear, combined_slip_rr: rear
  }
}

test('summarizeSamples measures time above 100% combined slip', () => {
  const rows = Array.from({ length: 11 }, (_, index) => sample(index * 16, index >= 3 && index <= 6 ? { front: 1.3, angle: 1.2 } : {}))
  // A duplicate timestamp inside the episode adds no time and does not split it.
  rows.splice(4, 0, sample(48, { front: 1.3, angle: 1.2 }))
  const summary = summarizeSamples(rows)

  assert.equal(summary.movingMs, 160)
  assert.equal(summary.shares.frontAxle, 0.4)
  assert.equal(summary.shares.rearAxle, 0)
  assert.equal(summary.shares.anyWheel, 0.4)
  assert.equal(summary.shares.anyWheelSlipAngle, 0.4)
  assert.deepEqual(summary.episodes, { count: 1, medianMs: 64, atLeast500Ms: 0, atLeast1000Ms: 0 })
  assert.equal(summary.frontAxle.max, 1.3)
})

test('summarizeSamples skips slow samples and telemetry gaps', () => {
  const rows = [
    sample(0, { front: 1.5 }),
    sample(16, { front: 1.5, speed: 10 }),
    sample(32, { front: 1.5 }),
    sample(1000, { front: 1.5 }),
    sample(1016, { front: 1.5 })
  ]
  const summary = summarizeSamples(rows)

  assert.equal(summary.movingMs, 32)
  assert.equal(summary.shares.frontAxle, 1)
  assert.equal(summary.episodes.count, 2)
})

test('samplesAt maps local clock seconds onto the recording', () => {
  const session = { started_at_ms: new Date(2026, 8, 26, 10, 24, 15).getTime() }
  const rows = Array.from({ length: 200 }, (_, index) => sample(5000 + index * 16, { front: index / 100 }))
  const [inside, outside] = samplesAt(session, rows, ['10:24:16', '10:24:30'])

  assert.equal(inside.samples, 62)
  assert.equal(inside.wheels.combined_slip.fl.max, 1.24)
  assert.equal(inside.wheels.combined_slip.fr.middle, 0.94)
  assert.equal(outside.samples, 0)
  assert.equal(outside.wheels.combined_slip.fl, null)
})

test('loadSessions and loadSamples read a Driver Analysis database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fdc-slip-report-'))
  const path = join(directory, 'fdc.sqlite')
  try {
    const db = new DatabaseSync(path)
    db.exec(`CREATE TABLE driver_analysis_sessions (id INTEGER PRIMARY KEY, started_at_ms INTEGER, stats_json TEXT);
             CREATE TABLE driver_analysis_samples (session_id INTEGER, sequence INTEGER, timestamp_ms INTEGER);`)
    db.prepare('INSERT INTO driver_analysis_sessions VALUES (?, ?, ?)').run(2, 2000, null)
    db.prepare('INSERT INTO driver_analysis_sessions VALUES (?, ?, ?)').run(1, 1000, null)
    for (const [sequence, timestampMs] of [[1, 16], [0, 0]]) {
      db.prepare('INSERT INTO driver_analysis_samples VALUES (?, ?, ?)').run(1, sequence, timestampMs)
    }

    assert.deepEqual(loadSessions(db).map(session => session.id), [1, 2])
    assert.deepEqual(loadSessions(db, 2).map(session => session.id), [2])
    assert.deepEqual(loadSamples(db, 1).map(row => row.timestamp_ms), [0, 16])
    db.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
