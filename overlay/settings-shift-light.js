(function (globalScope, factory) {
  const api = factory(globalScope)
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.SettingsShiftLight = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  'use strict'

  // Pure rules: no DOM and no state, so Node tests call them directly.
  // Matches the in-game HUD number format (for example 8,200 RPM).
  const SHIFT_LIGHT_RPM_FORMAT = new Intl.NumberFormat('en-US')

  function formatRpm(value) {
    return Number.isFinite(value) ? `${SHIFT_LIGHT_RPM_FORMAT.format(Math.round(value))} RPM` : '—'
  }

  // The RPM the shift light uses when a pair has no shift point of its own.
  function fallbackShiftRpm(state) {
    return state?.usableCeiling || state?.fallbackShiftRpm || state?.reportedRedlineRpm || state?.rpmMax || null
  }

  function readinessLabel(gear) {
    return gear?.ready === true ? 'READY' : 'LEARNING'
  }

  // One row of the per-gear table: the pair, where to shift, and whether that point is ready.
  function gearRowView(gear, fallbackRpm) {
    return {
      state: gear.ready === true ? 'ready' : 'learning',
      pair: `${gear.gear} → ${gear.gear + 1}`,
      shiftAt: formatRpm(gear.shiftAtRpm ?? fallbackRpm),
      status: readinessLabel(gear)
    }
  }

  // The suggested export file name carries the local time of the export.
  function exportFileName(now = Date.now()) {
    const date = new Date(now)
    const pad = value => String(value).padStart(2, '0')
    const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    return `fdc-shift-lab-${day}-${pad(date.getHours())}${pad(date.getMinutes())}.sqlite.gz`
  }

  // Same rounding as the Driver Analysis export: bytes, then KB and MB with one decimal under 10 units.
  function formatExportSize(value) {
    const bytes = Math.max(0, Number(value) || 0)
    if (bytes < 1024) return `${Math.round(bytes)} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  }

  // CURRENT TARGET and STATE describe the pair of the gear the car is in.
  function currentGearView(state) {
    const activeGear = state.gears.find(gear => gear.gear === state.currentGear)
    const target = activeGear?.shiftAtRpm ?? fallbackShiftRpm(state)
    const readiness = readinessLabel(activeGear)
    return {
      target: target ? `${readiness} · ${formatRpm(target)}` : 'WAITING FOR RPM LIMIT',
      state: `${readiness}${state.currentGear ? ` · GEAR ${state.currentGear}` : ''}`
    }
  }

  // The Shift Light tab: the learned shift points of the current car, its gear table, and the
  // calibration reset. ctx carries the shell functions, the Shift Light state shared with the
  // Garage tab (getter and setter), and the Garage data the car class is read from.
  function create(ctx) {
    const {
      call,
      setStatus,
      confirmDestructive,
      getLatestShiftLightState,
      setLatestShiftLightState,
      getGarageVehicles,
      appendGaragePerformance,
      garageVariantsFor
    } = ctx
    const normalizeShiftLightState = globalScope.ShiftLightSettings?.normalizeShiftLightState
    const garageApi = globalScope.HudGarageRuntime
    const FdcVehicle = globalScope.FdcVehicle
    const shiftLightEmpty = document.getElementById('shift-light-empty')
    const shiftLightProfile = document.getElementById('shift-light-profile')
    const shiftLightCarKey = document.getElementById('shift-light-car-key')
    const shiftLightCarPi = document.getElementById('shift-light-car-pi')
    const shiftLightCarRpmMax = document.getElementById('shift-light-car-rpm-max')
    const shiftLightUsableCeiling = document.getElementById('shift-light-usable-ceiling')
    const shiftLightCurrentTarget = document.getElementById('shift-light-current-target')
    const shiftLightState = document.getElementById('shift-light-state')
    const shiftLightGearRows = document.getElementById('shift-light-gear-rows')
    const shiftLightExport = document.getElementById('shift-light-export')
    const shiftLightReset = document.getElementById('shift-light-reset')
    const shiftLightHelp = document.getElementById('shift-light-help')
    const shiftLightHelpPanel = document.getElementById('shift-light-help-panel')
    let shiftLightExportPending = false
    let shiftLightResetPending = false

  // The Shift Light car key is fh6:<ordinal>:<class>:<pi>:..., so the class
  // is read from it and falls back to the Garage variant with the same PI.
  function renderShiftLightCarClass(state, vehicle) {
    shiftLightCarPi.replaceChildren()
    const pi = state.pi
    const keyClass = typeof state.carKey === 'string' ? state.carKey.split(':')[2] : ''
    const variant = garageVariantsFor(vehicle).find(candidate => candidate?.pi === pi)
    const classLabel = (/^\d+$/.test(keyClass) ? garageApi?.classLabel?.(Number(keyClass)) : null)
      || variant?.classLabel
      || (variant?.class !== null && variant?.class !== undefined ? garageApi?.classLabel?.(variant.class) : null)
    if (!classLabel && !pi) {
      shiftLightCarPi.textContent = '—'
      return
    }
    appendGaragePerformance(shiftLightCarPi, { classLabel, pi })
  }

  function renderShiftLightState(value) {
    const state = typeof normalizeShiftLightState === 'function'
      ? normalizeShiftLightState(value)
      : value
    setLatestShiftLightState(state)
    const hasProfile = Boolean(state?.carKey && state?.carOrdinal)
    shiftLightEmpty.hidden = hasProfile
    shiftLightProfile.hidden = !hasProfile
    shiftLightExport.hidden = !hasProfile
    shiftLightExport.disabled = !hasProfile || shiftLightExportPending
    shiftLightReset.hidden = !hasProfile
    shiftLightReset.disabled = !hasProfile || shiftLightResetPending
    if (!hasProfile) return

    const garageVehicle = state.gameId === 'fh6' && state.carOrdinal ? getGarageVehicles().get(state.carOrdinal) : null
    shiftLightCarKey.textContent = FdcVehicle.displayName(garageVehicle?.name, state.carOrdinal)
    renderShiftLightCarClass(state, garageVehicle)
    shiftLightCarRpmMax.textContent = state.rpmMax ? formatRpm(state.rpmMax) : '—'
    shiftLightUsableCeiling.textContent = state.usableCeiling
      ? `${formatRpm(state.usableCeiling)} · ${state.ceilingClusterCount}/3`
      : state.provisionalCeiling
        ? `LEARNING · ${state.ceilingClusterCount}/3 · ~${formatRpm(state.provisionalCeiling)}`
        : state.ceilingSampleCount > 0 ? `LEARNING · ${state.ceilingClusterCount}/3` : 'NOT OBSERVED'
    const current = currentGearView(state)
    shiftLightCurrentTarget.textContent = current.target
    shiftLightState.textContent = current.state
    shiftLightGearRows.replaceChildren()

    const fallbackRpm = fallbackShiftRpm(state)
    for (const gear of state.gears) {
      const view = gearRowView(gear, fallbackRpm)
      const row = document.createElement('tr')
      row.dataset.state = view.state

      const gearCell = document.createElement('th')
      gearCell.scope = 'row'
      gearCell.textContent = view.pair
      row.append(gearCell)

      const shiftAtCell = document.createElement('td')
      shiftAtCell.textContent = view.shiftAt
      row.append(shiftAtCell)

      const statusCell = document.createElement('td')
      statusCell.className = 'events-run-table__end'
      statusCell.textContent = view.status
      row.append(statusCell)
      shiftLightGearRows.append(row)
    }

    if (!state.gears.length) {
      const row = document.createElement('tr')
      const cell = document.createElement('td')
      cell.colSpan = 3
      cell.textContent = 'NO GEAR SAMPLES YET'
      row.append(cell)
      shiftLightGearRows.append(row)
    }

    if (state.persistenceError) {
      setStatus(`SHIFT LIGHT SAVE ERROR · ${state.persistenceError}`, true)
    }
  }

  // The save dialog runs in the backend; a cancelled dialog changes nothing and reports no status.
  async function requestShiftLightExport() {
    const carKey = getLatestShiftLightState()?.carKey
    if (shiftLightExportPending || !carKey) return
    shiftLightExportPending = true
    shiftLightExport.disabled = true
    try {
      const outcome = await call('export_shift_lab_drives', { carKey, fileName: exportFileName() })
      if (outcome?.cancelled) return
      setStatus(`SHIFT LAB DRIVES EXPORTED · ${formatExportSize(outcome?.bytes)}`)
    } catch (error) {
      setStatus(error?.message || (typeof error === 'string' && error) || 'Unable to export Shift Lab drives', true)
    } finally {
      shiftLightExportPending = false
      shiftLightExport.disabled = !getLatestShiftLightState()?.carKey
    }
  }

  async function requestShiftLightReset() {
    const carKey = getLatestShiftLightState()?.carKey
    if (shiftLightResetPending || !carKey) return
    const reset = globalScope.__TAURI_INTERNALS__?.invoke
    if (typeof reset !== 'function') {
      setStatus('TAURI COMMANDS ARE UNAVAILABLE', true)
      return
    }
    if (!(await confirmDestructive('Reset the calibration of the current car? Its learned shift points are deleted and learning starts again.'))) return
    if (shiftLightResetPending) return
    // The answer was given for the car shown when the question opened; a different car is never reset.
    if (getLatestShiftLightState()?.carKey !== carKey) {
      setStatus('CURRENT CAR CHANGED. CALIBRATION NOT RESET', true)
      return
    }
    shiftLightResetPending = true
    shiftLightReset.disabled = true
    setStatus('RESETTING CALIBRATION')
    Promise.resolve(reset('reset_shift_light'))
      .catch(error => {
        shiftLightResetPending = false
        shiftLightReset.disabled = !getLatestShiftLightState()?.carKey
        setStatus(error.message || 'Unable to reset calibration', true)
      })
  }

  function renderShiftLightResetResult(result) {
    shiftLightResetPending = false
    shiftLightReset.disabled = !getLatestShiftLightState()?.carKey
    if (result?.ok === true) {
      setStatus('CALIBRATION RESET COMPLETE')
      return
    }
    setStatus(result?.message || 'Unable to reset calibration', true)
  }

  async function listenShiftLightEvents() {
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (!eventApi || typeof eventApi.listen !== 'function') return
    await eventApi.listen('hud_shift_light', event => {
      renderShiftLightState(event.payload)
      shiftLightReset.disabled = !getLatestShiftLightState()?.carKey || shiftLightResetPending
    })
    await eventApi.listen('hud_shift_light_reset_result', event => {
      renderShiftLightResetResult(event.payload)
    })
    await call('sync_shift_light_status')
  }

    shiftLightHelp?.addEventListener('click', () => {
      const expanded = shiftLightHelp.getAttribute('aria-expanded') === 'true'
      shiftLightHelp.setAttribute('aria-expanded', String(!expanded))
      if (shiftLightHelpPanel) shiftLightHelpPanel.hidden = expanded
    })
    shiftLightExport.addEventListener('click', () => {
      void requestShiftLightExport()
    })
    shiftLightReset.addEventListener('click', () => {
      void requestShiftLightReset()
    })

    return {
      renderShiftLightState,
      requestShiftLightExport,
      requestShiftLightReset,
      listenShiftLightEvents
    }
  }

  return {
    create,
    formatRpm,
    fallbackShiftRpm,
    gearRowView,
    currentGearView,
    exportFileName,
    formatExportSize
  }
}))
