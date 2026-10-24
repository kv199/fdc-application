(function (globalScope, factory) {
  const api = factory(globalScope)

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.BrakeMarks = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  const STORAGE_KEY = 'fdc.brake-marks.v1'
  const DEFAULTS = Object.freeze({
    targetEnabled: false,
    targetPercent: 70,
    peakEnabled: false
  })
  const MIN_PERCENT = 5
  const MAX_PERCENT = 100
  const PERCENT_STEP = 5
  // Brake at or above this level counts as braking. A lower level is released.
  const PEAK_START_LEVEL = 0.05
  // A release shorter than this stays inside the same stop.
  const PEAK_MERGE_GAP_MS = 300
  // A stop lasting at least this long, measured to its last braking sample, is confirmed.
  const PEAK_MIN_STOP_MS = 200

  function resolveStorage(storage) {
    if (storage) return storage
    try {
      return globalScope?.localStorage || null
    } catch {
      return null
    }
  }

  function normalizeTargetPercent(value) {
    const hasNumber = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
    const raw = hasNumber ? Number(value) : Number.NaN
    if (!Number.isFinite(raw)) return DEFAULTS.targetPercent
    const stepped = Math.round(raw / PERCENT_STEP) * PERCENT_STEP
    return Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, stepped))
  }

  function normalize(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {}
    return {
      targetEnabled: source.targetEnabled === true,
      targetPercent: normalizeTargetPercent(source.targetPercent),
      peakEnabled: source.peakEnabled === true
    }
  }

  function read(storage) {
    try {
      const stored = resolveStorage(storage)?.getItem(STORAGE_KEY)
      return normalize(stored ? JSON.parse(stored) : null)
    } catch {
      return { ...DEFAULTS }
    }
  }

  function write(preferences, storage) {
    const normalized = normalize(preferences)
    try {
      resolveStorage(storage)?.setItem(STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
    return normalized
  }

  function clampLevel(value) {
    const level = Number(value)
    if (!Number.isFinite(level)) return 0
    return Math.max(0, Math.min(1, level))
  }

  // Tracks the brake peak shown on the brake bar. A stop is one run of braking;
  // a release shorter than PEAK_MERGE_GAP_MS does not end it. Its peak is shown
  // only once it is confirmed, so a short tap never replaces the displayed peak.
  function createPeakTracker() {
    let displayedPeak = null
    let stop = null
    let trackedCarKey
    let hasTrackedCarKey = false

    function clearPeak() {
      displayedPeak = null
      stop = null
    }

    function reset() {
      clearPeak()
      hasTrackedCarKey = false
      trackedCarKey = undefined
    }

    function update(sample) {
      const { brake, timestampMs, isRaceOn, carKey } = sample && typeof sample === 'object' ? sample : {}
      if (isRaceOn !== true) {
        reset()
        return null
      }
      if (!hasTrackedCarKey || carKey !== trackedCarKey) {
        clearPeak()
        trackedCarKey = carKey
        hasTrackedCarKey = true
      }

      const level = clampLevel(brake)
      const now = Number(timestampMs)
      if (!Number.isFinite(now)) return displayedPeak

      // The stop ends once the release has lasted the merge gap. The displayed
      // peak is left alone: a confirmed stop already holds it, and an unconfirmed
      // stop is discarded.
      if (stop !== null && now - stop.lastBrakingMs >= PEAK_MERGE_GAP_MS) stop = null

      if (level >= PEAK_START_LEVEL) {
        if (stop === null) {
          stop = { startMs: now, lastBrakingMs: now, max: level, confirmed: false }
        } else {
          stop.lastBrakingMs = now
          stop.max = Math.max(stop.max, level)
        }
        if (!stop.confirmed && stop.lastBrakingMs - stop.startMs >= PEAK_MIN_STOP_MS) {
          stop.confirmed = true
        }
      }

      if (stop !== null && stop.confirmed) displayedPeak = stop.max
      return displayedPeak
    }

    return {
      update,
      reset,
      peak: () => displayedPeak
    }
  }

  return {
    DEFAULTS,
    MAX_PERCENT,
    MIN_PERCENT,
    PEAK_MERGE_GAP_MS,
    PEAK_MIN_STOP_MS,
    PEAK_START_LEVEL,
    PERCENT_STEP,
    STORAGE_KEY,
    createPeakTracker,
    normalize,
    read,
    write
  }
}))
