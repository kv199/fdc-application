// Replays saved Driver Analysis recordings through the current analysis and compares the result with what was saved.
// Reads an fdc.sqlite file read-only or a file saved with EXPORT, and writes nothing.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const require = createRequire(import.meta.url)
const analysis = require('../overlay/driver-analysis.js')
const engineApi = require('../overlay/driver-analysis-engine.js')

export const EXPORT_FORMAT = 'fdc-driver-analysis-export'
export const EXPORT_FORMAT_VERSION = 1

const WHEELS = ['fl', 'fr', 'rl', 'rr']
const QUADS = { slipRatio: 'slip_ratio', slipAngle: 'slip_angle', combinedSlip: 'combined_slip', tireTempC: 'tire_temp', suspension: 'suspension', rumble: 'rumble', puddle: 'puddle' }
const SCALARS = {
  sequence: 'sequence', timestampMs: 'timestamp_ms', speedKmh: 'speed_kmh', throttle: 'throttle', brake: 'brake', steer: 'steer',
  gear: 'gear', rpm: 'rpm', rpmMax: 'rpm_max', accelerationX: 'acceleration_x', accelerationY: 'acceleration_y',
  accelerationZ: 'acceleration_z', yawRate: 'yaw_rate', lapTime: 'lap_time', lapNumber: 'lap_number', lapDistance: 'lap_distance'
}

function parseJson(text, fallback) {
  if (typeof text !== 'string' || text === '') return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

const offset = (value, start) => (value === null || value === undefined ? null : value - start)

// Builds the export of one recording exactly as FDC writes it, so database and file input share one comparison.
export function exportFromDatabase(db, recordingId, fdcVersion = null) {
  const recording = db.prepare('SELECT id, started_at_ms FROM driver_analysis_recordings WHERE id = ?').get(recordingId)
  if (!recording) throw new Error(`recording ${recordingId} does not exist`)
  const sessions = db.prepare('SELECT * FROM driver_analysis_sessions WHERE recording_id = ? ORDER BY started_at_ms, id').all(recordingId)
  if (sessions.length === 0) throw new Error(`recording ${recordingId} has no cars`)
  const start = recording.started_at_ms
  const columns = db.prepare('PRAGMA table_info(driver_analysis_samples)').all()
    .map(column => column.name)
    .filter(name => name !== 'id' && name !== 'session_id')
  const finishes = sessions.map(session => session.finished_at_ms)

  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedWith: { fdcVersion },
    recording: {
      startedAt: new Date(start).toISOString(),
      durationMs: finishes.some(value => value === null) ? null : Math.max(...finishes) - start,
      sessions: sessions.map((session, index) => {
        const rows = db.prepare(`SELECT ${columns.join(', ')} FROM driver_analysis_samples WHERE session_id = ? ORDER BY sequence`).all(session.id)
        const opportunityRows = db.prepare('SELECT * FROM driver_analysis_opportunities WHERE session_id = ? ORDER BY id').all(session.id)
        const opportunityIndex = new Map(opportunityRows.map((row, position) => [row.id, position]))
        const evidenceRows = db.prepare(`
          SELECT evidence.* FROM driver_analysis_evidence evidence
            JOIN driver_analysis_opportunities opportunity ON opportunity.id = evidence.opportunity_id
           WHERE opportunity.session_id = ?
           ORDER BY opportunity.id, evidence.id`).all(session.id)
        const driveRows = db.prepare('SELECT * FROM driver_analysis_drives WHERE session_id = ? ORDER BY drive_index').all(session.id)
        return {
          index,
          startedOffsetMs: offset(session.started_at_ms, start),
          finishedOffsetMs: offset(session.finished_at_ms, start),
          recordedWith: { fdcVersion: session.app_version ?? null, algorithmVersion: session.algorithm_version },
          vehicle: {
            identity: parseJson(session.vehicle_identity, session.vehicle_identity),
            ordinal: session.vehicle_ordinal,
            pi: session.vehicle_pi,
            drivetrain: session.vehicle_drivetrain,
            rpmLimit: session.vehicle_rpm_limit
          },
          status: session.status,
          result: session.result,
          mainKind: session.main_kind,
          label: session.label,
          instruction: session.instruction,
          detectorConfidence: session.detector_confidence,
          attributionConfidence: session.attribution_confidence,
          severity: session.severity,
          counts: {
            samples: session.sample_count,
            maneuvers: session.maneuver_count,
            opportunities: session.opportunity_count,
            evidence: session.evidence_count,
            drives: session.drives_recorded ?? 0
          },
          storageBytes: session.storage_bytes,
          stats: parseJson(session.stats_json, null),
          samples: { columns, values: columns.map(column => rows.map(row => row[column])) },
          drives: driveRows.map(drive => ({
            index: drive.drive_index,
            kind: drive.kind,
            finished: drive.finished === 1,
            lapCount: drive.lap_count,
            firstSequence: drive.first_sequence,
            lastSequence: drive.last_sequence,
            startedAtMs: drive.started_at_ms,
            finishedAtMs: drive.finished_at_ms,
            startedOffsetMs: offset(drive.started_wall_ms, start),
            distanceM: drive.distance_m
          })),
          opportunities: opportunityRows.map((row, position) => ({
            index: position,
            maneuverId: row.maneuver_id,
            opportunityType: row.opportunity_type,
            startedAtMs: row.started_at_ms,
            finishedAtMs: row.finished_at_ms,
            speedBin: row.speed_bin,
            gear: row.gear,
            outcome: row.outcome,
            valid: row.valid === 1,
            invalidReason: row.invalid_reason,
            context: parseJson(row.context_json, {})
          })),
          evidence: evidenceRows.map(row => ({
            opportunityIndex: opportunityIndex.get(row.opportunity_id),
            problemType: row.problem_type,
            primary: row.is_primary === 1,
            detectorConfidence: row.detector_confidence,
            attributionConfidence: row.attribution_confidence,
            severity: row.severity,
            metrics: parseJson(row.metrics_json, {})
          }))
        }
      })
    }
  }
}

