(function (globalScope) {
  'use strict'

  const EMPTY_STATE = {
    status: 'fallback',
    phase: 'normal',
    shiftRpm: null,
    sampleCount: 0,
    carKey: null,
    gameId: null,
    carOrdinal: null,
    pi: null,
    rpmMax: null,
    reportedRedlineRpm: null,
    currentGear: null,
    usableCeiling: null,
    ceilingSampleCount: 0,
    gears: [],
    diagnostics: [],
    acceptedShiftCount: 0,
    lastAcceptedShift: null,
    persistenceError: null
  }

  function finiteOrNull(value) {
    return Number.isFinite(value) ? Math.round(value) : null
  }

  function nonNegativeInteger(value) {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  }

  function gearStatus(value) {
    return ['learning', 'potential', 'optimal'].includes(value) ? value : 'learning'
  }

  function normalizeAcceptedShift(value) {
    if (!value || typeof value !== 'object') return null
    const sourceGear = Number.isInteger(value.sourceGear) ? value.sourceGear : value.gear
    const destinationGear = Number.isInteger(value.destinationGear) ? value.destinationGear : sourceGear + 1
    if (!Number.isInteger(sourceGear) || sourceGear < 1 || sourceGear > 10 || destinationGear !== sourceGear + 1) return null
    return {
      sourceGear,
      destinationGear,
      rpmBefore: finiteOrNull(value.rpmBefore ?? value.beforeRpm),
      powerDeltaPct: Number.isFinite(value.powerDeltaPct ?? value.deltaPercent)
        ? (value.powerDeltaPct ?? value.deltaPercent) : null,
      recordedAt: Number.isFinite(value.recordedAt) ? Math.round(value.recordedAt)
        : Number.isFinite(value.afterTimestampMs) ? Math.round(value.afterTimestampMs) : null
    }
  }

  function normalizeShiftLightState(value) {
    const state = value && typeof value === 'object' ? value : {}
    const gears = Array.isArray(state.gears)
      ? state.gears
        .filter(gear => {
          const sourceGear = Number.isInteger(gear?.sourceGear) ? gear.sourceGear : gear?.gear
          return Number.isInteger(sourceGear) && sourceGear >= 1 && sourceGear <= 10
        })
        .map(gear => ({
          gear: Number.isInteger(gear.sourceGear) ? gear.sourceGear : gear.gear,
          destinationGear: Number.isInteger(gear.destinationGear) ? gear.destinationGear : gear.gear + 1,
          status: gearStatus(gear.status),
          shiftRpm: finiteOrNull(gear.shiftRpm ?? gear.optimalRpm ?? gear.targetRpm ?? gear.candidateRpm),
          sampleCount: nonNegativeInteger(gear.acceptedShiftCount ?? gear.sampleCount),
          candidateRpm: finiteOrNull(gear.candidateRpm ?? gear.optimalRpm ?? gear.targetRpm),
          confirmationCount: Math.min(3, nonNegativeInteger(gear.confirmationCount)),
          acceptedShiftCount: nonNegativeInteger(gear.acceptedShiftCount ?? gear.sampleCount),
          lastRpmBefore: finiteOrNull(gear.lastRpmBefore ?? gear.rpmBefore),
          lastDeltaPct: Number.isFinite(gear.lastDeltaPct) ? gear.lastDeltaPct : null,
          lastAcceptedAt: Number.isFinite(gear.lastAcceptedAt) ? Math.round(gear.lastAcceptedAt) : null
        }))
        .sort((left, right) => left.gear - right.gear)
      : []
    const diagnostics = Array.isArray(state.diagnostics)
      ? state.diagnostics
        .filter(diagnostic => Number.isInteger(diagnostic?.gear) && diagnostic.gear >= 1 && diagnostic.gear <= 10)
        .map(diagnostic => ({
          gear: diagnostic.gear,
          status: gearStatus(diagnostic.status),
          targetRpm: finiteOrNull(diagnostic.targetRpm ?? diagnostic.shiftRpm),
          confirmationCount: Math.min(3, nonNegativeInteger(diagnostic.confirmationCount)),
          acceptedShiftCount: nonNegativeInteger(diagnostic.acceptedShiftCount ?? diagnostic.evidenceCount),
          lastRpmBefore: finiteOrNull(diagnostic.lastRpmBefore ?? diagnostic.rpmBefore),
          lastDeltaPct: Number.isFinite(diagnostic.lastDeltaPct) ? diagnostic.lastDeltaPct : null,
          lastAcceptedAt: Number.isFinite(diagnostic.lastAcceptedAt) ? Math.round(diagnostic.lastAcceptedAt) : null
        }))
        .sort((left, right) => left.gear - right.gear)
      : []

    return {
      status: ['fallback', 'learning', 'calibrated'].includes(state.status) ? state.status : EMPTY_STATE.status,
      phase: ['normal', 'approach', 'shift'].includes(state.phase) ? state.phase : EMPTY_STATE.phase,
      shiftRpm: finiteOrNull(state.shiftRpm),
      sampleCount: nonNegativeInteger(state.sampleCount),
      carKey: typeof state.carKey === 'string' && state.carKey ? state.carKey : null,
      gameId: typeof state.gameId === 'string' && state.gameId ? state.gameId : null,
      carOrdinal: Number.isFinite(state.carOrdinal) && state.carOrdinal > 0 ? Math.round(state.carOrdinal) : null,
      pi: Number.isFinite(state.pi) && state.pi > 0 ? Math.round(state.pi) : null,
      rpmMax: Number.isFinite(state.rpmMax) && state.rpmMax > 0 ? Math.round(state.rpmMax) : null,
      reportedRedlineRpm: Number.isFinite(state.reportedRedlineRpm) && state.reportedRedlineRpm > 0
        ? Math.round(state.reportedRedlineRpm) : null,
      usableCeiling: Number.isFinite(state.usableCeiling) && state.usableCeiling > 0
        ? Math.round(state.usableCeiling) : null,
      ceilingSampleCount: Math.min(3, nonNegativeInteger(state.ceilingSampleCount)),
      fallbackShiftRpm: finiteOrNull(state.fallbackShiftRpm),
      currentGear: Number.isInteger(state.currentGear) && state.currentGear >= 1 && state.currentGear <= 10
        ? state.currentGear : null,
      gears,
      diagnostics,
      acceptedShiftCount: nonNegativeInteger(state.acceptedShiftCount
        ?? state.shiftSamples?.length
        ?? state.acceptedShifts?.length
        ?? gears.reduce((total, gear) => total + gear.acceptedShiftCount, 0)),
      lastAcceptedShift: normalizeAcceptedShift(
        state.lastAcceptedShift
          ?? (Array.isArray(state.shiftSamples) ? state.shiftSamples[state.shiftSamples.length - 1] : null)
          ?? (Array.isArray(state.acceptedShifts) ? state.acceptedShifts[state.acceptedShifts.length - 1] : null)
      ),
      persistenceError: typeof state.persistenceError === 'string' && state.persistenceError ? state.persistenceError : null
    }
  }

  const api = { normalizeShiftLightState }
  globalScope.ShiftLightSettings = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
