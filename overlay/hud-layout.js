(function (globalScope) {
  'use strict'

  const HudWidgets = globalScope.HudWidgets || require('./hud-widgets.js')
  const HudGrid = globalScope.HudGrid || require('./hud-grid.js')
  const STORAGE_KEY = 'fdc.layout.v2'
  const MODE_STORAGE_KEY = 'fdc.layout-mode.v1'
  const SNAP_STORAGE_KEY = 'fdc.layout-snap.v1'
  const MODES = ['grouped', 'freeform']
  const GROUPED_TARGETS = HudWidgets.OVERLAY_COMPONENTS
  const FREEFORM_TARGETS = HudWidgets.COMPONENTS
  const TARGET_NAMES = [...GROUPED_TARGETS, ...FREEFORM_TARGETS]
  const COLUMN_WIDTHS = HudWidgets.COLUMN_WIDTHS
  const HUD_BASE_WIDTH = Object.values(COLUMN_WIDTHS).reduce((total, width) => total + width, 0)
  const HUD_BASE_HEIGHT = 69
  const DEFAULT_SIZE = 0
  const MIN_WIDGET_SIZE = 0.5
  const MAX_WIDGET_SIZE = 2
  const EDITOR_CHROME_MARGIN = 8
  const EDITOR_CHROME_GAP = 10

  function clamp(value, minimum, maximum) {
    const number = Number(value)
    if (!Number.isFinite(number)) return minimum
    return Math.max(minimum, Math.min(maximum, number))
  }

  function sanitizePosition(raw) {
    if (!raw || typeof raw !== 'object') return null
    const x = Number(raw.x)
    const y = Number(raw.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) }
  }

  function clampPosition(position) {
    const safePosition = sanitizePosition(position)
    return safePosition || { x: 0, y: 0 }
  }

  function sanitizeWidgetSize(raw) {
    const size = Number(raw)
    if (!Number.isFinite(size) || size <= DEFAULT_SIZE) return DEFAULT_SIZE
    return clamp(size, MIN_WIDGET_SIZE, MAX_WIDGET_SIZE)
  }

  function calculateEditorToolbarPosition(targetRect, toolbarRect, viewport) {
    const maximumLeft = Math.max(EDITOR_CHROME_MARGIN, viewport.width - toolbarRect.width - EDITOR_CHROME_MARGIN)
    const left = clamp(targetRect.left, EDITOR_CHROME_MARGIN, maximumLeft)
    const belowTop = targetRect.bottom + EDITOR_CHROME_GAP
    const aboveTop = targetRect.top - EDITOR_CHROME_GAP - toolbarRect.height
    const preferredTop = belowTop + toolbarRect.height <= viewport.height - EDITOR_CHROME_MARGIN
      ? belowTop
      : aboveTop
    const maximumTop = Math.max(EDITOR_CHROME_MARGIN, viewport.height - toolbarRect.height - EDITOR_CHROME_MARGIN)
    return { left, top: clamp(preferredTop, EDITOR_CHROME_MARGIN, maximumTop) }
  }

  function storageGet(key) {
    try { return globalScope.localStorage?.getItem(key) || null } catch { return null }
  }

  function storageSet(key, value) {
    try { globalScope.localStorage?.setItem(key, value) } catch { /* restricted webview */ }
  }

  function sanitizeTargetPosition(raw) {
    const position = sanitizePosition(raw)
    if (!position) return null
    position.size = sanitizeWidgetSize(raw.size)
    return position
  }

  function sanitizePositionMap(source, names) {
    return names.reduce((result, name) => {
      const position = sanitizeTargetPosition(source?.[name])
      if (position) result[name] = position
      return result
    }, {})
  }

  function readStoredMode() {
    const stored = storageGet(MODE_STORAGE_KEY)
    return MODES.includes(stored) ? stored : 'grouped'
  }

  function readStoredSnap() {
    return storageGet(SNAP_STORAGE_KEY) !== 'off'
  }

  function readStoredLayout() {
    try {
      const stored = JSON.parse(storageGet(STORAGE_KEY) || 'null')
      if (!stored || typeof stored !== 'object') {
        return { mode: readStoredMode(), shared: {}, grouped: {}, freeform: {} }
      }
      return {
        mode: readStoredMode(),
        shared: sanitizePositionMap(stored.shared, ['delta']),
        grouped: sanitizePositionMap(stored.grouped, ['hud']),
        freeform: sanitizePositionMap(stored.freeform, FREEFORM_TARGETS)
      }
    } catch {
      return { mode: readStoredMode(), shared: {}, grouped: {}, freeform: {} }
    }
  }

  function saveStoredLayout(layout) {
    storageSet(STORAGE_KEY, JSON.stringify({
      version: 2,
      shared: sanitizePositionMap(layout.shared, ['delta']),
      grouped: sanitizePositionMap(layout.grouped, ['hud']),
      freeform: sanitizePositionMap(layout.freeform, FREEFORM_TARGETS)
    }))
  }

  function setNativeInteraction(enabled) {
    const invoke = globalScope.__TAURI_INTERNALS__?.invoke
    if (typeof invoke !== 'function') return Promise.resolve()
    return Promise.resolve(invoke('set_window_edit_mode', { enabled })).catch(() => {})
  }

  function createLayout() {
    const elements = {
      delta: document.getElementById('delta-strip'),
      hud: document.getElementById('hud-frame'),
      tires: document.getElementById('hud-tires'),
      pedals: document.getElementById('hud-pedals'),
      steering: document.getElementById('hud-steering'),
      gear: document.getElementById('hud-gear'),
      engine: document.getElementById('hud-engine'),
      history: document.getElementById('hud-history')
    }
    const hud = document.getElementById('hud')
    if (Object.values(elements).some(element => !element) || !hud) return null

    const tools = {}
    function createTools(name) {
      if (tools[name]) return tools[name]
      const existingRoot = document.getElementById(`${name}-edit-tools`)
      if (existingRoot) {
        tools[name] = {
          root: existingRoot,
          reset: document.getElementById(`${name}-reset`),
          cancel: document.getElementById(`${name}-cancel`),
          save: document.getElementById(`${name}-save`),
          snap: document.getElementById(`${name}-snap`)
        }
        return tools[name]
      }
      const root = document.createElement('div')
      root.className = 'layout-edit-tools'
      root.hidden = true
      root.innerHTML = `<span class="layout-edit__hint">DRAG ${name.toUpperCase()} TO MOVE · CORNER TO RESIZE · CLICK A BLOCK TO SELECT</span><button class="layout-edit__button layout-edit__button--toggle" type="button" data-layout-snap aria-pressed="true">SNAP</button><button class="layout-edit__button layout-edit__button--reset" type="button">RESET</button><button class="layout-edit__button" type="button">CANCEL</button><button class="layout-edit__button layout-edit__button--primary" type="button">SAVE</button>`
      const editorFrame = FREEFORM_TARGETS.includes(name) ? document.createElement('div') : null
      const editorSurface = editorFrame || elements[name]
      if (editorFrame) {
        editorFrame.className = 'hud-widget-editor-frame'
        editorFrame.dataset.layoutEditorTarget = name
        editorFrame.hidden = true
        hud.append(editorFrame)
      }
      editorSurface.append(root)
      for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
        const handle = document.createElement('button')
        handle.className = `layout-resize-handle layout-resize-handle--${corner}`
        handle.type = 'button'
        handle.dataset.layoutResizeTarget = name
        handle.dataset.layoutResizeHandle = corner
        handle.setAttribute('aria-label', `Resize ${name} from ${corner} corner`)
        editorSurface.append(handle)
      }
      const reset = root.querySelector('.layout-edit__button--reset')
      const cancel = root.querySelector('.layout-edit__button:not(.layout-edit__button--reset):not(.layout-edit__button--primary):not(.layout-edit__button--toggle)')
      const save = root.querySelector('.layout-edit__button--primary')
      const snap = root.querySelector('[data-layout-snap]')
      tools[name] = { root, editorFrame, reset, cancel, save, snap }
      return tools[name]
    }
    for (const name of TARGET_NAMES) createTools(name)

    const stored = readStoredLayout()
    let mode = stored.mode
    const positions = { shared: stored.shared, grouped: stored.grouped, freeform: stored.freeform }
    let snapEnabled = readStoredSnap()
    let sessionTargets = []
    let selectedTarget = null
    let sessionSnapshot = null
    let dragTarget = null
    let dragging = false
    let dragOffsetX = 0
    let dragOffsetY = 0
    let resizing = false
    let resizeHandle = null
    let resizeSnapshot = null

    function isFreeformTarget(name) {
      return mode === 'freeform' && FREEFORM_TARGETS.includes(name)
    }

    function positionMap(name) {
      if (name === 'delta') return positions.shared
      if (name === 'hud') return positions.grouped
      return positions.freeform
    }

    function getViewport() {
      return {
        width: Math.max(1, document.documentElement.clientWidth || window.innerWidth),
        height: Math.max(1, document.documentElement.clientHeight || window.innerHeight)
      }
    }

    function getElementSize(element, fallback = { width: 0, height: 0 }) {
      const rect = element.getBoundingClientRect()
      return {
        width: Math.max(0, rect.width || fallback.width),
        height: Math.max(0, rect.height || fallback.height)
      }
    }

    function getAvailableSize(viewport, elementSize) {
      return {
        width: Math.max(0, viewport.width - elementSize.width),
        height: Math.max(0, viewport.height - elementSize.height)
      }
    }

    function getWidgetSize(name) {
      return sanitizeWidgetSize(positionMap(name)[name]?.size)
    }

    function getWidgetScaleFactor(name) {
      const size = getWidgetSize(name)
      return size === DEFAULT_SIZE ? 1 : size
    }

    function getHudScale() {
      return Math.min(2, Math.max(0, (getViewport().width - 16) / HUD_BASE_WIDTH))
    }

    function getFallbackSize(name, viewport) {
      if (name === 'delta') return { width: Math.min(1472, Math.max(0, viewport.width - 16)), height: 60 }
      if (name === 'hud') return { width: Math.min(1472, Math.max(0, viewport.width - 16)), height: 138 }
      return { width: COLUMN_WIDTHS[name] * getHudScale(), height: HUD_BASE_HEIGHT * getHudScale() }
    }

    function getDefaultHudRect(viewport) {
      const scale = getHudScale()
      const width = HUD_BASE_WIDTH * scale
      const height = HUD_BASE_HEIGHT * scale
      return {
        left: (viewport.width - width) / 2,
        top: viewport.height - height - 28,
        width,
        height
      }
    }

    function getDefaultAnchor(name, elementSize, viewport) {
      const defaultHudRect = getDefaultHudRect(viewport)
      if (FREEFORM_TARGETS.includes(name)) {
        const index = FREEFORM_TARGETS.indexOf(name)
        const offset = FREEFORM_TARGETS
          .slice(0, index)
          .reduce((total, target) => total + COLUMN_WIDTHS[target], 0)
        return {
          left: defaultHudRect.left + offset * getHudScale(),
          top: defaultHudRect.top
        }
      }

      const hudRect = elements.hud.getBoundingClientRect()
      const hudLeft = hudRect.width ? hudRect.left : defaultHudRect.left
      const hudTop = hudRect.height ? hudRect.top : defaultHudRect.top
      if (name === 'hud') {
        return {
          left: (viewport.width - elementSize.width) / 2,
          top: viewport.height - elementSize.height - 28
        }
      }
      if (name === 'delta') return { left: hudLeft, top: hudTop - elementSize.height - 10 }
      return { left: hudLeft, top: hudTop }
    }

    function ensurePosition(name) {
      const map = positionMap(name)
      if (map[name]) return map[name]
      const viewport = getViewport()
      const elementSize = getElementSize(elements[name], getFallbackSize(name, viewport))
      const anchor = getDefaultAnchor(name, elementSize, viewport)
      const available = getAvailableSize(viewport, elementSize)
      map[name] = { x: available.width > 0 ? clamp(anchor.left / available.width, 0, 1) : 0, y: available.height > 0 ? clamp(anchor.top / available.height, 0, 1) : 0, size: DEFAULT_SIZE }
      return map[name]
    }

    function applyWidgetScale(name) {
      const scale = String(getWidgetScaleFactor(name))
      if (name === 'hud') elements.hud.style.setProperty('--hud-user-scale', scale)
      if (name === 'delta') elements.delta.style.setProperty('--delta-user-scale', scale)
      if (isFreeformTarget(name)) elements[name].style.setProperty('--hud-widget-scale', scale)
    }

    function syncHudFrameSize() {
      if (mode !== 'grouped') return
      applyWidgetScale('hud')
      const hudRect = hud.getBoundingClientRect()
      if (!hudRect.width || !hudRect.height) return
      elements.hud.style.width = `${Math.round(hudRect.width)}px`
      elements.hud.style.height = `${Math.round(hudRect.height)}px`
    }

    function syncEditorToolbar(name, rect) {
      const targetTools = tools[name]
      if (!targetTools || targetTools.root.hidden) return
      const viewport = getViewport()
      const toolbarRect = targetTools.root.getBoundingClientRect()
      const toolbarPosition = calculateEditorToolbarPosition(rect, toolbarRect, viewport)
      targetTools.root.style.left = `${toolbarPosition.left - rect.left}px`
      targetTools.root.style.top = `${toolbarPosition.top - rect.top}px`
    }

    function syncEditorFrame(name) {
      const targetTools = tools[name]
      const editorFrame = targetTools?.editorFrame
      if (!editorFrame || editorFrame.hidden || !isFreeformTarget(name)) return
      const rect = elements[name].getBoundingClientRect()
      editorFrame.style.left = `${rect.left}px`
      editorFrame.style.top = `${rect.top}px`
      editorFrame.style.width = `${rect.width}px`
      editorFrame.style.height = `${rect.height}px`
      syncEditorToolbar(name, rect)
    }

    function applyVisibility() {
      if (typeof globalScope.HudPreferences?.apply === 'function') globalScope.HudPreferences.apply()
      else refreshLayout()
    }

    function applyPosition(name) {
      const element = elements[name]
      if (element.hidden) return
      const viewport = getViewport()
      const position = ensurePosition(name)
      if (isFreeformTarget(name)) {
        applyWidgetScale(name)
        element.style.width = `${COLUMN_WIDTHS[name]}px`
        element.style.height = `${HUD_BASE_HEIGHT}px`
        const elementSize = getElementSize(element, getFallbackSize(name, viewport))
        const available = getAvailableSize(viewport, elementSize)
        element.classList.add('layout-positioned')
        element.style.left = `${Math.round(available.width * position.x)}px`
        element.style.top = `${Math.round(available.height * position.y)}px`
        syncEditorFrame(name)
        return
      }
      applyWidgetScale(name)
      const elementSize = getElementSize(element, getFallbackSize(name, viewport))
      const available = getAvailableSize(viewport, elementSize)
      element.classList.add('layout-positioned')
      element.style.left = `${Math.round(available.width * position.x)}px`
      element.style.top = `${Math.round(available.height * position.y)}px`
      if (name === 'hud') syncEditorToolbar(name, element.getBoundingClientRect())
    }

    function syncGrid() {
      const grid = document.getElementById('layout-grid')
      if (!grid) return
      grid.hidden = !(sessionTargets.length && snapEnabled)
      if (grid.hidden) return
      const gridData = HudGrid.computeGrid(getViewport())
      grid.style.setProperty('--layout-grid-step', `${gridData.step}px`)
      grid.style.setProperty('--layout-grid-offset-x', `${gridData.offsetX}px`)
      grid.style.setProperty('--layout-grid-offset-y', `${gridData.offsetY}px`)
    }

    function refreshLayout() {
      if (mode === 'grouped') {
        syncHudFrameSize()
        applyPosition('hud')
      } else {
        FREEFORM_TARGETS.forEach(applyPosition)
      }
      applyPosition('delta')
      syncGrid()
    }
    function applyMode() {
      hud.dataset.layoutMode = mode
      elements.hud.dataset.layoutMode = mode
      for (const name of FREEFORM_TARGETS) {
        const element = elements[name]
        if (mode === 'freeform') element.classList.add('hud-freeform-widget')
        else {
          element.classList.remove('hud-freeform-widget', 'layout-positioned')
          element.style.left = ''; element.style.top = ''; element.style.width = ''; element.style.height = ''; element.style.removeProperty('--hud-widget-scale')
        }
      }
      if (mode === 'freeform') {
        elements.hud.classList.remove('layout-positioned')
        elements.hud.style.left = ''
        elements.hud.style.top = ''
        elements.hud.style.width = ''
        elements.hud.style.height = ''
      }
      refreshLayout()
    }
    function persist() {
      saveStoredLayout({
        shared: positions.shared,
        grouped: positions.grouped,
        freeform: positions.freeform
      })
    }

    function setToolsVisible(name, visible) {
      const targetTools = createTools(name)
      targetTools.root.hidden = !visible
      if (targetTools.editorFrame) {
        targetTools.editorFrame.hidden = !visible
        if (visible) syncEditorFrame(name)
      }
    }

    function updateSnapButtons() {
      const pressed = snapEnabled ? 'true' : 'false'
      for (const targetTools of Object.values(tools)) {
        if (targetTools?.snap) {
          targetTools.snap.setAttribute('aria-pressed', pressed)
        }
      }
    }

    function setSnapEnabled(enabled) {
      snapEnabled = enabled === true
      storageSet(SNAP_STORAGE_KEY, snapEnabled ? 'on' : 'off')
      updateSnapButtons()
      syncGrid()
    }

    function finishEdit() {
      if (!sessionTargets.length) return
      const previousSelected = selectedTarget
      dragging = false
      resizing = false
      resizeHandle = null
      resizeSnapshot = null
      for (const name of sessionTargets) {
        elements[name].classList.remove('is-editing', 'is-selected')
        const targetTools = tools[name]
        if (targetTools?.editorFrame) targetTools.editorFrame.classList.remove('is-selected')
        setToolsVisible(name, false)
        elements[name].setAttribute('aria-grabbed', 'false')
      }
      document.body.classList.remove('is-editing')
      document.body.removeAttribute('data-editing-target')
      dragTarget = null
      sessionTargets = []
      selectedTarget = null
      sessionSnapshot = null
      setNativeInteraction(false)
      if (previousSelected) notifySettingsEditingState(previousSelected, false)
      applyVisibility()
      syncGrid()
    }

    function notifySettingsEditingState(name, editing) {
      const invoke = globalScope.__TAURI_INTERNALS__?.invoke
      if (typeof invoke !== 'function') return Promise.resolve()
      return Promise.resolve(invoke('notify_layout_state', { target: name, editing })).catch(() => {})
    }

    function copyPositions() {
      const copyMap = map => Object.fromEntries(Object.entries(map).map(([name, position]) => [name, { ...position }]))
      return { shared: copyMap(positions.shared), grouped: copyMap(positions.grouped), freeform: copyMap(positions.freeform) }
    }

    function startSession(targets, selected) {
      if (sessionTargets.length || !targets.length) return
      sessionSnapshot = copyPositions()
      sessionTargets = targets
      for (const name of targets) {
        elements[name].classList.add('is-editing')
        const targetTools = tools[name]
        if (targetTools?.editorFrame) targetTools.editorFrame.hidden = false
      }
      document.body.classList.add('is-editing')
      setNativeInteraction(true)
      // Targets hidden by telemetry become visible first, so the selection measures real rects.
      applyVisibility()
      selectTarget(selected)
      refreshLayout()
    }

    function selectTarget(name) {
      if (!sessionTargets.includes(name)) return
      if (selectedTarget === name) return
      if (selectedTarget) {
        elements[selectedTarget].classList.remove('is-selected')
        const targetTools = tools[selectedTarget]
        if (targetTools?.editorFrame) targetTools.editorFrame.classList.remove('is-selected')
        setToolsVisible(selectedTarget, false)
      }
      selectedTarget = name
      elements[name].classList.add('is-selected')
      const targetTools = tools[name]
      if (targetTools?.editorFrame) targetTools.editorFrame.classList.add('is-selected')
      document.body.dataset.editingTarget = name
      setToolsVisible(name, true)
      notifySettingsEditingState(name, true)
      syncEditorFrame(name)
      const rect = elements[name].getBoundingClientRect()
      syncEditorToolbar(name, rect)
    }

    function editableTargets() {
      return globalScope.HudPreferences?.getEditableTargets?.() ||
        (mode === 'grouped' ? ['hud', 'delta'] : [...FREEFORM_TARGETS, 'delta'])
    }

    function enterEditMode(name = 'hud') {
      const unavailableGroupedTarget = name === 'hud' && mode !== 'grouped'
      const unavailableFreeformTarget = FREEFORM_TARGETS.includes(name) && mode !== 'freeform'
      if (!TARGET_NAMES.includes(name) || unavailableGroupedTarget || unavailableFreeformTarget) return
      if (!sessionTargets.length) {
        const targets = editableTargets()
        if (!targets.includes(name)) targets.push(name)
        startSession(targets, name)
      } else {
        if (!sessionTargets.includes(name)) {
          sessionTargets.push(name)
          elements[name].classList.add('is-editing')
          const targetTools = tools[name]
          if (targetTools?.editorFrame) targetTools.editorFrame.hidden = false
          applyVisibility()
        }
        selectTarget(name)
      }
    }

    function savePosition() {
      if (!sessionTargets.length) return
      persist()
      finishEdit()
    }

    function cancelEditMode() {
      if (!sessionTargets.length) return
      if (sessionSnapshot) Object.assign(positions, sessionSnapshot)
      finishEdit()
      refreshLayout()
    }

    function resetPosition(name = selectedTarget || 'hud') {
      if (!TARGET_NAMES.includes(name)) return
      delete positionMap(name)[name]
      if (!sessionTargets.includes(name)) persist()
      refreshLayout()
    }

    function toggleEditSession() {
      if (sessionTargets.length) {
        savePosition()
        return 'saved'
      }
      const targets = editableTargets()
      if (!targets.length) return 'unavailable'
      startSession(targets, targets[0])
      return 'started'
    }

    function resetLayout(targetMode = mode) {
      if (!MODES.includes(targetMode)) return
      if (sessionTargets.length) cancelEditMode()
      if (targetMode === 'grouped') positions.grouped = {}
      else positions.freeform = {}
      persist()
      refreshLayout()
    }
    function setMode(nextMode) {
      if (!MODES.includes(nextMode) || nextMode === mode) return mode
      if (sessionTargets.length) cancelEditMode()
      mode = nextMode
      storageSet(MODE_STORAGE_KEY, mode)
      persist()
      applyMode()
      globalScope.HudPreferences?.apply?.()
      globalScope.HudOverlay?.refresh?.()
      return mode
    }

    function startDrag(name, event) {
      if (!sessionTargets.includes(name) || event.button !== 0 || event.target.closest('button, .layout-edit-tools')) return
      if (selectedTarget !== name) selectTarget(name)
      const rect = elements[name].getBoundingClientRect()
      dragOffsetX = event.clientX - rect.left
      dragOffsetY = event.clientY - rect.top
      dragging = true
      dragTarget = name
      elements[name].setAttribute('aria-grabbed', 'true')
      elements[name].setPointerCapture?.(event.pointerId)
      event.preventDefault()
    }

    function updateFromPointer(clientX, clientY) {
      if (!dragTarget) return
      const name = dragTarget
      const element = elements[name]
      const viewport = getViewport()
      const size = getElementSize(element, getFallbackSize(name, viewport))
      const available = getAvailableSize(viewport, size)
      let left = clientX - dragOffsetX
      let top = clientY - dragOffsetY
      // Only moving snaps; resizing stays free.
      if (snapEnabled) ({ left, top } = HudGrid.snapRect({ left, top, width: size.width, height: size.height }, viewport))
      const map = positionMap(name)
      map[name] = {
        x: available.width > 0 ? clamp(left / available.width, 0, 1) : 0,
        y: available.height > 0 ? clamp(top / available.height, 0, 1) : 0,
        size: getWidgetSize(name)
      }
      applyPosition(name)
    }

    function finishDrag(event) {
      if (!dragging || !dragTarget) return
      dragging = false
      elements[dragTarget].setAttribute('aria-grabbed', 'false')
      elements[dragTarget].releasePointerCapture?.(event.pointerId)
      dragTarget = null
    }

    function startWidgetResize(event) {
      const name = event.currentTarget.dataset.layoutResizeTarget
      if (selectedTarget !== name || event.button !== 0) return
      resizeHandle = event.currentTarget.dataset.layoutResizeHandle
      const rect = elements[name].getBoundingClientRect()
      const factor = getWidgetScaleFactor(name)
      resizeSnapshot = {
        name,
        rect,
        baseSize: { width: rect.width / factor, height: rect.height / factor },
        startX: event.clientX,
        startY: event.clientY
      }
      resizing = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
    }
    function updateWidgetSizeFromPointer(clientX, clientY) {
      if (!resizing || !resizeSnapshot) return
      const { name, rect, baseSize } = resizeSnapshot
      const horizontalDirection = resizeHandle.includes('left') ? -1 : 1
      const verticalDirection = resizeHandle.includes('top') ? -1 : 1
      const widthFromPointer = rect.width + (clientX - resizeSnapshot.startX) * horizontalDirection
      const heightFromPointer = rect.height + (clientY - resizeSnapshot.startY) * verticalDirection
      const widthScale = baseSize.width > 0 ? widthFromPointer / baseSize.width : 1
      const heightScale = baseSize.height > 0 ? heightFromPointer / baseSize.height : 1
      const current = getWidgetScaleFactor(name)
      const requested = Math.abs(widthScale - current) >= Math.abs(heightScale - current)
        ? widthScale
        : heightScale
      const viewport = getViewport()
      const maximum = Math.max(
        MIN_WIDGET_SIZE,
        Math.min(
          MAX_WIDGET_SIZE,
          baseSize.width > 0 ? viewport.width / baseSize.width : MAX_WIDGET_SIZE,
          baseSize.height > 0 ? viewport.height / baseSize.height : MAX_WIDGET_SIZE
        )
      )
      const map = positionMap(name)
      map[name] = { ...ensurePosition(name), size: clamp(requested, MIN_WIDGET_SIZE, maximum) }

      if (name === 'hud') syncHudFrameSize()
      applyPosition(name)

      const nextSize = getElementSize(elements[name], getFallbackSize(name, viewport))
      const fixedRight = rect.left + rect.width
      const fixedBottom = rect.top + rect.height
      const left = horizontalDirection < 0 ? fixedRight - nextSize.width : rect.left
      const top = verticalDirection < 0 ? fixedBottom - nextSize.height : rect.top
      const available = getAvailableSize(viewport, nextSize)
      map[name].x = available.width > 0 ? clamp(left / available.width, 0, 1) : 0
      map[name].y = available.height > 0 ? clamp(top / available.height, 0, 1) : 0
      applyPosition(name)
      globalScope.HudOverlay?.refresh?.()
    }

    function finishWidgetResize(event) {
      if (!resizing) return
      resizing = false
      resizeHandle = null
      resizeSnapshot = null
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }

    for (const name of TARGET_NAMES) {
      const targetTools = createTools(name)
      const element = elements[name]
      element.addEventListener('pointerdown', event => startDrag(name, event))
      element.addEventListener('pointermove', event => {
        if (dragging) updateFromPointer(event.clientX, event.clientY)
        if (resizing) updateWidgetSizeFromPointer(event.clientX, event.clientY)
      })
      element.addEventListener('pointerup', finishDrag)
      element.addEventListener('pointercancel', () => {
        dragging = false
        dragTarget = null
        resizing = false
        element.setAttribute('aria-grabbed', 'false')
      })
      targetTools.reset?.addEventListener('click', () => resetPosition(name))
      targetTools.cancel?.addEventListener('click', cancelEditMode)
      targetTools.save?.addEventListener('click', savePosition)
      targetTools.snap?.addEventListener('click', () => setSnapEnabled(!snapEnabled))
    }
    updateSnapButtons()
    for (const handle of document.querySelectorAll('[data-layout-resize-handle]')) {
      handle.addEventListener('pointerdown', startWidgetResize)
      handle.addEventListener('pointermove', event => updateWidgetSizeFromPointer(event.clientX, event.clientY))
      handle.addEventListener('pointerup', finishWidgetResize)
      handle.addEventListener('pointercancel', finishWidgetResize)
    }

    window.addEventListener('resize', refreshLayout)
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && sessionTargets.length) {
        event.preventDefault()
        cancelEditMode()
      }
    })
    applyMode()

    const api = {
      enterEditMode,
      savePosition,
      cancelEditMode,
      resetPosition,
      resetLayout,
      setMode,
      getMode: () => mode,
      getEditingTarget: () => selectedTarget,
      getEditingTargets: () => [...sessionTargets],
      isEditing: name => sessionTargets.includes(name),
      toggleEditSession,
      refreshPosition: refreshLayout,
      refreshLayout,
      getPosition: name => ({ ...(positionMap(name)[name] || ensurePosition(name)) }),
      isSnapEnabled: () => snapEnabled,
      setSnapEnabled
    }
    if (new URLSearchParams(window.location.search).get('edit') === '1') {
      window.requestAnimationFrame(() => enterEditMode('hud'))
    }
    return api
  }

  const api = {
    clamp,
    clampPosition,
    sanitizePosition,
    sanitizeWidgetSize,
    calculateEditorToolbarPosition,
    readStoredLayout,
    STORAGE_KEY,
    MODE_STORAGE_KEY,
    SNAP_STORAGE_KEY,
    MODES,
    GROUPED_TARGETS,
    FREEFORM_TARGETS
  }
  if (typeof document !== 'undefined') { const layout = createLayout(); if (layout) Object.assign(api, layout) }
  if (typeof globalScope !== 'undefined') globalScope.HudLayout = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
