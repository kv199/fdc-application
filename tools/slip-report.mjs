// Tire slip report for saved Driver Analysis recordings in fdc.sqlite.
// Opens the database read-only. Slip values are shown as |value| * 100%, the
// scale of the in-game tire friction telemetry, where a tire turns red above 100%.
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const WHEELS = ['fl', 'fr', 'rl', 'rr']
const COLUMNS = ['slip_angle', 'slip_ratio', 'combined_slip']
const GRAVITY = 9.80665

export const DEFAULTS = Object.freeze({ movingKmh: 20, maxStepMs: 250, limit: 1 })

function axle(row, column, left, right) {
  return (Math.abs(row[`${column}_${left}`]) + Math.abs(row[`${column}_${right}`])) / 2
}

function maxWheel(row, column) {
  return Math.max(...WHEELS.map(wheel => Math.abs(row[`${column}_${wheel}`])))
}

function quantile(values, fraction) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}

function distribution(values) {
  return values.length === 0
    ? null
    : { p50: quantile(values, 0.5), p90: quantile(values, 0.9), p99: quantile(values, 0.99), max: Math.max(...values) }
}

export function loadSessions(db, sessionId = null) {
  const sessions = db.prepare('SELECT * FROM driver_analysis_sessions ORDER BY started_at_ms').all()
  return sessionId === null ? sessions : sessions.filter(session => session.id === sessionId)
}

export function loadSamples(db, sessionId) {
  return db.prepare('SELECT * FROM driver_analysis_samples WHERE session_id = ? ORDER BY sequence').all(sessionId)
}

// Samples come in pairs that share a timestamp; a zero step carries no time but keeps an episode open.
export function summarizeSamples(rows, options = {}) {
  const { movingKmh, maxStepMs, limit } = { ...DEFAULTS, ...options }
  const time = { moving: 0, frontAxle: 0, rearAxle: 0, anyWheel: 0, anyWheelSlipAngle: 0 }
  const episodes = []
  const front = []
  const rear = []
  const bins = new Map()
  let episodeStart = null
  const closeEpisode = endMs => {
    if (episodeStart !== null) episodes.push(endMs - episodeStart)
    episodeStart = null
  }

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index]
    const previous = rows[index - 1]
    const dt = row.timestamp_ms - previous.timestamp_ms
    if (dt < 0 || dt > maxStepMs || row.speed_kmh < movingKmh) {
      closeEpisode(previous.timestamp_ms)
      continue
    }
    const over = maxWheel(row, 'combined_slip') > limit
    if (over && episodeStart === null) episodeStart = row.timestamp_ms
    else if (!over) closeEpisode(row.timestamp_ms)
    if (dt === 0) continue

    const frontSlip = axle(row, 'combined_slip', 'fl', 'fr')
    const rearSlip = axle(row, 'combined_slip', 'rl', 'rr')
    time.moving += dt
    if (frontSlip > limit) time.frontAxle += dt
    if (rearSlip > limit) time.rearAxle += dt
    if (over) time.anyWheel += dt
    if (maxWheel(row, 'slip_angle') > limit) time.anyWheelSlipAngle += dt
    front.push(frontSlip)
    rear.push(rearSlip)
    const bin = Math.min(20, Math.floor(frontSlip * 10))
    if (!bins.has(bin)) bins.set(bin, [])
    bins.get(bin).push(Math.abs(row.acceleration_x) / GRAVITY)
  }
  closeEpisode(rows.at(-1)?.timestamp_ms ?? 0)

  const share = ms => time.moving > 0 ? ms / time.moving : null
  return {
    movingMs: time.moving,
    shares: {
      frontAxle: share(time.frontAxle),
      rearAxle: share(time.rearAxle),
      anyWheel: share(time.anyWheel),
      anyWheelSlipAngle: share(time.anyWheelSlipAngle)
    },
    episodes: {
      count: episodes.length,
      medianMs: quantile(episodes, 0.5),
      atLeast500Ms: episodes.filter(duration => duration >= 500).length,
      atLeast1000Ms: episodes.filter(duration => duration >= 1000).length
    },
    frontAxle: distribution(front),
    rearAxle: distribution(rear),
    lateralByFrontSlip: [...bins.keys()].sort((left, right) => left - right).map(bin => ({
      from: bin / 10,
      to: bin >= 20 ? null : (bin + 1) / 10,
      samples: bins.get(bin).length,
      medianG: quantile(bins.get(bin), 0.5),
      p90G: quantile(bins.get(bin), 0.9)
    }))
  }
}

