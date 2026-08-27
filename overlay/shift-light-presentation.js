(function (globalScope) {
  'use strict'

  const LATCH_MS = 250

  function createShiftLightPresentation(now = () => performance.now()) {
    let phase = 'normal'
    let latchUntil = 0

    function update(nextPhase, timestamp = now()) {
      phase = ['normal', 'approach', 'shift'].includes(nextPhase) ? nextPhase : 'normal'
      if (phase === 'shift') latchUntil = Math.max(latchUntil, timestamp + LATCH_MS)
      return getPhase(timestamp)
    }

    function getPhase(timestamp = now()) {
      if (phase === 'shift' || timestamp < latchUntil) return 'shift'
      return phase
    }

    function reset() {
      phase = 'normal'
      latchUntil = 0
    }

    return { getPhase, reset, update }
  }

  globalScope.ShiftLightPresentation = { LATCH_MS, createShiftLightPresentation }
  if (typeof module !== 'undefined') module.exports = globalScope.ShiftLightPresentation
})(typeof globalThis === 'undefined' ? this : globalThis)
