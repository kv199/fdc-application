(function (globalScope, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.EventTheoreticalBest = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict'

  // Theoretical Best sums the quickest Sector 1, 2 and 3. The Event page combines saved runs; a run page uses its own laps.
  const SECTOR_NUMBERS = [1, 2, 3]
  const ESTIMATE_NOTE = 'Sum of three virtual distance sectors; an estimate, not a recorded result.'
  const INCOMPLETE_NOTE = 'Complete all three sectors to calculate theoretical best.'
  const EVENT_DESCRIPTION = 'Best sectors across saved runs in this event.'
  const RUN_DESCRIPTION = 'Best sectors from laps in this run.'
  const SPRINT_RUN_DESCRIPTION = 'Sector times from this run.'
  const SOURCE_CONTEXT_PREFIX = 'FROM EVENT THEORETICAL BEST'

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function textOrNull(value) {
    if (typeof value !== 'string') return null
    const text = value.trim()
    return text || null
  }

  function idOrNull(value) {
    if (value === null || value === undefined || value === '') return null
    return String(value)
  }

  // Native payload: { eventId, totalMs, sectors: [{ sector, timeMs, runId, lapNumber, runType, carOrdinal, carName, hasTrace }] }.
  // The result always holds Sector 1, 2 and 3 in order; a missing entry becomes a sector without a time.
  function normalizeSectors(payload) {
    const entries = Array.isArray(payload?.sectors) ? payload.sectors : []
    return SECTOR_NUMBERS.map(sector => {
      const entry = entries.find(candidate => Number(candidate?.sector) === sector) || {}
      return {
        sector,
        timeMs: finiteOrNull(entry.timeMs),
        runId: idOrNull(entry.runId),
        lapNumber: finiteOrNull(entry.lapNumber),
        runType: textOrNull(entry.runType)?.toLowerCase() || null,
        carOrdinal: finiteOrNull(entry.carOrdinal),
        carName: textOrNull(entry.carName),
        hasTrace: entry.hasTrace === true
      }
    })
  }

  function allSectorsTimed(sectors) {
    return sectors.length > 0 && sectors.every(sector => Number.isFinite(sector.timeMs))
  }

  // The sum of the three sector times, or null while any sector has no eligible time.
  function totalMs(sectors) {
    if (!allSectorsTimed(sectors)) return null
    return sectors.reduce((sum, sector) => sum + sector.timeMs, 0)
  }

  function carKey(sector) {
    if (Number.isFinite(sector.carOrdinal)) return `ordinal:${Math.round(sector.carOrdinal)}`
    return sector.carName ? `name:${sector.carName}` : null
  }

  // The car identity shared by every sector, or null. Only a complete result can name one shared car.
  function sharedCarKey(sectors) {
    if (!allSectorsTimed(sectors)) return null
    const key = carKey(sectors[0])
    return key !== null && sectors.every(sector => carKey(sector) === key) ? key : null
  }

  // Distinct saved runs that supply a sector time.
  function distinctRunCount(sectors) {
    const runs = new Set(sectors.filter(sector => Number.isFinite(sector.timeMs) && sector.runId).map(sector => sector.runId))
    return runs.size
  }

  // Sector rows show seconds to milliseconds, for example 22.871.
  function formatSectorSeconds(timeMs) {
    return Number.isFinite(timeMs) ? (timeMs / 1000).toFixed(3) : '—'
  }

  // A Sprint is one pass, so its source names no lap.
  function sourceLabel({ runId, lapNumber, runType }) {
    const run = `RUN #${runId}`
    if (runType === 'sprint') return `${run} · SPRINT`
    return Number.isFinite(lapNumber) ? `${run} · LAP ${Math.round(lapNumber)}` : run
  }

  function openedStatus({ runId, lapNumber, sector, runType }) {
    const lap = runType !== 'sprint' && Number.isFinite(lapNumber) ? `, Lap ${Math.round(lapNumber)}` : ''
    return `Opened Run #${runId}${lap}, Sector ${sector}.`
  }

  // The context line names the sector only while that sector is focused on the map.
  function sourceContext({ runId, lapNumber, sector, runType }) {
    const parts = [`RUN #${runId}`]
    if (runType !== 'sprint' && Number.isFinite(lapNumber)) parts.push(`LAP ${Math.round(lapNumber)}`)
    if (Number.isFinite(sector)) parts.push(`SECTOR ${sector}`)
    return `${SOURCE_CONTEXT_PREFIX} · ${parts.join(' · ')}`
  }

  function runDescription(runType) {
    return runType === 'sprint' ? SPRINT_RUN_DESCRIPTION : RUN_DESCRIPTION
  }

  return {
    ESTIMATE_NOTE,
    INCOMPLETE_NOTE,
    EVENT_DESCRIPTION,
    normalizeSectors,
    totalMs,
    sharedCarKey,
    distinctRunCount,
    formatSectorSeconds,
    sourceLabel,
    openedStatus,
    sourceContext,
    runDescription
  }
}))
