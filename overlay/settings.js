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
  const normalizeShiftLightState = globalScope.ShiftLightSettings?.normalizeShiftLightState
  let editingTarget = null
  let shiftLightSocket = null
  let shiftLightReconnectTimer = null
  let shiftLightResetQueued = false
  let shiftLightResetPending = false
  let latestShiftLightState = null

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
    shiftLightState.textContent = `${state.status.toUpperCase()}${state.currentGear ? ` · GEAR ${state.currentGear}` : ''}`
    shiftLightGearRows.replaceChildren()

    for (const gear of state.gears) {
      const row = document.createElement('tr')
      row.dataset.state = gear.status
      const values = [
        `G${gear.gear}`,
        gear.shiftRpm ? `${gear.shiftRpm} RPM` : '—',
        String(gear.sampleCount),
        gear.status.toUpperCase()
      ]
      for (const value of values) {
        const cell = document.createElement('td')
        cell.textContent = value
        row.append(cell)
      }
      shiftLightGearRows.append(row)
    }

    if (!state.gears.length) {
      const row = document.createElement('tr')
      const cell = document.createElement('td')
      cell.colSpan = 4
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
