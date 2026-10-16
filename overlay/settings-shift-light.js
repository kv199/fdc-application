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

  function formatDelta(value) {
    return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%` : '—'
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
    const isShiftAtLimiter = globalScope.ShiftLightSettings?.isShiftAtLimiter
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
    const shiftLightReset = document.getElementById('shift-light-reset')
    const shiftLightHelp = document.getElementById('shift-light-help')
    const shiftLightHelpPanel = document.getElementById('shift-light-help-panel')
    let shiftLightResetPending = false

  function appendCellText(cell, primary, secondary = '') {
    cell.textContent = primary
    if (secondary) {
      const detail = document.createElement('span')
      detail.className = 'calibration-cell__sub'
      detail.textContent = secondary
      cell.append(detail)
    }
  }

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
    const activeGear = state.gears.find(gear => gear.gear === state.currentGear)
    const activeStatus = activeGear?.status || 'learning'
    const fallbackTarget = state.usableCeiling || state.fallbackShiftRpm || state.reportedRedlineRpm || state.rpmMax
    const activeTarget = activeStatus === 'learning'
      ? fallbackTarget
      : activeGear?.shiftRpm ?? state.shiftRpm
    shiftLightCurrentTarget.textContent = activeTarget
      ? `${activeStatus === 'optimal' ? 'OPTIMAL' : activeStatus === 'potential' ? 'POTENTIAL' : 'LEARNING'} · ${formatRpm(activeTarget)}`
      : fallbackTarget
        ? `LEARNING · ${formatRpm(fallbackTarget)}`
        : 'WAITING FOR RPM LIMIT'
    const activeState = activeStatus === 'potential'
      ? `POTENTIAL ${Math.max(1, activeGear?.confirmationCount || 1)}/3`
      : activeStatus.toUpperCase()
    shiftLightState.textContent = `${activeState}${state.currentGear ? ` · GEAR ${state.currentGear}` : ''}`
    shiftLightGearRows.replaceChildren()

    const diagnosticsByGear = new Map((state.diagnostics || []).map(diagnostic => [diagnostic.gear, diagnostic]))

    for (const gear of state.gears) {
      const diagnostic = diagnosticsByGear.get(gear.gear)
      const diagnosticStatus = diagnostic?.status || gear.status
      const row = document.createElement('tr')
      row.dataset.state = diagnosticStatus

      const gearCell = document.createElement('th')
      gearCell.scope = 'row'
      gearCell.textContent = `G${gear.gear}`
      row.append(gearCell)

      const targetCell = document.createElement('td')
      const gearTargetRpm = diagnostic?.targetRpm ?? gear.shiftRpm
      appendCellText(
        targetCell,
        formatRpm(gearTargetRpm ?? (gear.status === 'learning' ? fallbackTarget : null)),
        gear.status === 'potential'
          ? `POTENTIAL · ${Math.max(1, diagnostic?.confirmationCount ?? gear.confirmationCount)}/3`
          : gear.status === 'optimal'
            ? 'PURPLE CUE ACTIVE'
            : 'REDLINE FALLBACK'
      )
      if (typeof isShiftAtLimiter === 'function' && isShiftAtLimiter(diagnosticStatus, gearTargetRpm, state.usableCeiling)) {
        const limiterHint = document.createElement('span')
        limiterHint.className = 'calibration-cell__sub'
        limiterHint.textContent = 'SHIFT AT LIMITER'
        limiterHint.title = 'The best shift point for this gear is at the rev limiter.'
        targetCell.append(limiterHint)
      }
      row.append(targetCell)

      const powerCell = document.createElement('td')
      appendCellText(
        powerCell,
        `${diagnostic?.acceptedShiftCount ?? gear.acceptedShiftCount ?? gear.sampleCount} ACCEPTED`,
        Number.isFinite(diagnostic?.lastDeltaPct ?? gear.lastDeltaPct)
          ? `LAST Δ ${formatDelta(diagnostic?.lastDeltaPct ?? gear.lastDeltaPct)}`
          : 'WAITING FOR AN ACCEPTED SHIFT'
      )
      row.append(powerCell)

      const dataCell = document.createElement('td')
      const lastRpm = gear.lastRpmBefore ?? null
      appendCellText(
        dataCell,
        Number.isFinite(gear.lastDeltaPct) ? `${formatDelta(gear.lastDeltaPct)} POWER DELTA` : 'NO LAST SHIFT',
        Number.isFinite(lastRpm) ? `RECORDED ${formatRpm(lastRpm)}` : 'WAITING FOR A COMPARABLE UPSHIFT'
      )
      row.append(dataCell)

      const stateCell = document.createElement('td')
      stateCell.className = 'events-run-table__end'
      appendCellText(
        stateCell,
        diagnosticStatus === 'potential'
          ? `POTENTIAL ${Math.max(1, diagnostic?.confirmationCount ?? gear.confirmationCount)}/3`
          : diagnosticStatus.toUpperCase(),
        diagnosticStatus === 'learning' ? 'REDLINE FALLBACK ACTIVE' : ''
      )
      row.append(stateCell)
      shiftLightGearRows.append(row)
    }

    if (!state.gears.length) {
      const row = document.createElement('tr')
      const cell = document.createElement('td')
      cell.colSpan = 5
      cell.textContent = 'NO GEAR SAMPLES YET'
      row.append(cell)
      shiftLightGearRows.append(row)
    }

    if (state.persistenceError) {
      setStatus(`SHIFT LIGHT SAVE ERROR · ${state.persistenceError}`, true)
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
    shiftLightReset.addEventListener('click', () => {
      void requestShiftLightReset()
    })

    return {
      renderShiftLightState,
      requestShiftLightReset,
      listenShiftLightEvents
    }
  }

  return {
    create,
    formatRpm,
    formatDelta
  }
}))
