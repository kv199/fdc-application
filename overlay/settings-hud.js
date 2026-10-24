(function (globalScope, factory) {
  const api = factory(globalScope)
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.SettingsHud = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  'use strict'

  const VISIBILITY_STORAGE_KEY = 'fdc.hud-visibility.v1'
  const OVERLAY_VISIBILITY_STORAGE_KEY = 'fdc.overlay-visibility.v1'
  const LAYOUT_MODE_STORAGE_KEY = 'fdc.layout-mode.v1'
  const HUD_EDIT_HOTKEY_STORAGE_KEY = 'fdc.hud-edit-hotkey.v1'
  const DEFAULT_HUD_EDIT_HOTKEY = 'Ctrl+Shift+F8'
  const LAYOUT_TARGET_LABELS = Object.freeze({
    delta: 'DELTA',
    hud: 'HUD',
    shiftBar: 'SHIFT BAR',
    tires: 'TIRES',
    pedals: 'THROTTLE & BRAKE',
    steering: 'STEERING',
    gear: 'GEAR / SPEED / RPM',
    engine: 'ENGINE / BOOST',
    history: 'INPUT GRAPH'
  })

  // Pure rules: no DOM and no state. The HudWidgets rules are read when a function runs,
  // so Node tests can call these once hud-widgets.js is loaded.
  function normalizeLayoutMode(value) {
    return value === 'freeform' ? 'freeform' : 'grouped'
  }

  // ALL covers every widget switch, the Shift Bar included; the Shift Bar is off by default.
  function allWidgetsOn(visibility, overlayVisibility) {
    const { COMPONENTS } = globalScope.HudWidgets
    return COMPONENTS.every(c => visibility[c] !== false) &&
      overlayVisibility.delta !== false &&
      overlayVisibility.shiftBar === true
  }

  function anyWidgetOn(visibility, overlayVisibility) {
    const { COMPONENTS } = globalScope.HudWidgets
    return COMPONENTS.some(c => visibility[c] !== false) ||
      overlayVisibility.delta !== false ||
      overlayVisibility.shiftBar === true
  }

  // The HUD tab: the monitor list, the HUD edit hotkey, the layout mode and edit row, and the widget
  // switches. ctx carries the shell functions and the settings.js state this tab reads. The Driver
  // Analysis hotkey functions are created after this module, so they are reached through lambdas.
  function create(ctx) {
    const {
      call,
      setStatus,
      confirmDestructive,
      getDriverAnalysisSettings,
      isDriverAnalysisHotkeyCapturing,
      setDriverAnalysisHotkey,
      setDriverAnalysisHotkeyCapture
    } = ctx
    const { COMPONENTS, OVERLAY_COMPONENTS, isOverlayComponentOn } = globalScope.HudWidgets
    const DEFAULT_VISIBILITY = COMPONENTS.reduce((state, name) => {
      state[name] = true
      return state
    }, {})
    const driverAnalysisApi = globalScope.DriverAnalysis
    const hudEditHotkeyValue = document.getElementById('hud-edit-hotkey-value')
    const hudEditHotkeyChange = document.getElementById('hud-edit-hotkey-change')
    const hudDisplay = document.getElementById('hud-display')
    const hudDisplayMissing = document.getElementById('hud-display-missing')
    const layoutModeInputs = [...document.querySelectorAll('[data-layout-mode]')]
    let editingTarget = null
    let hudDisplayCount = 0
    let layoutMode = 'grouped'
    let hudEditHotkeySettings = readHudEditHotkeySettings()
    let hudEditHotkeyCapture = false

    function syncHudDisplayDisabled() {
      if (hudDisplay) hudDisplay.disabled = hudDisplayCount <= 1 || Boolean(editingTarget)
    }

    async function refreshHudDisplay() {
      if (!hudDisplay) return
      try {
        const displayList = await call('list_hud_displays')
        hudDisplay.replaceChildren(...displayList.displays.map(display => new Option(display.label, display.name)))
        if (displayList.selected) hudDisplay.value = displayList.selected
        hudDisplayCount = displayList.displays.length
        hudDisplayMissing.hidden = !displayList.savedMissing
        syncHudDisplayDisabled()
      } catch (error) {
        setStatus(error.message || 'Unable to list monitors', true)
      }
    }

    // The HUD edit hotkey is always registered: pressing it in Forza starts a layout edit
    // over the running game, and pressing it again saves.
    function readHudEditHotkeySettings() {
      try {
        const stored = JSON.parse(globalScope.localStorage?.getItem(HUD_EDIT_HOTKEY_STORAGE_KEY) || 'null')
        const hotkey = driverAnalysisApi?.normalizeHotkey?.(stored?.hotkey) || DEFAULT_HUD_EDIT_HOTKEY
        const hotkeyLabel = hotkey.startsWith('Controller:') && typeof stored?.hotkeyLabel === 'string' ? stored.hotkeyLabel.trim().slice(0, 80) : ''
        return { hotkey, hotkeyLabel }
      } catch {
        return { hotkey: DEFAULT_HUD_EDIT_HOTKEY, hotkeyLabel: '' }
      }
    }

    function writeHudEditHotkeySettings(hotkey, hotkeyLabel) {
      hudEditHotkeySettings = { hotkey, hotkeyLabel: hotkey.startsWith('Controller:') ? hotkeyLabel : '' }
      try { globalScope.localStorage?.setItem(HUD_EDIT_HOTKEY_STORAGE_KEY, JSON.stringify(hudEditHotkeySettings)) } catch { /* restricted webview */ }
    }

    function renderHudEditHotkey() {
      if (!hudEditHotkeyValue || !hudEditHotkeyChange) return
      hudEditHotkeyChange.textContent = hudEditHotkeyCapture ? 'CANCEL' : 'CHANGE'
      hudEditHotkeyValue.textContent = hudEditHotkeyCapture
        ? 'PRESS KEYS OR A BUTTON'
        : driverAnalysisApi?.formatHotkey?.(hudEditHotkeySettings.hotkey, hudEditHotkeySettings.hotkeyLabel) || hudEditHotkeySettings.hotkey
    }

    async function setHudEditHotkey(hotkey, announce = true, hotkeyLabel = '') {
      const normalized = driverAnalysisApi?.normalizeHotkey?.(hotkey)
      if (!normalized) {
        if (announce) setStatus('USE CTRL, ALT OR SHIFT WITH ONE KEY. WINDOWS KEY IS NOT ALLOWED.', true)
        return false
      }
      if (normalized === getDriverAnalysisSettings().hotkey) {
        setStatus('THAT HOTKEY IS ALREADY USED BY DRIVER ANALYSIS', true)
        return false
      }
      try {
        const registered = await call('set_hud_edit_hotkey', { hotkey: normalized })
        writeHudEditHotkeySettings(registered, hotkeyLabel)
        renderHudEditHotkey()
        if (announce) {
          const formatted = driverAnalysisApi.formatHotkey(registered, hudEditHotkeySettings.hotkeyLabel).toUpperCase()
          setStatus(`HUD EDIT HOTKEY SET TO ${formatted}`)
        }
        return true
      } catch (error) {
        renderHudEditHotkey()
        setStatus(error.message || 'Unable to register HUD edit hotkey', true)
        return false
      }
    }

    async function setHudEditHotkeyCapture(active) {
      const wasActive = hudEditHotkeyCapture
      hudEditHotkeyCapture = active === true
      if (hudEditHotkeyCapture && isDriverAnalysisHotkeyCapturing()) await setDriverAnalysisHotkeyCapture(false)
      renderHudEditHotkey()
      if (hudEditHotkeyCapture) {
        setStatus('PRESS A KEY COMBINATION OR A CONTROLLER BUTTON')
        try {
          await call('start_controller_capture')
        } catch {
          setStatus('CONTROLLER CAPTURE UNAVAILABLE. PRESS A KEY COMBINATION.', true)
        }
      } else if (wasActive) {
        try {
          await call('stop_controller_capture')
        } catch {
        }
      }
    }

    // One listener serves both hotkey captures; starting one capture always ends the other.
    async function listenControllerHotkeyCapture() {
      const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
      if (!eventApi || typeof eventApi.listen !== 'function') return
      await eventApi.listen('driver_analysis_controller_captured', async event => {
        if (!isDriverAnalysisHotkeyCapturing() && !hudEditHotkeyCapture) return
        const binding = event?.payload?.binding
        const deviceName = event?.payload?.deviceName || ''
        if (!binding) return
        if (isDriverAnalysisHotkeyCapturing()) {
          await setDriverAnalysisHotkeyCapture(false)
          await setDriverAnalysisHotkey(binding, true, deviceName)
        } else {
          await setHudEditHotkeyCapture(false)
          await setHudEditHotkey(binding, true, deviceName)
        }
      })
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
      let stored = null
      try {
        stored = JSON.parse(localStorage.getItem(OVERLAY_VISIBILITY_STORAGE_KEY) || 'null')
      } catch {
        stored = null
      }
      // A stored state without a key keeps that block's default: on for Delta and the HUD, off for the Shift Bar.
      return OVERLAY_COMPONENTS.reduce((state, name) => {
        state[name] = isOverlayComponentOn(stored, name)
        return state
      }, {})
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

    function renderHudComponentVisibility(component, visible) {
      for (const input of document.querySelectorAll('[data-hud-component]')) {
        if (input.dataset.hudComponent === component) input.checked = visible
      }
      for (const button of document.querySelectorAll('[data-hud-toggle]')) {
        if (button.dataset.hudToggle === component) updateOverlayToggle(button, visible)
      }
      renderAllToggle()
    }


    function readLayoutMode() {
      try {
        return normalizeLayoutMode(localStorage.getItem(LAYOUT_MODE_STORAGE_KEY))
      } catch {
        return 'grouped'
      }
    }

    function persistLayoutMode(mode) {
      try {
        localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, mode)
      } catch {
        // A restricted webview may not expose persistent storage.
      }
    }

    function renderLayoutMode(mode) {
      layoutMode = normalizeLayoutMode(mode)
      for (const input of layoutModeInputs) input.checked = input.value === layoutMode
      renderLayoutEditRow()
    }

    function renderLayoutEditRow() {
      const editBtn = document.getElementById('hud-layout-edit')
      const resetBtn = document.getElementById('hud-layout-reset')
      const saveBtn = document.getElementById('hud-layout-save')
      const cancelBtn = document.getElementById('hud-layout-cancel')

      const editing = Boolean(editingTarget)
      editBtn.hidden = editing
      resetBtn.hidden = editing
      saveBtn.hidden = !editing
      cancelBtn.hidden = !editing
      const status = document.getElementById('hud-layout-status')
      if (status) status.hidden = !editing
      const hint = document.getElementById('hud-layout-edit-hint')
      if (hint) {
        hint.textContent = editing
          ? 'Drag the blocks on the screen, then save or cancel. In Forza, the hotkey also saves.'
          : 'Move and resize the HUD blocks right on the screen.'
      }
      syncHudDisplayDisabled()
    }

    async function selectLayoutMode(mode) {
      const nextMode = normalizeLayoutMode(mode)
      if (nextMode === layoutMode) return
      const previousMode = layoutMode

      try {
        if (editingTarget) {
          await call('layout_action', { action: 'cancel', target: editingTarget })
          editingTarget = null
          renderLayoutEditRow()
        }
        await call('set_layout_mode', { mode: nextMode })
        persistLayoutMode(nextMode)
        layoutMode = normalizeLayoutMode(mode)
        for (const input of layoutModeInputs) input.checked = input.value === layoutMode
        renderLayoutEditRow()
        setStatus(`${nextMode.toUpperCase()} HUD LAYOUT ENABLED`)
      } catch (error) {
        layoutMode = previousMode
        for (const input of layoutModeInputs) input.checked = input.value === layoutMode
        setStatus(error.message || 'Unable to change HUD layout mode', true)
      }
    }

    function cancelEdit() {
      editingTarget = null
      renderLayoutEditRow()
      setStatus('READY')
    }

    function setLayoutEditingState(target, isEditing) {
      if (!Object.hasOwn(LAYOUT_TARGET_LABELS, target)) return

      if (isEditing) {
        editingTarget = target
        renderLayoutEditRow()
        setStatus('EDITING — DRAG BLOCKS ON THE SCREEN')
        return
      }

      if (editingTarget === target) {
        editingTarget = null
        renderLayoutEditRow()
        setStatus('LAYOUT SAVED')
      }
    }

    const hudLayoutEditBtn = document.getElementById('hud-layout-edit')
    const hudLayoutResetBtn = document.getElementById('hud-layout-reset')
    const hudLayoutSaveBtn = document.getElementById('hud-layout-save')
    const hudLayoutCancelBtn = document.getElementById('hud-layout-cancel')

    hudLayoutEditBtn?.addEventListener('click', async () => {
      if (!anyWidgetOn(visibility, overlayVisibility)) {
        setStatus('TURN ON A WIDGET TO EDIT THE LAYOUT', true)
        return
      }
      try {
        await call('layout_action', { action: 'start', target: 'hud' })
        editingTarget = 'hud'
        renderLayoutEditRow()
        setStatus('EDITING — DRAG BLOCKS ON THE SCREEN')
      } catch (error) {
        setStatus(error.message || 'Unable to enter edit mode', true)
      }
    })

    hudLayoutResetBtn?.addEventListener('click', async () => {
      if (!(await confirmDestructive('Every HUD block, Delta and the Shift Bar goes back to its default place and size, in both arrangements.'))) return
      try {
        await call('layout_action', { action: 'reset_all', target: 'hud' })
        setStatus('HUD LAYOUT RESET')
      } catch (error) {
        setStatus(error.message || 'Unable to reset layout', true)
      }
    })

    hudLayoutSaveBtn?.addEventListener('click', async () => {
      try {
        await call('layout_action', { action: 'save', target: editingTarget })
        editingTarget = null
        renderLayoutEditRow()
        setStatus('LAYOUT SAVED')
      } catch (error) {
        setStatus(error.message || 'Unable to save layout', true)
      }
    })

    hudLayoutCancelBtn?.addEventListener('click', async () => {
      try {
        await call('layout_action', { action: 'cancel', target: editingTarget })
        editingTarget = null
        renderLayoutEditRow()
        setStatus('READY')
      } catch (error) {
        setStatus(error.message || 'Unable to cancel the layout edit', true)
      }
    })

    const overlayVisibility = readOverlayVisibility()

    function renderOverlayComponentVisibility(component, visible) {
      const button = document.querySelector(`[data-overlay-toggle="${component}"]`)
      if (button) updateOverlayToggle(button, visible)
      renderAllToggle()
    }

    async function setOverlayComponentVisibility(component, visible) {
      const previous = overlayVisibility[component] !== false
      overlayVisibility[component] = visible
      renderOverlayComponentVisibility(component, visible)
      saveOverlayVisibility(overlayVisibility)
      try {
        await call('set_overlay_visibility', { component, visible })
        setStatus(`${LAYOUT_TARGET_LABELS[component] || component.toUpperCase()} ${visible ? 'ENABLED' : 'HIDDEN'}`)
      } catch (error) {
        overlayVisibility[component] = previous
        renderOverlayComponentVisibility(component, previous)
        saveOverlayVisibility(overlayVisibility)
        setStatus(error.message || 'Unable to update overlay visibility', true)
      }
    }

    for (const button of document.querySelectorAll('[data-overlay-toggle]')) {
      const component = button.dataset.overlayToggle
      const visible = overlayVisibility[component] !== false
      updateOverlayToggle(button, visible)
      button.addEventListener('click', async () => {
        const nextVisible = overlayVisibility[component] === false
        void setOverlayComponentVisibility(component, nextVisible)
      })
    }

    function renderAllToggle() {
      const allBtn = document.getElementById('hud-all-widgets')
      if (!allBtn) return
      updateOverlayToggle(allBtn, allWidgetsOn(visibility, overlayVisibility))
    }

    const allWidgetsBtn = document.getElementById('hud-all-widgets')
    allWidgetsBtn?.addEventListener('click', async () => {
      const next = !allWidgetsOn(visibility, overlayVisibility)
      for (const component of COMPONENTS) {
        if ((visibility[component] !== false) !== next) {
          await setHudComponentVisibility(component, next)
        }
      }
      if ((overlayVisibility.delta !== false) !== next) {
        await setOverlayComponentVisibility('delta', next)
      }
      if ((overlayVisibility.shiftBar === true) !== next) {
        await setOverlayComponentVisibility('shiftBar', next)
      }
      renderAllToggle()
      setStatus(next ? 'ALL WIDGETS ON' : 'ALL WIDGETS OFF')
    })

    layoutMode = readLayoutMode()
    renderLayoutMode(layoutMode)
    for (const input of layoutModeInputs) {
      input.addEventListener('change', () => {
        if (input.checked) void selectLayoutMode(input.value)
      })
    }
    void call('set_layout_mode', { mode: layoutMode }).catch(() => undefined)

    const visibility = readVisibility()
    async function setHudComponentVisibility(component, visible) {
      const previous = visibility[component] !== false
      visibility[component] = visible
      renderHudComponentVisibility(component, visible)
      saveVisibility(visibility)
      try {
        await call('set_hud_visibility', { component, visible })
        setStatus(`${component.toUpperCase()} ${visible ? 'ENABLED' : 'HIDDEN'}`)
      } catch (error) {
        visibility[component] = previous
        renderHudComponentVisibility(component, previous)
        saveVisibility(visibility)
        setStatus(error.message || 'Unable to update HUD visibility', true)
      }
    }

    for (const component of COMPONENTS) {
      renderHudComponentVisibility(component, visibility[component] !== false)
    }
    for (const button of document.querySelectorAll('[data-hud-toggle]')) {
      button.addEventListener('click', () => {
        const component = button.dataset.hudToggle
        void setHudComponentVisibility(component, visibility[component] === false)
      })
    }
    renderAllToggle()
    // The whole-HUD switch is gone: a HUD hidden with it stays hidden through the widget switches.
    if (overlayVisibility.hud === false) {
      void (async () => {
        for (const component of COMPONENTS) await setHudComponentVisibility(component, false)
        await setOverlayComponentVisibility('hud', true)
        setStatus('READY')
      })()
    }

    // BRAKE TARGET: the brake bar's target line and peak marker. BrakeMarks owns the stored
    // preferences. Without it the card is hidden rather than showing controls that do nothing.
    const brakeTargetCard = document.getElementById('brake-target-card')
    const brakeTargetEnabled = document.getElementById('brake-target-enabled')
    const brakeTargetLevel = document.getElementById('brake-target-level')
    const brakeTargetValue = document.getElementById('brake-target-value')
    const brakePeakEnabled = document.getElementById('brake-peak-enabled')
    const brakeMarks = globalScope.BrakeMarks
    let brakeMarkPreferences = brakeMarks ? brakeMarks.read() : null

    function renderBrakeTargetLevel(percent) {
      const minimum = Number(brakeTargetLevel.min)
      const maximum = Number(brakeTargetLevel.max)
      const progress = ((percent - minimum) / (maximum - minimum)) * 100
      brakeTargetLevel.value = String(percent)
      brakeTargetLevel.style.setProperty('--brightness-fill', `${Math.max(0, Math.min(100, progress))}%`)
      brakeTargetLevel.setAttribute('aria-valuetext', `${percent}% brake level`)
      brakeTargetValue.textContent = `${percent}%`
    }

    function renderBrakeMarks(preferences) {
      updateOverlayToggle(brakeTargetEnabled, preferences.targetEnabled)
      updateOverlayToggle(brakePeakEnabled, preferences.peakEnabled)
      renderBrakeTargetLevel(preferences.targetPercent)
    }

    async function updateBrakeMarks(changes, message) {
      const previous = brakeMarkPreferences
      const next = brakeMarks.write({ ...previous, ...changes })
      brakeMarkPreferences = next
      renderBrakeMarks(next)
      try {
        await call('set_brake_marks', {
          targetEnabled: next.targetEnabled,
          targetPercent: next.targetPercent,
          peakEnabled: next.peakEnabled
        })
        setStatus(message(next))
      } catch (error) {
        brakeMarkPreferences = brakeMarks.write(previous)
        renderBrakeMarks(brakeMarkPreferences)
        setStatus(error.message || 'Unable to update the brake target', true)
      }
    }

    if (brakeMarks) {
      renderBrakeMarks(brakeMarkPreferences)
      brakeTargetEnabled?.addEventListener('click', () => {
        void updateBrakeMarks(
          { targetEnabled: !brakeMarkPreferences.targetEnabled },
          next => `BRAKE TARGET ${next.targetEnabled ? 'ENABLED' : 'HIDDEN'}`
        )
      })
      brakeTargetLevel?.addEventListener('input', () => {
        renderBrakeTargetLevel(Number(brakeTargetLevel.value))
      })
      brakeTargetLevel?.addEventListener('change', () => {
        void updateBrakeMarks(
          { targetPercent: Number(brakeTargetLevel.value) },
          next => `BRAKE TARGET SET TO ${next.targetPercent}%`
        )
      })
      brakePeakEnabled?.addEventListener('click', () => {
        void updateBrakeMarks(
          { peakEnabled: !brakeMarkPreferences.peakEnabled },
          next => `PEAK MARKER ${next.peakEnabled ? 'ENABLED' : 'HIDDEN'}`
        )
      })
    } else if (brakeTargetCard) {
      brakeTargetCard.hidden = true
    }

    hudDisplay?.addEventListener('change', async () => {
      try {
        await call('set_hud_display', { name: hudDisplay.value })
      } catch (error) {
        setStatus(error.message || 'Unable to move the HUD', true)
      }
      await refreshHudDisplay()
    })

    window.addEventListener('focus', () => {
      void refreshHudDisplay()
    })
    hudEditHotkeyChange?.addEventListener('click', () => {
      void setHudEditHotkeyCapture(!hudEditHotkeyCapture)
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && hudEditHotkeyCapture) void setHudEditHotkeyCapture(false)
    })
    document.addEventListener('keydown', event => {
      if (!hudEditHotkeyCapture) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        void setHudEditHotkeyCapture(false)
        setStatus('HUD EDIT HOTKEY UNCHANGED')
        return
      }
      const hotkey = driverAnalysisApi?.hotkeyFromKeyboardEvent?.(event)
      if (!hotkey) {
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
          setStatus('USE CTRL, ALT OR SHIFT WITH ONE KEY. WINDOWS KEY IS NOT ALLOWED.', true)
        }
        return
      }
      void setHudEditHotkeyCapture(false)
      void setHudEditHotkey(hotkey)
    })

    return {
      refreshHudDisplay,
      renderHudEditHotkey,
      setHudEditHotkey,
      setHudEditHotkeyCapture,
      listenControllerHotkeyCapture,
      updateOverlayToggle,
      renderLayoutMode,
      cancelEdit,
      setLayoutEditingState,
      isHudEditHotkeyCapturing: () => hudEditHotkeyCapture,
      getHudEditHotkeySettings: () => hudEditHotkeySettings
    }
  }

  return {
    create,
    normalizeLayoutMode,
    allWidgetsOn,
    anyWidgetOn
  }
}))
