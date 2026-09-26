(function (globalScope, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysisHistory = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict'

  const DRIVETRAINS = ['FWD', 'RWD', 'AWD']

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  // Recordings newest first by their first session; the sessions (one per car stint) oldest first.
  function groupRecordings(sessions) {
    if (!Array.isArray(sessions)) return []
    const groups = new Map()
    for (const session of sessions) {
      if (!session || typeof session !== 'object') continue
      // Sessions without a recording (never expected after migration) stay on their own card.
      const key = finite(session.recordingId) !== null ? `recording:${session.recordingId}` : `session:${session.id}`
      if (!groups.has(key)) groups.set(key, { recordingId: session.recordingId ?? null, sessions: [] })
      groups.get(key).sessions.push(session)
    }
    const startOf = session => finite(session.recordedAt) ?? 0
    const recordings = [...groups.values()]
    for (const recording of recordings) recording.sessions.sort((left, right) => startOf(left) - startOf(right))
    return recordings.sort((left, right) => startOf(right.sessions[0]) - startOf(left.sessions[0]))
  }

  function carLabel(session) {
    const name = typeof session?.vehicleName === 'string' ? session.vehicleName.trim() : ''
    if (name) return name
    const ordinal = finite(session?.vehicleIdentity?.ordinal)
    return ordinal !== null ? `CAR #${Math.trunc(ordinal)}` : 'UNKNOWN CAR'
  }

  function drivetrainLabel(value) {
    const index = finite(value)
    return index !== null ? DRIVETRAINS[Math.trunc(index)] || '' : ''
  }

  function driveTypeLabel(drive) {
    const laps = finite(drive?.lapCount)
    const base = drive?.kind === 'circuit'
      ? `CIRCUIT · ${laps === 1 ? '1 LAP' : `${laps ?? 0} LAPS`}`
      : 'SPRINT'
    return drive?.finished === false ? `${base} · UNFINISHED` : base
  }

  function formatDriveDuration(ms) {
    const seconds = Math.max(0, Math.round((finite(ms) ?? 0) / 1000))
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  }

  function driveErrorCount(drive) {
    const counts = drive?.problemCounts && typeof drive.problemCounts === 'object' ? Object.values(drive.problemCounts) : []
    return counts.reduce((sum, count) => sum + Math.max(0, finite(count) ?? 0), 0)
  }

  // Wall-clock span from the first session start to the last session finish, or null while any session records.
  function recordingDurationMs(sessions) {
    if (!Array.isArray(sessions) || sessions.length === 0) return null
    if (sessions.some(session => session?.status === 'recording')) return null
    const starts = sessions.map(session => finite(session?.startedAt)).filter(value => value !== null)
    const finishes = sessions.map(session => finite(session?.finishedAt)).filter(value => value !== null)
    if (starts.length === 0 || finishes.length === 0) return null
    return Math.max(0, Math.max(...finishes) - Math.min(...starts))
  }

  // Same wording as DriverAnalysisStats.formatSummaryLine, aggregated over every car of the recording.
  function recordingSummary(sessions) {
    if (!Array.isArray(sessions)) return ''
    let distanceM = 0
    let movingMs = 0
    let topSpeedKmh = null
    let corners = 0
    for (const session of sessions) {
      const stats = session?.stats
      if (!stats || typeof stats !== 'object') continue
      distanceM += Math.max(0, finite(stats.distanceM) ?? 0)
      movingMs += Math.max(0, finite(stats.movingMs) ?? 0)
      const top = finite(stats.maxSpeedKmh)
      if (top !== null) topSpeedKmh = Math.max(topSpeedKmh ?? 0, top)
      corners += Math.max(0, finite(stats.corners?.count) ?? 0)
    }
    const parts = []
    if (distanceM > 0) parts.push(`${(distanceM / 1000).toFixed(1)} km`)
    if (distanceM > 0 && movingMs > 0) parts.push(`average ${Math.round(distanceM / (movingMs / 1000) * 3.6)} km/h`)
    if (topSpeedKmh !== null) parts.push(`top ${Math.round(topSpeedKmh)} km/h`)
    if (corners >= 3) parts.push(`${corners} corners`)
    return parts.join(' · ')
  }

  return {
    carLabel,
    driveErrorCount,
    driveTypeLabel,
    drivetrainLabel,
    formatDriveDuration,
    groupRecordings,
    recordingDurationMs,
    recordingSummary
  }
}))
