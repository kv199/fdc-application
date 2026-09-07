(function (globalScope) {
  'use strict'

  const EMPTY_STATE = {
    status: 'fallback',
    phase: 'normal',
    shiftRpm: null,
    sampleCount: 0,
    carKey: null,
    currentGear: null,
    gearCount: null,
    gearboxChanged: false,
    gearboxValidation: null,
    method: null,
    gears: [],
    diagnostics: []
  }

  const DIAGNOSTIC_STATUSES = [
    'observed',
    'optimal',
    'learning',
    'waiting-for-wot',
    'waiting-for-ratio',
    'confirming',
    'gearbox-mismatch'
  ]

  function finiteOrNull(value) {
    return Number.isFinite(value) ? value : null
  }

  function normalizeShiftLightState(value) {
    const state = value && typeof value === 'object' ? value : {}
    const gears = Array.isArray(state.gears)
      ? state.gears
        .filter((gear) => Number.isInteger(gear?.gear) && gear.gear >= 1 && gear.gear <= 10)
        .map((gear) => ({
          gear: gear.gear,
          status: gear.status === 'calibrated' ? 'calibrated' : 'learning',
          shiftRpm: Number.isFinite(gear.shiftRpm) ? Math.round(gear.shiftRpm) : null,
      sampleCount: Number.isFinite(gear.sampleCount) ? Math.max(0, Math.round(gear.sampleCount)) : 0,
          method: ['observed', 'optimal'].includes(gear.method) ? gear.method : null,
          ratioDrop: Number.isFinite(gear.ratioDrop) ? gear.ratioDrop : null
        }))
        .sort((left, right) => left.gear - right.gear)
      : []
    const diagnostics = Array.isArray(state.diagnostics)
      ? state.diagnostics
        .filter((diagnostic) => Number.isInteger(diagnostic?.gear) && diagnostic.gear >= 1 && diagnostic.gear <= 10)
        .map((diagnostic) => ({
          gear: diagnostic.gear,
          status: DIAGNOSTIC_STATUSES.includes(diagnostic.status) ? diagnostic.status : 'learning',
          method: ['observed', 'optimal'].includes(diagnostic.method) ? diagnostic.method : null,
          powerCurveCoverage: Number.isFinite(diagnostic.powerCurveCoverage)
            ? Math.max(0, Math.min(1, diagnostic.powerCurveCoverage))
            : 0,
          powerBinCount: Number.isFinite(diagnostic.powerBinCount)
            ? Math.max(0, Math.round(diagnostic.powerBinCount))
            : 0,
          peakPowerRpm: finiteOrNull(diagnostic.peakPowerRpm),
          currentRatio: finiteOrNull(diagnostic.currentRatio),
          nextRatio: finiteOrNull(diagnostic.nextRatio),
          ratioDrop: finiteOrNull(diagnostic.ratioDrop),
          currentRatioSamples: Number.isFinite(diagnostic.currentRatioSamples)
            ? Math.max(0, Math.round(diagnostic.currentRatioSamples))
            : 0,
          nextRatioSamples: Number.isFinite(diagnostic.nextRatioSamples)
            ? Math.max(0, Math.round(diagnostic.nextRatioSamples))
            : 0,
          targetRpm: finiteOrNull(diagnostic.targetRpm),
          postShiftRpm: finiteOrNull(diagnostic.postShiftRpm),
          powerAtTarget: finiteOrNull(diagnostic.powerAtTarget),
          powerAfterShift: finiteOrNull(diagnostic.powerAfterShift),
          estimateEvidence: Number.isFinite(diagnostic.estimateEvidence)
            ? Math.max(0, Math.round(diagnostic.estimateEvidence))
            : 0
        }))
        .sort((left, right) => left.gear - right.gear)
      : []

    return {
      status: ['fallback', 'learning', 'calibrated'].includes(state.status) ? state.status : EMPTY_STATE.status,
      phase: ['normal', 'approach', 'shift'].includes(state.phase) ? state.phase : EMPTY_STATE.phase,
      shiftRpm: Number.isFinite(state.shiftRpm) ? Math.round(state.shiftRpm) : null,
      sampleCount: Number.isFinite(state.sampleCount) ? Math.max(0, Math.round(state.sampleCount)) : 0,
      carKey: typeof state.carKey === 'string' && state.carKey ? state.carKey : null,
      gameId: typeof state.gameId === 'string' && state.gameId ? state.gameId : null,
      carOrdinal: Number.isFinite(state.carOrdinal) && state.carOrdinal > 0 ? Math.round(state.carOrdinal) : null,
      pi: Number.isFinite(state.pi) && state.pi > 0 ? Math.round(state.pi) : null,
      rpmMax: Number.isFinite(state.rpmMax) && state.rpmMax > 0 ? Math.round(state.rpmMax) : null,
      fallbackShiftRpm: Number.isFinite(state.fallbackShiftRpm) && state.fallbackShiftRpm > 0
        ? Math.round(state.fallbackShiftRpm) : null,
      currentGear: Number.isInteger(state.currentGear) && state.currentGear >= 1 && state.currentGear <= 10
        ? state.currentGear
        : null,
      gearCount: Number.isInteger(state.gearCount) && state.gearCount >= 1 && state.gearCount <= 10
        ? state.gearCount
        : null,
      gearboxChanged: state.gearboxChanged === true,
      gearboxValidation: ['validating', 'verified', 'checking'].includes(state.gearboxValidation)
        ? state.gearboxValidation
        : null,
      method: ['observed', 'optimal'].includes(state.method) ? state.method : null,
      gears,
      diagnostics
    }
  }

  const api = { normalizeShiftLightState }
  globalScope.ShiftLightSettings = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
