(function (globalScope) {
  'use strict'

  const VISIBILITY_STORAGE_KEY = 'forza-horizon-6-hud.hud-visibility.v1'
  const OVERLAY_VISIBILITY_STORAGE_KEY = 'forza-horizon-6-hud.overlay-visibility.v1'
  const COMPONENTS = ['tires', 'pedals', 'steering', 'gear', 'history']
  const OVERLAY_COMPONENTS = ['coach', 'delta', 'hud']
  const DEFAULT_VISIBILITY = COMPONENTS.reduce((state, name) => {
    state[name] = true
    return state
  }, {})
  const invoke = globalScope.__TAURI_INTERNALS__?.invoke
  const status = document.getElementById('settings-status')
  const telemetryStatus = document.getElementById('telemetry-status')
  const telemetryStatusLabel = document.getElementById('telemetry-status-label')
  const shiftLightEmpty = document.getElementById('shift-light-empty')
  const shiftLightProfile = document.getElementById('shift-light-profile')
  const shiftLightCarKey = document.getElementById('shift-light-car-key')
  const shiftLightCurrentTarget = document.getElementById('shift-light-current-target')
  const shiftLightState = document.getElementById('shift-light-state')
  const shiftLightGearRows = document.getElementById('shift-light-gear-rows')
  const shiftLightReset = document.getElementById('shift-light-reset')
  const shiftLightHelp = document.getElementById('shift-light-help')
  const shiftLightHelpPanel = document.getElementById('shift-light-help-panel')
  const normalizeShiftLightState = globalScope.ShiftLightSettings?.normalizeShiftLightState
  const settingsTabs = [...document.querySelectorAll('[data-settings-tab]')]
  const settingsPanels = [...document.querySelectorAll('[data-settings-panel]')]
  let editingTarget = null
  let shiftLightSocket = null
  let shiftLightReconnectTimer = null
  let shiftLightResetQueued = false
  let shiftLightResetPending = false
  let latestShiftLightState = null

  function selectSettingsTab(tabName) {
    for (const tab of settingsTabs) {
      const isActive = tab.dataset.settingsTab === tabName
      tab.classList.toggle('is-active', isActive)
      tab.setAttribute('aria-selected', String(isActive))
      tab.tabIndex = isActive ? 0 : -1
    }
    for (const panel of settingsPanels) {
      panel.hidden = panel.dataset.settingsPanel !== tabName
    }
  }

  function setStatus(message, error = false) {
    status.textContent = message
    status.classList.toggle('is-error', error)
  }

  function call(command, args) {
    if (typeof invoke !== 'function') {
      return Promise.reject(new Error('Tauri commands are unavailable'))
    }
    return invoke(command, args)
  }

  function readVisibility() {
    try {
      const stored = JSON.parse(localStorage.getItem(VISIBILITY_STORAGE_KEY) || 'null')
      if (!stored || typeof stored !== 'object') return { ...DEFAULT_VISIBILITY }
      return COMPONENTS.reduce((state, name) => {
        state[name] = stored[name] !== false
        return state
      }, {})
    } catch {
      return { ...DEFAULT_VISIBILITY }
    }
  }

  function saveVisibility(state) {
    try {
      localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(state))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
  }

  function readOverlayVisibility() {
    try {
      const stored = JSON.parse(localStorage.getItem(OVERLAY_VISIBILITY_STORAGE_KEY) || 'null')
      if (!stored || typeof stored !== 'object') {
        return OVERLAY_COMPONENTS.reduce((state, name) => {
          state[name] = true
          return state
        }, {})
      }
      return OVERLAY_COMPONENTS.reduce((state, name) => {
        state[name] = stored[name] !== false
        return state
      }, {})
    } catch {
      return OVERLAY_COMPONENTS.reduce((state, name) => {
        state[name] = true
        return state
      }, {})
    }
  }

  function saveOverlayVisibility(state) {
    try {
      localStorage.setItem(OVERLAY_VISIBILITY_STORAGE_KEY, JSON.stringify(state))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
  }

  function updateOverlayToggle(button, visible) {
    button.setAttribute('aria-pressed', String(visible))
    button.dataset.state = visible ? 'on' : 'off'
  }

  function setTelemetryState(state) {
    const stateMap = {
      'is-live': { label: 'TELEMETRY LIVE', value: 'live' },
      'is-waiting': { label: 'TELEMETRY CONNECTED', value: 'connected' },
      'is-offline': { label: 'TELEMETRY OFFLINE', value: 'offline' }
    }
    const display = stateMap[state] || stateMap['is-offline']
    telemetryStatus.dataset.state = display.value
    telemetryStatusLabel.textContent = display.label
  }

  function formatRpm(value) {
    return Number.isFinite(value) ? `${Math.round(value)} RPM` : '—'
  }

  function formatPower(value) {
    return Number.isFinite(value) ? `${Math.round(value / 1000)} kW` : '—'
  }

  function formatDiagnosticStatus(status) {
    return String(status || 'learning').replaceAll('-', ' ').toUpperCase()
  }

  function appendCellText(cell, primary, secondary = '') {
    cell.textContent = primary
    if (secondary) {
      const detail = document.createElement('span')
      detail.className = 'calibration-cell__sub'
      detail.textContent = secondary
      cell.append(detail)
    }
  }

  function renderShiftLightState(value) {
    const state = typeof normalizeShiftLightState === 'function'
      ? normalizeShiftLightState(value)
      : value
    latestShiftLightState = state
    const hasProfile = Boolean(state?.carKey)
    shiftLightEmpty.hidden = hasProfile
    shiftLightProfile.hidden = !hasProfile
    shiftLightReset.disabled = !hasProfile || shiftLightResetQueued || shiftLightResetPending
    if (!hasProfile) return

    shiftLightCarKey.textContent = state.carKey
    shiftLightCurrentTarget.textContent = state.shiftRpm ? `${state.shiftRpm} RPM` : 'FALLBACK'
    const activeState = state.method?.toUpperCase() || state.status.toUpperCase()
    shiftLightState.textContent = `${activeState}${state.currentGear ? ` · GEAR ${state.currentGear}` : ''}`
    shiftLightGearRows.replaceChildren()

    const diagnosticsByGear = new Map((state.diagnostics || []).map(diagnostic => [diagnostic.gear, diagnostic]))

    for (const gear of state.gears) {
      const diagnostic = diagnosticsByGear.get(gear.gear)
      const method = diagnostic?.method || gear.method
      const diagnosticStatus = diagnostic?.status || method || gear.status
      const row = document.createElement('tr')
      row.dataset.state = diagnosticStatus

      const gearCell = document.createElement('td')
      gearCell.textContent = `G${gear.gear}`
      row.append(gearCell)

      const targetCell = document.createElement('td')
      appendCellText(
        targetCell,
        formatRpm(diagnostic?.targetRpm ?? gear.shiftRpm),
        `AFTER ${formatRpm(diagnostic?.postShiftRpm)}`
      )
      row.append(targetCell)

      const powerCell = document.createElement('td')
      appendCellText(
        powerCell,
        `${formatPower(diagnostic?.powerAtTarget)} / ${formatPower(diagnostic?.powerAfterShift)}`,
        'CURRENT / NEXT'
      )
      row.append(powerCell)

      const dataCell = document.createElement('td')
      const coverage = diagnostic ? `${Math.round(diagnostic.powerCurveCoverage * 100)}%` : '—'
      const ratio = diagnostic
        ? `${diagnostic.currentRatioSamples}/${diagnostic.nextRatioSamples}`
        : '—'
      const peakPower = diagnostic ? formatRpm(diagnostic.peakPowerRpm) : '—'
      appendCellText(dataCell, `CURVE ${coverage}`, `PEAK ${peakPower} · RATIO ${ratio} · EVIDENCE ${diagnostic?.estimateEvidence || gear.sampleCount}`)
      row.append(dataCell)

      const stateCell = document.createElement('td')
      appendCellText(
        stateCell,
        method?.toUpperCase() || gear.status.toUpperCase(),
        formatDiagnosticStatus(diagnosticStatus)
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
  }

  function flushShiftLightReset() {
    if (!shiftLightResetQueued || !shiftLightSocket || shiftLightSocket.readyState !== 1) return
    try {
      shiftLightSocket.send(JSON.stringify({ type: 'shift_light_reset' }))
      shiftLightResetQueued = false
      shiftLightResetPending = true
      shiftLightReset.disabled = true
      setStatus('RESETTING CALIBRATION')
    } catch {
      shiftLightResetQueued = true
      scheduleShiftLightReconnect()
    }
  }

  function requestShiftLightReset() {
    if (shiftLightResetPending || shiftLightResetQueued) return
    shiftLightResetQueued = true
    shiftLightReset.disabled = true
    if (!shiftLightSocket || shiftLightSocket.readyState !== 1) {
      setStatus('WAITING FOR CALIBRATION SERVICE')
      connectShiftLight()
      return
    }
    flushShiftLightReset()
  }

  function scheduleShiftLightReconnect() {
    if (shiftLightReconnectTimer !== null) return
    shiftLightReconnectTimer = setTimeout(() => {
      shiftLightReconnectTimer = null
      connectShiftLight()
    }, 1500)
  }

  function connectShiftLight() {
    if (typeof WebSocket !== 'function') return
    if (shiftLightSocket && [0, 1].includes(shiftLightSocket.readyState)) return
    const url = globalScope.HudConnection?.resolveCoDriverWebSocketUrl?.() || 'ws://127.0.0.1:3001/_ws'
    try {
      shiftLightSocket = new WebSocket(url)
      shiftLightSocket.addEventListener('open', () => {
        flushShiftLightReset()
      })
      shiftLightSocket.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.type === 'shift_light') renderShiftLightState(payload.shiftLight)
          if (payload.type === 'shift_light_reset_result') {
            shiftLightResetPending = false
            if (payload.ok) {
              shiftLightReset.disabled = !latestShiftLightState?.carKey
              setStatus('CALIBRATION RESET COMPLETE')
            } else {
              shiftLightReset.disabled = !latestShiftLightState?.carKey
              setStatus(payload.message || 'Unable to reset calibration', true)
            }
          }
          if (payload.type === 'forza_status') {
            setTelemetryState(payload.connected ? 'is-live' : 'is-waiting')
          }
        } catch {
          // Ignore malformed messages from a closing local socket.
        }
      })
      shiftLightSocket.addEventListener('close', () => {
        if (shiftLightResetPending) {
          shiftLightResetPending = false
          shiftLightResetQueued = true
        }
        shiftLightSocket = null
        scheduleShiftLightReconnect()
      })
      shiftLightSocket.addEventListener('error', () => {
        shiftLightSocket?.close()
      })
    } catch {
      scheduleShiftLightReconnect()
    }
  }

  function updateLayoutRows() {
    for (const row of document.querySelectorAll('[data-layout-target]')) {
      const target = row.dataset.layoutTarget
      const isEditing = editingTarget === target
      row.querySelector('[data-layout-action="edit"]').hidden = isEditing
      row.querySelector('[data-layout-action="save"]').hidden = !isEditing
      row.classList.toggle('is-editing', isEditing)
    }
  }

  async function selectLayoutTarget(target) {
    if (editingTarget === target) return
    if (editingTarget) {
      await call('layout_action', { action: 'cancel', target: editingTarget })
    }

    try {
      await call('layout_action', { action: 'edit', target })
      editingTarget = target
      updateLayoutRows()
      setStatus(`EDITING ${target.toUpperCase()} — DRAG IT IN THE HUD`)
    } catch (error) {
      setStatus(error.message || 'Unable to enter edit mode', true)
    }
  }

  async function saveLayoutTarget(target) {
    if (editingTarget !== target) return
    try {
      await call('layout_action', { action: 'save', target })
      editingTarget = null
      updateLayoutRows()
      setStatus('POSITION SAVED')
    } catch (error) {
      setStatus(error.message || 'Unable to save position', true)
    }
  }

  function cancelEdit() {
    editingTarget = null
    updateLayoutRows()
    setStatus('READY')
  }

  function setLayoutEditingState(target, isEditing) {
    if (!['coach', 'delta', 'hud'].includes(target)) return

    if (isEditing) {
      editingTarget = target
      updateLayoutRows()
      setStatus(`EDITING ${target.toUpperCase()} - DRAG IT IN THE HUD`)
      return
    }

    if (editingTarget === target) {
      editingTarget = null
      updateLayoutRows()
      setStatus('POSITION SAVED')
    }
  }

  for (const row of document.querySelectorAll('[data-layout-target]')) {
    const target = row.dataset.layoutTarget
    row.querySelector('[data-layout-action="edit"]').addEventListener('click', () => selectLayoutTarget(target))
    row.querySelector('[data-layout-action="save"]').addEventListener('click', () => saveLayoutTarget(target))
  }

  const overlayVisibility = readOverlayVisibility()
  for (const button of document.querySelectorAll('[data-overlay-toggle]')) {
    const component = button.dataset.overlayToggle
    const visible = overlayVisibility[component] !== false
    updateOverlayToggle(button, visible)
    button.addEventListener('click', async () => {
      const nextVisible = overlayVisibility[component] === false
      overlayVisibility[component] = nextVisible
      updateOverlayToggle(button, nextVisible)
      saveOverlayVisibility(overlayVisibility)
      try {
        await call('set_overlay_visibility', { component, visible: nextVisible })
        setStatus(`${component.toUpperCase()} ${nextVisible ? 'ENABLED' : 'HIDDEN'}`)
      } catch (error) {
        overlayVisibility[component] = !nextVisible
        updateOverlayToggle(button, !nextVisible)
        saveOverlayVisibility(overlayVisibility)
        setStatus(error.message || 'Unable to update overlay visibility', true)
      }
    })
  }

  const accordionToggle = document.querySelector('[data-accordion-toggle="hud"]')
  const accordionPanel = document.querySelector('[data-accordion-panel="hud"]')
  accordionToggle?.addEventListener('click', () => {
    const expanded = accordionToggle.getAttribute('aria-expanded') === 'true'
    accordionToggle.setAttribute('aria-expanded', String(!expanded))
    accordionPanel.hidden = expanded
  })

  for (const tab of settingsTabs) {
    tab.addEventListener('click', () => selectSettingsTab(tab.dataset.settingsTab))
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const currentIndex = settingsTabs.indexOf(tab)
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? settingsTabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + settingsTabs.length) % settingsTabs.length
      const nextTab = settingsTabs[nextIndex]
      selectSettingsTab(nextTab.dataset.settingsTab)
      nextTab.focus()
    })
  }
  selectSettingsTab('hud')

  shiftLightHelp?.addEventListener('click', () => {
    const expanded = shiftLightHelp.getAttribute('aria-expanded') === 'true'
    shiftLightHelp.setAttribute('aria-expanded', String(!expanded))
    if (shiftLightHelpPanel) shiftLightHelpPanel.hidden = expanded
  })

  const visibility = readVisibility()
  for (const input of document.querySelectorAll('[data-hud-component]')) {
    const component = input.dataset.hudComponent
    input.checked = visibility[component] !== false
    input.addEventListener('change', async () => {
      visibility[component] = input.checked
      saveVisibility(visibility)
      try {
        await call('set_hud_visibility', { component, visible: input.checked })
        setStatus(`${component.toUpperCase()} ${input.checked ? 'ENABLED' : 'HIDDEN'}`)
      } catch (error) {
        input.checked = !input.checked
        visibility[component] = input.checked
        saveVisibility(visibility)
        setStatus(error.message || 'Unable to update HUD visibility', true)
      }
    })
  }

  shiftLightReset.addEventListener('click', () => {
    requestShiftLightReset()
  })

  setTelemetryState('is-offline')
  renderShiftLightState(null)
  connectShiftLight()
  globalScope.SettingsController = {
    cancelEdit,
    setLayoutEditingState,
    setTelemetryState,
    resetShiftLight: requestShiftLightReset
  }
})(typeof globalThis === 'undefined' ? this : globalThis)