// Maps local wall-clock times (HH:MM:SS) onto the recording: started_at_ms plus the telemetry time since the first sample.
// Each time covers one second, the resolution of an on-screen clock.
export function samplesAt(session, rows, times) {
  if (rows.length === 0) return []
  const firstMs = rows[0].timestamp_ms
  const wallMs = row => session.started_at_ms + (row.timestamp_ms - firstMs)
  const day = new Date(session.started_at_ms)
  return times.map(time => {
    const [hours, minutes, seconds] = time.split(':').map(Number)
    const startMs = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, seconds).getTime()
    const window = rows.filter(row => wallMs(row) >= startMs && wallMs(row) < startMs + 1000)
    const wheels = {}
    for (const column of COLUMNS) {
      wheels[column] = {}
      for (const wheel of WHEELS) {
        const values = window.map(row => Math.abs(row[`${column}_${wheel}`]))
        wheels[column][wheel] = values.length === 0
          ? null
          : { middle: values[Math.floor(values.length / 2)], max: Math.max(...values) }
      }
    }
    return { time, samples: window.length, speedKmh: window[0]?.speed_kmh ?? null, wheels }
  })
}

function storedCornerShares(session) {
  try {
    const corners = JSON.parse(session.stats_json || 'null')?.corners
    return { front: corners?.frontOverLimitShare ?? null, rear: corners?.rearOverLimitShare ?? null }
  } catch {
    return { front: null, rear: null }
  }
}

const percent = value => value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`
const fixed = value => value === null ? 'n/a' : value.toFixed(2)

function printSummary(session, summary) {
  const stored = storedCornerShares(session)
  console.log(`\nmoving time ${(summary.movingMs / 1000).toFixed(1)} s`)
  console.log(`stored CORNERS shares: front ${percent(stored.front)}, rear ${percent(stored.rear)} of cornering time`)
  console.log('above 100% combined slip, share of moving time:')
  console.log(`  front axle ${percent(summary.shares.frontAxle)} · rear axle ${percent(summary.shares.rearAxle)} · any wheel ${percent(summary.shares.anyWheel)} (slip angle alone ${percent(summary.shares.anyWheelSlipAngle)})`)
  const { episodes } = summary
  console.log(`  any wheel episodes ${episodes.count}, median ${episodes.medianMs ?? 'n/a'} ms, ${episodes.atLeast500Ms} of at least 0.5 s, ${episodes.atLeast1000Ms} of at least 1 s`)
  for (const [label, dist] of [['front axle', summary.frontAxle], ['rear axle', summary.rearAxle]]) {
    if (dist) console.log(`${label} combined slip: p50 ${fixed(dist.p50)} · p90 ${fixed(dist.p90)} · p99 ${fixed(dist.p99)} · max ${fixed(dist.max)}`)
  }
  console.log('lateral g by front axle combined slip:')
  console.log('  slip        samples  median g  p90 g')
  for (const bin of summary.lateralByFrontSlip) {
    const label = bin.to === null ? `>= ${bin.from.toFixed(1)}` : `${bin.from.toFixed(1)}-${bin.to.toFixed(1)}`
    console.log(`  ${label.padEnd(10)} ${String(bin.samples).padStart(8)}  ${fixed(bin.medianG).padStart(8)}  ${fixed(bin.p90G).padStart(5)}`)
  }
}

function printSamplesAt(results) {
  for (const result of results) {
    console.log(`\n${result.time}  ${result.samples} samples${result.speedKmh === null ? '' : `, ${Math.round(result.speedKmh)} km/h`}`)
    if (result.samples === 0) continue
    console.log(`  ${''.padEnd(10)}${WHEELS.map(wheel => wheel.toUpperCase().padStart(14)).join('')}`)
    for (const column of COLUMNS) {
      const cells = WHEELS.map(wheel => {
        const cell = result.wheels[column][wheel]
        return `${Math.round(cell.middle * 100)}% / ${Math.round(cell.max * 100)}%`.padStart(14)
      })
      console.log(`  ${column.replace('_slip', '').replace('slip_', '').padEnd(10)}${cells.join('')}`)
    }
  }
  console.log('\ncells: value in the middle of the second / maximum within the second')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      db: { type: 'string', default: join(process.env.APPDATA || '', 'FDC', 'fdc.sqlite') },
      session: { type: 'string' },
      at: { type: 'string' }
    }
  })
  const db = new DatabaseSync(values.db, { readOnly: true })
  const sessionId = values.session === undefined ? null : Number(values.session)
  const sessions = loadSessions(db, sessionId)
  if (sessions.length === 0) {
    console.log(`No Driver Analysis recordings in ${values.db}`)
  } else if (values.at) {
    const session = sessionId === null ? sessions.at(-1) : sessions[0]
    const rows = loadSamples(db, session.id)
    console.log(`recording ${session.id}: ${new Date(session.started_at_ms).toLocaleString()}, ${rows.length} samples`)
    printSamplesAt(samplesAt(session, rows, values.at.split(',').filter(Boolean)))
  } else {
    for (const session of sessions) {
      const rows = loadSamples(db, session.id)
      console.log(`\n${'='.repeat(72)}\nrecording ${session.id}: ${new Date(session.started_at_ms).toLocaleString()}, car ${session.vehicle_ordinal}, PI ${session.vehicle_pi}, drivetrain ${session.vehicle_drivetrain}, ${rows.length} samples`)
      printSummary(session, summarizeSamples(rows))
    }
  }
  db.close()
}
