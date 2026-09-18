(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysis = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict'

  const SETTINGS_STORAGE_KEY = 'fdc.driver-analysis.settings.v1'
  const HISTORY_STORAGE_KEY = 'fdc.driver-analysis.history.v1'
  const DEFAULT_HOTKEY = 'Ctrl+Shift+F9'
  const HISTORY_LIMIT = 100
  const BLOCKED_HOTKEYS = new Set(['Alt+F4', 'Alt+Tab', 'Ctrl+Escape', 'Ctrl+Shift+Escape'])

  function storageGet(storage, key) {
    try { return storage?.getItem?.(key) || null } catch { return null }
  }

  function storageSet(storage, key, value) {
    try { storage?.setItem?.(key, value) } catch { /* restricted webview */ }
  }

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {}
    return {
      enabled: source.enabled === true,
      hotkey: normalizeHotkey(source.hotkey) || DEFAULT_HOTKEY
    }
  }

  function readSettings(storage = globalThis.localStorage) {
    try {
      return normalizeSettings(JSON.parse(storageGet(storage, SETTINGS_STORAGE_KEY) || 'null'))
    } catch {
      return normalizeSettings(null)
    }
  }

  function writeSettings(value, storage = globalThis.localStorage) {
    const settings = normalizeSettings(value)
    storageSet(storage, SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    return settings
  }

  function normalizedMainKey(value) {
    const raw = String(value || '').trim()
    if (/^[a-z]$/i.test(raw)) return raw.toUpperCase()
    if (/^[0-9]$/.test(raw)) return raw
    if (/^f(?:[1-9]|1[0-2])$/i.test(raw)) return raw.toUpperCase()
    const aliases = {
      ' ': 'Space',
      spacebar: 'Space',
      space: 'Space',
      enter: 'Enter',
      escape: 'Escape',
      esc: 'Escape',
      tab: 'Tab',
      arrowup: 'ArrowUp',
      arrowdown: 'ArrowDown',
      arrowleft: 'ArrowLeft',
      arrowright: 'ArrowRight'
    }
    return aliases[raw.toLowerCase()] || null
  }

  function normalizeHotkey(value) {
    const tokens = String(value || '').split('+').map(token => token.trim()).filter(Boolean)
    if (tokens.length < 2) return null
    const modifiers = new Set()
    let mainKey = null
    for (const token of tokens) {
      const normalized = token.toLowerCase()
      if (normalized === 'ctrl' || normalized === 'control') modifiers.add('Ctrl')
      else if (normalized === 'alt') modifiers.add('Alt')
      else if (normalized === 'shift') modifiers.add('Shift')
      else if (normalized === 'meta' || normalized === 'win' || normalized === 'windows' || normalized === 'super') return null
      else {
        if (mainKey !== null) return null
        mainKey = normalizedMainKey(token)
      }
    }
    if (!mainKey || modifiers.size === 0) return null
    const hotkey = [...['Ctrl', 'Alt', 'Shift'].filter(modifier => modifiers.has(modifier)), mainKey].join('+')
    return BLOCKED_HOTKEYS.has(hotkey) ? null : hotkey
  }

  function hotkeyFromKeyboardEvent(event) {
    if (!event || event.metaKey) return null
    const mainKey = normalizedMainKey(event.key)
    if (!mainKey || ['Ctrl', 'Alt', 'Shift'].includes(mainKey)) return null
    return normalizeHotkey([
      event.ctrlKey ? 'Ctrl' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
      mainKey
    ].filter(Boolean).join('+'))
  }

  function formatHotkey(value) {
    return (normalizeHotkey(value) || DEFAULT_HOTKEY).replaceAll('+', ' + ')
  }

  function normalizeHistoryEntry(value) {
    if (!value || typeof value !== 'object') return null
    const recordedAt = new Date(value.recordedAt)
    if (!Number.isFinite(recordedAt.getTime())) return null
    const durationMs = Math.max(0, Math.round(Number(value.durationMs) || 0))
    const sampleCount = Math.max(0, Math.round(Number(value.sampleCount) || 0))
    const evidenceCount = Math.max(0, Math.round(Number(value.evidenceCount) || 0))
    const result = value.result === 'issue' ? 'issue' : 'insufficient'
    const mainKind = result === 'issue' && typeof value.mainKind === 'string' ? value.mainKind : null
    const label = result === 'issue' && typeof value.label === 'string' ? value.label.trim() : ''
    const instruction = result === 'issue' && typeof value.instruction === 'string' ? value.instruction.trim() : ''
    return {
      id: String(value.id || recordedAt.getTime()),
      recordedAt: recordedAt.toISOString(),
      durationMs,
      sampleCount,
      evidenceCount,
      result: mainKind && label && instruction ? 'issue' : 'insufficient',
      mainKind: mainKind && label && instruction ? mainKind : null,
      label: mainKind && label && instruction ? label : '',
      instruction: mainKind && label && instruction ? instruction : ''
    }
  }

  function sortHistoryNewestFirst(entries) {
    return entries.slice().sort((left, right) => {
      const timeDifference = Date.parse(right.recordedAt) - Date.parse(left.recordedAt)
      return timeDifference || String(right.id).localeCompare(String(left.id))
    })
  }

  function readHistory(storage = globalThis.localStorage) {
    try {
      const stored = JSON.parse(storageGet(storage, HISTORY_STORAGE_KEY) || '[]')
      if (!Array.isArray(stored)) return []
      return sortHistoryNewestFirst(stored.map(normalizeHistoryEntry).filter(Boolean)).slice(0, HISTORY_LIMIT)
    } catch {
      return []
    }
  }

  function writeHistory(entries, storage = globalThis.localStorage) {
    const history = sortHistoryNewestFirst(
      (Array.isArray(entries) ? entries : []).map(normalizeHistoryEntry).filter(Boolean)
    ).slice(0, HISTORY_LIMIT)
    storageSet(storage, HISTORY_STORAGE_KEY, JSON.stringify(history))
    return history
  }

  function appendHistory(entry, storage = globalThis.localStorage) {
    const normalized = normalizeHistoryEntry(entry)
    if (!normalized) return readHistory(storage)
    return writeHistory([normalized, ...readHistory(storage)], storage)
  }

  function createRecorder(options = {}) {
    const state = options.state
    const findings = options.findings
    const buildBrief = options.buildBrief
    const metaFor = options.metaFor
    const now = typeof options.now === 'function' ? options.now : () => Date.now()
    const storage = options.storage ?? globalThis.localStorage
    if (!state || !findings || typeof buildBrief !== 'function' || typeof metaFor !== 'function') return null

    let enabled = options.enabled === true
    let recording = false
    let startedAt = null
    let sampleCount = 0

    function resetAnalysis(reason = 'recording_reset') {
      state.reset(reason)
      findings.reset()
      sampleCount = 0
    }

    function snapshot() {
      return { enabled, recording, startedAt, sampleCount }
    }

    function setEnabled(value) {
      enabled = value === true
      if (!enabled && recording) cancel()
      return snapshot()
    }

    function start() {
      if (!enabled || recording) return snapshot()
      resetAnalysis('recording_start')
      recording = true
      startedAt = now()
      return snapshot()
    }

    function cancel() {
      recording = false
      startedAt = null
      resetAnalysis('recording_cancel')
      return snapshot()
    }

    function update(telemetry) {
      if (!enabled || !recording) return snapshot()
      const analysis = state.update(telemetry)
      if (analysis?.ignored === true) return snapshot()
      sampleCount += 1
      if (
        analysis?.resetReason === 'car_identity_change'
        || analysis?.resetReason === 'race_clock_rewind'
        || analysis?.resetReason === 'lap_number_rewind'
        || analysis?.resetReason === 'lap_distance_rewind'
        || analysis?.resetReason === 'timestamp_rewind'
      ) findings.reset()
      else findings.update(analysis)
      return snapshot()
    }

    function resetTransient(reason = 'telemetry_gap') {
      if (!recording) return snapshot()
      state.resetTransient(reason)
      findings.resetTransient()
      return snapshot()
    }

    function stop() {
      if (!recording) return { status: snapshot(), entry: null, history: readHistory(storage) }
      const stoppedAt = now()
      const summary = findings.getSummary()
      const brief = buildBrief(summary)
      const meta = brief.mainKind ? metaFor(brief.mainKind) : null
      const entry = normalizeHistoryEntry({
        id: `${stoppedAt}-${startedAt || stoppedAt}`,
        recordedAt: new Date(stoppedAt).toISOString(),
        durationMs: Math.max(0, stoppedAt - (startedAt || stoppedAt)),
        sampleCount,
        evidenceCount: brief.mainEvidenceCount || 0,
        result: brief.mainKind ? 'issue' : 'insufficient',
        mainKind: brief.mainKind,
        label: meta?.label || '',
        instruction: brief.nextText || ''
      })
      const history = appendHistory(entry, storage)
      recording = false
      startedAt = null
      resetAnalysis('recording_stop')
      return { status: snapshot(), entry, history }
    }

    function toggle() {
      return recording ? stop() : { status: start(), entry: null, history: readHistory(storage) }
    }

    return { appendHistory, cancel, resetTransient, setEnabled, snapshot, start, stop, toggle, update }
  }

  return {
    DEFAULT_HOTKEY,
    HISTORY_LIMIT,
    HISTORY_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    appendHistory,
    createRecorder,
    formatHotkey,
    hotkeyFromKeyboardEvent,
    normalizeHistoryEntry,
    normalizeHotkey,
    normalizeSettings,
    readHistory,
    readSettings,
    sortHistoryNewestFirst,
    writeHistory,
    writeSettings
  }
}))