export function validateExport(data) {
  if (data?.format !== EXPORT_FORMAT) throw new Error('not an FDC Driver Analysis export')
  if (data.formatVersion !== EXPORT_FORMAT_VERSION) {
    throw new Error(`unsupported export format version ${data.formatVersion}; this tool reads version ${EXPORT_FORMAT_VERSION}`)
  }
  if (!Array.isArray(data.recording?.sessions)) throw new Error('export has no recording')
  return data
}

export function readExportFile(path) {
  return validateExport(JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')))
}

// One stored sample in the shape that FDC replays, as load_driver_analysis_samples returns it.
export function replaySample(samples, row) {
  const column = new Map(samples.columns.map((name, position) => [name, samples.values[position]]))
  const value = name => column.get(name)?.[row] ?? null
  const sample = {}
  for (const [key, name] of Object.entries(SCALARS)) sample[key] = value(name)
  for (const [key, name] of Object.entries(QUADS)) sample[key] = WHEELS.map(wheel => value(`${name}_${wheel}`))
  sample.rumble = sample.rumble.map(flag => flag === 1 || flag === true)
  const position = ['position_x', 'position_y', 'position_z'].map(value)
  sample.position = position.some(coordinate => coordinate === null) ? null : position
  return sample
}

// Runs the stored samples of one car through the current analysis, as FDC's own reanalysis does.
export function replaySession(session) {
  const engine = engineApi.createDriverAnalysisEngine()
  const count = session.samples.values[0]?.length ?? 0
  for (let row = 0; row < count; row += 1) {
    const telemetry = analysis.replayTelemetry(replaySample(session.samples, row), session.vehicle.identity)
    if (!telemetry) throw new Error(`sample ${row} cannot be replayed`)
    engine.update(telemetry)
  }
  const payload = analysis.persistencePayload(engine.finalize(), session.status === 'interrupted')
  return {
    algorithmVersion: engine.snapshot().algorithmVersion,
    opportunities: payload.opportunities.map(({ contextJson, ...opportunity }, index) => ({ index, ...opportunity, context: parseJson(contextJson, {}) })),
    evidence: payload.evidence.map(({ metricsJson, ...item }) => ({ ...item, metrics: parseJson(metricsJson, {}) })),
    result: {
      result: payload.result.result,
      mainKind: payload.result.mainKind,
      label: payload.result.label,
      instruction: payload.result.instruction,
      detectorConfidence: payload.result.detectorConfidence,
      attributionConfidence: payload.result.attributionConfidence,
      severity: payload.result.severity
    },
    stats: parseJson(payload.result.statsJson, null)
  }
}

// Walks both values and records every differing leaf; numbers must be identical, and the largest gap is kept.
function collectDifferences(saved, replayed, path, section) {
  if (typeof saved === 'number' && typeof replayed === 'number') {
    if (saved === replayed) return
    const absolute = Math.abs(saved - replayed)
    section.maxAbsolute = Math.max(section.maxAbsolute, absolute)
    section.maxRelative = Math.max(section.maxRelative, absolute / Math.max(Math.abs(saved), Number.EPSILON))
  } else if (saved && replayed && typeof saved === 'object' && typeof replayed === 'object') {
    for (const key of new Set([...Object.keys(saved), ...Object.keys(replayed)])) {
      collectDifferences(saved[key], replayed[key], Array.isArray(saved) ? `${path}[${key}]` : `${path}.${key}`, section)
    }
    return
  } else if (saved === replayed) {
    return
  }
  section.count += 1
  if (section.examples.length < 3) section.examples.push({ path, saved, replayed })
}

// Checks and the result must reproduce exactly. Evidence numbers and statistics may differ slightly, for example
// because telemetry interruptions that reset the live analysis are not stored, so they are measured instead.
export const EXACT_SECTIONS = ['opportunities', 'result']

export function compareSession(saved, replayed) {
  const savedResult = Object.fromEntries(Object.keys(replayed.result).map(key => [key, saved[key] ?? null]))
  // An interrupted car has no result to reproduce; the analysis behind it still has to match.
  const pairs = {
    opportunities: [saved.opportunities, replayed.opportunities],
    evidence: [saved.evidence, replayed.evidence],
    result: saved.status === 'interrupted' ? [null, null] : [savedResult, replayed.result],
    stats: [saved.stats, replayed.stats]
  }
  const sections = {}
  for (const [name, [left, right]] of Object.entries(pairs)) {
    const section = { count: 0, maxAbsolute: 0, maxRelative: 0, examples: [] }
    collectDifferences(left, right, name, section)
    sections[name] = section
  }
  return {
    match: EXACT_SECTIONS.every(name => sections[name].count === 0),
    exact: Object.values(sections).every(section => section.count === 0),
    sections
  }
}

export function replayExport(data, label = '') {
  const startMs = Date.parse(data.recording.startedAt)
  return data.recording.sessions.map(session => {
    const header = {
      recording: label,
      car: session.index + 1,
      cars: data.recording.sessions.length,
      startedAt: Number.isFinite(startMs) ? new Date(startMs + (session.startedOffsetMs ?? 0)).toISOString() : null,
      samples: session.samples.values[0]?.length ?? 0,
      status: session.status,
      algorithmVersion: session.recordedWith?.algorithmVersion ?? null
    }
    if (session.status === 'recording') return { ...header, skipped: 'still recording' }
    try {
      const replayed = replaySession(session)
      return { ...header, currentAlgorithmVersion: replayed.algorithmVersion, ...compareSession(session, replayed) }
    } catch (error) {
      return { ...header, error: error.message }
    }
  })
}

function formatGap(name, section) {
  const example = section.examples[0]
  const relative = section.maxRelative.toExponential(1)
  const label = EXACT_SECTIONS.includes(name) ? 'DIFF' : 'DEVIATION'
  return `${label} ${section.count} values, max relative ${relative}, e.g. ${example.path} saved ${JSON.stringify(example.saved)} replayed ${JSON.stringify(example.replayed)}`
}

export function formatReport(results) {
  const lines = []
  for (const item of results) {
    const where = [item.recording && `recording ${item.recording}`, `car ${item.car} of ${item.cars}`, item.startedAt, `${item.samples} samples`, item.status, item.algorithmVersion]
    lines.push(where.filter(Boolean).join(' · '))
    if (item.skipped) lines.push(`  skipped: ${item.skipped}`)
    else if (item.error) lines.push(`  ERROR ${item.error}`)
    else {
      if (item.algorithmVersion !== item.currentAlgorithmVersion) lines.push(`  recorded with ${item.algorithmVersion}, replayed with ${item.currentAlgorithmVersion}`)
      for (const [name, section] of Object.entries(item.sections)) {
        lines.push(`  ${name.padEnd(14)}${section.count === 0 ? 'MATCH' : formatGap(name, section)}`)
      }
    }
  }
  const replayed = results.filter(item => item.sections)
  const matching = replayed.filter(item => item.match).length
  const exact = replayed.filter(item => item.exact).length
  const failed = results.filter(item => item.error).length
  lines.push('', `${matching} of ${replayed.length} cars reproduce their checks and result, ${exact} exactly${failed ? `, ${failed} failed` : ''}`)
  return lines.join('\n')
}

function main() {
  const { values, positionals } = parseArgs({
    options: { db: { type: 'string' }, recording: { type: 'string' }, json: { type: 'boolean', default: false } },
    allowPositionals: true
  })
  let results
  if (positionals.length === 1 && !values.db) {
    results = replayExport(readExportFile(positionals[0]))
  } else if (values.db && positionals.length === 0) {
    const db = new DatabaseSync(values.db, { readOnly: true })
    try {
      const ids = values.recording
        ? [Number(values.recording)]
        : db.prepare('SELECT id FROM driver_analysis_recordings ORDER BY started_at_ms, id').all().map(row => row.id)
      results = ids.flatMap(id => replayExport(exportFromDatabase(db, id), String(id)))
    } finally {
      db.close()
    }
  } else {
    throw new Error('usage: replay-driver-analysis.mjs <export.json.gz> | --db <fdc.sqlite> [--recording <id>] [--json]')
  }
  console.log(values.json ? JSON.stringify(results, null, 2) : formatReport(results))
  return results.every(item => item.skipped || item.match) ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
