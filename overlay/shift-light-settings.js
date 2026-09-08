(function (globalScope) {
  'use strict'

  const EMPTY_STATE = {
    status: 'fallback',
    phase: 'normal',
    shiftRpm: null,
    sampleCount: 0,
    carKey: null,
    currentGear: null,
    usableCeiling: null,
    ceilingSampleCount: 0,
    gears: [],
    diagnostics: [],
    persistenceError: null
  }

  function finiteOrNull(value) {
    return Number.isFinite(value) ? Math.round(value) : null
  }

  function nonNegativeInteger(value) {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  }

  function gearStatus(value) {
    return ['learning', 'confirming', 'optimal'].includes(value) ? value : 'learning'
  }

  function normalizeShiftLightState(value) {
    const state = value && typeof value === 'object' ? value : {}
    const gears = Array.isArray(state.gears)
      ? state.gears
        .filter(gear => Number.isInteger(gear?.gear) && gear.gear >= 1 && gear.gear <= 10)
        .map(gear => ({
          gear: gear.gear,
          status: gearStatus(gear.status),
          shiftRpm: finiteOrNull(gear.shiftRpm),
          sampleCount: nonNegativeInteger(gear.sampleCount),
          candidateRpm: finiteOrNull(gear.candidateRpm),
          confirmingCount: Math.min(3, nonNegativeInteger(gear.confirmingCount)),
          lastReason: typeof gear.lastReason === 'string' && gear.lastReason ? gear.lastReason : null
        }))
        .sort((left, right) => left.gear - right.gear)
      : []
    const diagnostics = Array.isArray(state.diagnostics)
      ? state.diagnostics
        .filter(diagnostic => Number.isInteger(diagnostic?.gear) && diagnostic.gear >= 1 && diagnostic.gear <= 10)
        .map(diagnostic => ({
          gear: diagnostic.gear,
          status: gearStatus(diagnostic.status),
          powerBinCount: nonNegativeInteger(diagnostic.powerBinCount),
          peakPowerRpm: finiteOrNull(diagnostic.peakPowerRpm),
          targetRpm: finiteOrNull(diagnostic.targetRpm),
          confirmingCount: Math.min(3, nonNegativeInteger(diagnostic.confirmingCount)),
          lastReason: typeof diagnostic.lastReason === 'string' && diagnostic.lastReason ? diagnostic.lastReason : null,
          evidenceCount: nonNegativeInteger(diagnostic.evidenceCount)
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
      usableCeiling: Number.isFinite(state.usableCeiling) && state.usableCeiling > 0
        ? Math.round(state.usableCeiling) : null,
      ceilingSampleCount: Math.min(3, nonNegativeInteger(state.ceilingSampleCount)),
      fallbackShiftRpm: finiteOrNull(state.fallbackShiftRpm),
      currentGear: Number.isInteger(state.currentGear) && state.currentGear >= 1 && state.currentGear <= 10
        ? state.currentGear : null,
      gears,
      diagnostics,
      persistenceError: typeof state.persistenceError === 'string' && state.persistenceError ? state.persistenceError : null
    }
  }

  const api = { normalizeShiftLightState }
  globalScope.ShiftLightSettings = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
