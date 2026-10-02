(function (globalScope, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysisHistory = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict'

  const FdcUnits = globalThis.FdcUnits || require('./units.js')
  const FdcVehicle = globalThis.FdcVehicle || require('./vehicle.js')

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
    return FdcVehicle.displayName(session?.vehicleName, session?.vehicleIdentity?.ordinal)
  }

  function drivetrainLabel(value) {
    return FdcVehicle.drivetrainLabel(value) || ''
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

  // The overview line of a single-car recording card: distance, average and top speed, and corners.
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
    if (distanceM > 0) parts.push(FdcUnits.formatDistance(distanceM))
    if (distanceM > 0 && movingMs > 0) {
      const avgKmh = distanceM / (movingMs / 1000) * 3.6
      parts.push(`average ${FdcUnits.formatSpeed(avgKmh)}`)
    }
    if (topSpeedKmh !== null) parts.push(`top ${FdcUnits.formatSpeed(topSpeedKmh)}`)
    if (corners >= 3) parts.push(`${corners} corners`)
    return parts.join(' · ')
  }

  // The suggested export file name carries the local start time of the recording, or the current time without one.
  function exportFileName(recordedAt, now = Date.now()) {
    const start = new Date(finite(recordedAt) ?? now)
    const pad = value => String(value).padStart(2, '0')
    const day = `${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}`
    return `fdc-driver-analysis-${day}-${pad(start.getHours())}${pad(start.getMinutes())}.json.gz`
  }

  return {
    carLabel,
    driveErrorCount,
    driveTypeLabel,
    drivetrainLabel,
    exportFileName,
    formatDriveDuration,
    groupRecordings,
    recordingDurationMs,
    recordingSummary
  }
}))
