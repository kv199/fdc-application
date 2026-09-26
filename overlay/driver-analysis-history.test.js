const test = require('node:test')
const assert = require('node:assert/strict')
const history = require('./driver-analysis-history.js')

const session = (id, recordingId, recordedAt, extra = {}) => ({
  id, recordingId, recordedAt, startedAt: recordedAt, finishedAt: recordedAt + 60000, status: 'completed', ...extra
})

test('groupRecordings orders recordings newest first and their cars oldest first', () => {
  const recordings = history.groupRecordings([
    session(4, 2, 5000),
    session(1, 1, 1000),
    session(3, 2, 3000),
    session(2, 1, 2000)
  ])

  assert.deepEqual(recordings.map(recording => recording.recordingId), [2, 1])
  assert.deepEqual(recordings[0].sessions.map(item => item.id), [3, 4])
  assert.deepEqual(recordings[1].sessions.map(item => item.id), [1, 2])
})

test('groupRecordings keeps a session without a recording on its own card', () => {
  const recordings = history.groupRecordings([session(7, null, 1000), session(8, 7, 2000)])
  assert.equal(recordings.length, 2)
  assert.deepEqual(recordings.map(recording => recording.sessions[0].id), [8, 7])
})

test('car and drivetrain labels', () => {
  assert.equal(history.carLabel({ vehicleName: ' BMW M1 ', vehicleIdentity: { ordinal: 42 } }), 'BMW M1')
  assert.equal(history.carLabel({ vehicleName: null, vehicleIdentity: { ordinal: 42 } }), 'CAR #42')
  assert.equal(history.carLabel({}), 'UNKNOWN CAR')
  assert.deepEqual([0, 1, 2, 9, null].map(history.drivetrainLabel), ['FWD', 'RWD', 'AWD', '', ''])
})

test('drive type labels', () => {
  assert.equal(history.driveTypeLabel({ kind: 'circuit', lapCount: 3, finished: true }), 'CIRCUIT · 3 LAPS')
  assert.equal(history.driveTypeLabel({ kind: 'circuit', lapCount: 1, finished: true }), 'CIRCUIT · 1 LAP')
  assert.equal(history.driveTypeLabel({ kind: 'circuit', lapCount: 2, finished: false }), 'CIRCUIT · 2 LAPS · UNFINISHED')
  assert.equal(history.driveTypeLabel({ kind: 'sprint', lapCount: null, finished: true }), 'SPRINT')
  assert.equal(history.driveTypeLabel({ kind: 'sprint', lapCount: null, finished: false }), 'SPRINT · UNFINISHED')
})

test('drive duration and error count', () => {
  assert.equal(history.formatDriveDuration(372400), '06:12')
  assert.equal(history.formatDriveDuration(null), '00:00')
  assert.equal(history.driveErrorCount({ problemCounts: { front_scrub: 3, exit_wheelspin: 1 } }), 4)
  assert.equal(history.driveErrorCount({}), 0)
})

test('recording duration spans the first start to the last finish', () => {
  assert.equal(history.recordingDurationMs([
    session(1, 1, 1000, { finishedAt: 61000 }),
    session(2, 1, 70000, { finishedAt: 130000 })
  ]), 129000)
  assert.equal(history.recordingDurationMs([session(1, 1, 1000, { status: 'recording', finishedAt: null })]), null)
})

test('recording summary aggregates every car', () => {
  const summary = history.recordingSummary([
    { stats: { distanceM: 1000, movingMs: 30000, maxSpeedKmh: 180.4, corners: { count: 2 } } },
    { stats: { distanceM: 1000, movingMs: 30000, maxSpeedKmh: 230.6, corners: { count: 2 } } },
    { stats: null }
  ])
  assert.equal(summary, '2.0 km · average 120 km/h · top 231 km/h · 4 corners')
  assert.equal(history.recordingSummary([{ stats: null }]), '')
})
