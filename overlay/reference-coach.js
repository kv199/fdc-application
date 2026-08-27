(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.ReferenceCoach = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const CUE_PRIORITY = Object.freeze([
    'brake_late',
    'brake_early',
    'release_late',
    'apex_too_fast',
    'apex_too_slow',
    'throttle_late',
    'throttle_early',
    'good'
  ])

  const CUE_KINDS = Object.freeze(CUE_PRIORITY)
  const PHASES = Object.freeze(['between', 'approach', 'entry', 'apex', 'exit'])
  const DELTA_GREEN_MS = -30
  const DELTA_RED_MS = 30
  const DELTA_HYSTERESIS_MS = 10
  const LAP_DELTA_RANGE_MS = 1000
  const MPH_PER_KMH = 0.621371
  const PHASE_GUIDANCE = Object.freeze({
    between: Object.freeze({ action: 'NEXT CORNER', targetKey: null }),
    approach: Object.freeze({ action: 'BRAKE', targetKey: 'brakeStartDistanceM' }),
    entry: Object.freeze({ action: 'RELEASE BRAKE', targetKey: 'brakeReleaseDistanceM' }),
    apex: Object.freeze({ action: 'APEX', targetKey: null }),
    exit: Object.freeze({ action: 'THROTTLE', targetKey: 'throttlePickupDistanceM' })
  })

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function normalizeText(value) {
    const text = String(value || '').trim()
    return text.length > 0 ? text : ''
  }

  function isRaceRestart(previousTelemetry, telemetry) {
    const previousRaceTimeS = finite(previousTelemetry?.lap?.raceTime)
    const currentRaceTimeS = finite(telemetry?.lap?.raceTime)
    const previousLapNumber = finite(previousTelemetry?.lap?.number)
    const currentLapNumber = finite(telemetry?.lap?.number)
    const previousDistanceM = finite(previousTelemetry?.lap?.distance)
    const currentDistanceM = finite(telemetry?.lap?.distance)
    if (
      previousRaceTimeS === null
      || currentRaceTimeS === null
      || previousLapNumber === null
      || currentLapNumber === null
    ) return false

    const lapWentBack = currentLapNumber < previousLapNumber
    const clockWentBack = currentRaceTimeS + 5 < previousRaceTimeS
    const distanceWentBack = previousDistanceM !== null
      && currentDistanceM !== null
      && currentDistanceM + 100 < previousDistanceM
    return clockWentBack && (lapWentBack || distanceWentBack)
  }

  function normalizePhase(value) {
    const phase = normalizeText(value).toLowerCase()
    return PHASES.includes(phase) ? phase : null
  }

  function normalizeSeverity(value) {
    const severity = normalizeText(value).toLowerCase()
    return ['info', 'warning', 'error'].includes(severity) ? severity : 'warning'
  }

  function cueNeedsValue(kind) {
    return kind !== 'release_late' && kind !== 'good'
  }

  function normalizeCue(rawCue) {
    if (!rawCue || typeof rawCue !== 'object') return null

    const kind = normalizeText(rawCue.kind).toLowerCase()
    if (!CUE_KINDS.includes(kind)) return null

    const value = finite(rawCue.value)
    if (cueNeedsValue(kind) && value === null) return null

    return {
      kind,
      value,
      unit: normalizeText(rawCue.unit).toLowerCase(),
      severity: normalizeSeverity(rawCue.severity)
    }
  }

  function selectPrimaryCue(payload) {
    const rawCues = Array.isArray(payload?.cues)
      ? payload.cues
      : [payload?.cue]

    const cues = rawCues.map(normalizeCue).filter(Boolean)
    cues.sort((left, right) => CUE_PRIORITY.indexOf(left.kind) - CUE_PRIORITY.indexOf(right.kind))
    return cues[0] || null
  }

  function normalizeSummary(rawSummary) {
    if (!rawSummary || typeof rawSummary !== 'object') return null

    const deltaMs = finite(rawSummary.deltaMs)
    const apexSpeedDeltaKmh = finite(rawSummary.apexSpeedDeltaKmh)
    if (deltaMs === null && apexSpeedDeltaKmh === null) return null

    return { deltaMs, apexSpeedDeltaKmh }
  }

  function normalizePedalTargets(rawTargets) {
    if (!rawTargets || typeof rawTargets !== 'object') return null

    return {
      brakeStartDistanceM: finite(rawTargets.brakeStartDistanceM),
      brakeReleaseDistanceM: finite(rawTargets.brakeReleaseDistanceM),
      throttlePickupDistanceM: finite(rawTargets.throttlePickupDistanceM)
    }
  }

  function classifyDelta(deltaMs, previousState = 'neutral') {
    const delta = finite(deltaMs)
    if (delta === null) return 'neutral'

    if (previousState === 'green' && delta <= DELTA_GREEN_MS + DELTA_HYSTERESIS_MS) return 'green'
    if (previousState === 'red' && delta >= DELTA_RED_MS - DELTA_HYSTERESIS_MS) return 'red'
    if (delta <= DELTA_GREEN_MS) return 'green'
    if (delta >= DELTA_RED_MS) return 'red'
    return 'amber'
  }

  function normalizeReferencePayload(payload) {
    const rawPayload = payload && typeof payload === 'object' ? payload : {}
    const available = rawPayload.available === true

    return {
      available,
      corner: normalizeText(rawPayload.corner),
      phase: normalizePhase(rawPayload.phase),
      cue: available ? selectPrimaryCue(rawPayload) : null,
      summary: normalizeSummary(rawPayload.summary),
      deltaMs: available ? finite(rawPayload.deltaMs) : null,
      deltaScope: normalizeText(rawPayload.deltaScope).toLowerCase() || null,
      lapDeltaMs: available ? finite(rawPayload.lapDeltaMs) : null,
      targets: available ? normalizePedalTargets(rawPayload.targets) : null,
      observed: available ? normalizePedalTargets(rawPayload.observed) : null
    }
  }

  function normalizeLapCompletePayload(payload) {
    const rawPayload = payload && typeof payload === 'object' ? payload : {}
    const lapNumber = finite(rawPayload.lapNumber)
    const lapTimeMs = finite(rawPayload.lapTimeMs)
    if (lapNumber === null || lapTimeMs === null || lapTimeMs <= 0) return null

    const timeSource = ['forza_lap_last', 'forza_lap_current', 'udp_active_fallback'].includes(rawPayload.timeSource)
      ? rawPayload.timeSource
      : null

    return {
      sessionId: finite(rawPayload.sessionId),
      eventId: finite(rawPayload.eventId),
      lapNumber: Math.trunc(lapNumber),
      lapTimeMs,
      referenceTimeMs: finite(rawPayload.referenceTimeMs),
      deltaMs: finite(rawPayload.deltaMs),
      sourceSessionId: finite(rawPayload.sourceSessionId),
      timeSource
    }
  }

  function createEmptyReference() {
    return {
      available: false,
      corner: '',
      phase: null,
      cue: null,
      summary: null,
      deltaMs: null,
      deltaScope: null,
      lapDeltaMs: null,
      targets: null,
      observed: null
    }
  }

  function formatMagnitude(value) {
    const number = finite(value)
    if (number === null) return ''
    return String(Math.max(0, Math.round(Math.abs(number))))
  }

  function normalizeSpeedUnit(value) {
    return value === 'mph' ? 'mph' : 'kmh'
  }

  function formatSpeedMagnitudeKmh(value, speedUnit = 'kmh') {
    const number = finite(value)
    if (number === null) return ''
    const unit = normalizeSpeedUnit(speedUnit)
    const converted = unit === 'mph' ? number * MPH_PER_KMH : number
    return String(Math.max(0, Math.round(Math.abs(converted))))
  }

  function speedUnitLabel(speedUnit = 'kmh') {
    return normalizeSpeedUnit(speedUnit) === 'mph' ? 'mph' : 'km/h'
  }

  function formatCue(cue, speedUnit = 'kmh') {
    const normalizedCue = normalizeCue(cue)
    if (!normalizedCue) return ''

    const magnitude = formatMagnitude(normalizedCue.value)
    if (normalizedCue.kind === 'brake_late') return `BRAKE ${magnitude} m EARLIER`
    if (normalizedCue.kind === 'brake_early') return `BRAKE ${magnitude} m LATER`
    if (normalizedCue.kind === 'release_late') return 'RELEASE EARLIER'
    if (normalizedCue.kind === 'apex_too_fast') {
      return `APEX +${formatSpeedMagnitudeKmh(normalizedCue.value, speedUnit)} ${speedUnitLabel(speedUnit)}`
    }
    if (normalizedCue.kind === 'apex_too_slow') {
      return `APEX -${formatSpeedMagnitudeKmh(normalizedCue.value, speedUnit)} ${speedUnitLabel(speedUnit)}`
    }
    if (normalizedCue.kind === 'throttle_late') return `THROTTLE ${magnitude} m EARLIER`
    if (normalizedCue.kind === 'throttle_early') return `THROTTLE ${magnitude} m LATER`
    if (normalizedCue.kind === 'good') return 'GOOD EXIT'
    return ''
  }

  function cueHasMagnitude(cue) {
    const normalizedCue = normalizeCue(cue)
    return normalizedCue !== null && normalizedCue.value !== null
  }

  function hasLiveCoachGuidance(reference, isSummary = false) {
    const normalized = normalizeReferencePayload(reference)
    return !isSummary && normalized.available && normalized.corner !== ''
  }

  function formatDeltaSeconds(deltaMs) {
    const milliseconds = finite(deltaMs)
    if (milliseconds === null) return ''

    const seconds = milliseconds / 1000
    const sign = seconds > 0 ? '+' : ''
    return `${sign}${seconds.toFixed(2)} s`
  }

  function formatSignedMilliseconds(value) {
    const milliseconds = finite(value)
    if (milliseconds === null) return ''

    const rounded = Math.round(milliseconds)
    if (rounded === 0) return '0 ms'
    const sign = rounded > 0 ? '+' : '-'
    return `${sign}${Math.abs(rounded)} ms`
  }

  function formatLapDelta(value) {
    const milliseconds = finite(value)
    if (milliseconds === null) return ''

    const seconds = Math.abs(milliseconds) / 1000
    if (milliseconds === 0) return '0.00 s'
    return `${milliseconds > 0 ? '+' : '-'}${seconds.toFixed(2)} s`
  }

  function formatLapTime(secondsValue) {
    const seconds = finite(secondsValue)
    if (seconds === null || seconds < 0) return '--:--.---'

    const minutes = Math.floor(seconds / 60)
    const remainder = (seconds - minutes * 60).toFixed(3).padStart(6, '0')
    return `${minutes}:${remainder}`
  }

  function formatPhaseAction(phase) {
    return PHASE_GUIDANCE[normalizePhase(phase)]?.action || ''
  }

  function formatCoachStatus(reference, isSummary = false, speedUnit = 'kmh') {
    if (isSummary) return 'LAP COMPLETE'

    const normalized = normalizeReferencePayload(reference)
    if (!normalized.available) return ''

    const cueText = formatCue(normalized.cue, speedUnit)
    if (cueText) return cueText
    if (normalized.phase === 'between' && !normalized.corner) return 'TO FINISH'
    return formatPhaseAction(normalized.phase)
  }

  function createLapDeltaView(deltaMs, previousState = 'neutral') {
    const delta = finite(deltaMs)
    const state = classifyDelta(delta, previousState)
    const positionPercent = delta === null
      ? 50
      : 50 - (Math.max(-LAP_DELTA_RANGE_MS, Math.min(LAP_DELTA_RANGE_MS, delta)) / LAP_DELTA_RANGE_MS) * 50

    return {
      state,
      text: formatLapDelta(delta),
      positionPercent: Number(positionPercent.toFixed(2))
    }
  }

  function formatSummary(summary, corner = '', speedUnit = 'kmh') {
    const normalizedSummary = normalizeSummary(summary)
    if (!normalizedSummary) return ''

    const cornerLabel = normalizeText(corner)
    const label = cornerLabel ? cornerLabel.split(/\s+/)[0] : 'CORNER'
    const delta = formatDeltaSeconds(normalizedSummary.deltaMs)
    if (delta) return `${label} ${delta}`

    const apexDelta = finite(normalizedSummary.apexSpeedDeltaKmh)
    if (apexDelta !== null) {
      const sign = apexDelta > 0 ? '+' : ''
      const magnitude = formatSpeedMagnitudeKmh(apexDelta, speedUnit)
      const signedMagnitude = Number(magnitude) === 0
        ? '0'
        : apexDelta < 0
          ? `-${magnitude}`
          : `${sign}${magnitude}`
      return `${label} APEX ${signedMagnitude} ${speedUnitLabel(speedUnit)}`
    }

    return ''
  }

  function formatCornerReadout(reference) {
    const normalized = normalizeReferencePayload(reference)
    if (!normalized.available || !normalized.corner) {
      return { visible: false, identity: '', phase: '', phaseClass: 'inactive' }
    }

    return {
      visible: true,
      identity: normalized.corner,
      phase: normalized.phase ? normalized.phase.toUpperCase() : '',
      phaseClass: normalized.phase || 'reference'
    }
  }

  function createDemoReference(name) {
    const base = {
      available: true,
      corner: 'T3 LEFT',
      lapDeltaMs: 138,
      targets: {
        brakeStartDistanceM: 560,
        brakeReleaseDistanceM: 690,
        throttlePickupDistanceM: 835
      },
      observed: {
        brakeStartDistanceM: 578,
        brakeReleaseDistanceM: null,
        throttlePickupDistanceM: null
      }
    }
    if (name === 'brake-late') return normalizeReferencePayload({
      ...base,
      deltaMs: 42,
      phase: 'approach',
      cue: { kind: 'brake_late', value: 12, unit: 'm', severity: 'warning' }
    })
    if (name === 'release') return normalizeReferencePayload({
      ...base,
      deltaMs: 65,
      phase: 'entry',
      cue: { kind: 'release_late', severity: 'warning' }
    })
    if (name === 'apex-slow') return normalizeReferencePayload({
      ...base,
      deltaMs: 80,
      phase: 'apex',
      cue: { kind: 'apex_too_fast', value: 4, unit: 'km/h', severity: 'warning' }
    })
    if (name === 'throttle-late') return normalizeReferencePayload({
      ...base,
      deltaMs: 55,
      phase: 'exit',
      cue: { kind: 'throttle_late', value: 8, unit: 'm', severity: 'warning' }
    })
    if (name === 'good') return normalizeReferencePayload({
      ...base,
      deltaMs: -38,
      lapDeltaMs: -120,
      phase: 'exit',
      cue: { kind: 'good', severity: 'info' }
    })
    if (name === 'summary') return normalizeReferencePayload({
      ...base,
      deltaMs: 180,
      lapDeltaMs: 420,
      phase: 'exit',
      summary: { deltaMs: 180, apexSpeedDeltaKmh: -4 }
    })
    return createEmptyReference()
  }

  return {
    CUE_KINDS,
    CUE_PRIORITY,
    DELTA_GREEN_MS,
    DELTA_HYSTERESIS_MS,
    DELTA_RED_MS,
    LAP_DELTA_RANGE_MS,
    PHASES,
    classifyDelta,
    createDemoReference,
    createEmptyReference,
    createLapDeltaView,
    cueHasMagnitude,
    formatCornerReadout,
    formatCoachStatus,
    formatCue,
    formatLapDelta,
    formatLapTime,
    formatPhaseAction,
    formatSummary,
    formatSignedMilliseconds,
    hasLiveCoachGuidance,
    isRaceRestart,
    normalizeCue,
    normalizeLapCompletePayload,
    normalizePhase,
    normalizeReferencePayload,
    normalizeSummary,
    selectPrimaryCue
  }
}))
