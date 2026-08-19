(function (globalScope) {
  'use strict'

  const EMPTY_STATE = {
    status: 'fallback',
    phase: 'normal',
    shiftRpm: null,
    sampleCount: 0,
    carKey: null,
    currentGear: null,
    gears: []
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
          sampleCount: Number.isFinite(gear.sampleCount) ? Math.max(0, Math.round(gear.sampleCount)) : 0
        }))
        .sort((left, right) => left.gear - right.gear)
      : []

    return {
      status: ['fallback', 'learning', 'calibrated'].includes(state.status) ? state.status : EMPTY_STATE.status,
      phase: ['normal', 'approach', 'shift'].includes(state.phase) ? state.phase : EMPTY_STATE.phase,
      shiftRpm: Number.isFinite(state.shiftRpm) ? Math.round(state.shiftRpm) : null,
      sampleCount: Number.isFinite(state.sampleCount) ? Math.max(0, Math.round(state.sampleCount)) : 0,
      carKey: typeof state.carKey === 'string' && state.carKey ? state.carKey : null,
      currentGear: Number.isInteger(state.currentGear) && state.currentGear >= 1 && state.currentGear <= 10
        ? state.currentGear
        : null,
      gears
    }
  }

  const api = { normalizeShiftLightState }
  globalScope.ShiftLightSettings = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
