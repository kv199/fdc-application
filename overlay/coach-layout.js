(function (globalScope) {
  'use strict'

  const STORAGE_KEY = 'fdc.layout.v2'
  const MODE_STORAGE_KEY = 'fdc.layout-mode.v1'
  const MODES = ['grouped', 'freeform']
  const GROUPED_TARGETS = ['coach', 'delta', 'hud']
  const FREEFORM_TARGETS = ['tires', 'pedals', 'steering', 'gear', 'engine', 'history']
  const TARGET_NAMES = [...GROUPED_TARGETS, ...FREEFORM_TARGETS]
  const COLUMN_WIDTHS = { tires: 72, pedals: 46, steering: 68, gear: 92, engine: 116, history: 342 }
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

  function readStoredMode() {
    const stored = storageGet(MODE_STORAGE_KEY)
    return MODES.includes(stored) ? stored : 'grouped'
  }

  function readStoredLayout() {
    try {
      const stored = JSON.parse(storageGet(STORAGE_KEY) || 'null')
      if (!stored || typeof stored !== 'object') {
        return { mode: readStoredMode(), shared: {}, grouped: {}, freeform: {} }
      }
      const sanitizeMap = (source, names) => names.reduce((result, name) => {
        const position = sanitizeTargetPosition(source?.[name])
        if (position) result[name] = position
        return result
      }, {})
      return {
        mode: readStoredMode(),
        shared: sanitizeMap(stored.shared, ['coach', 'delta']),
        grouped: sanitizeMap(stored.grouped, ['hud']),
        freeform: sanitizeMap(stored.freeform, FREEFORM_TARGETS)
      }
    } catch {
      return { mode: readStoredMode(), shared: {}, grouped: {}, freeform: {} }
    }
  }

  function saveStoredLayout(layout) {
    const sanitizeMap = (source, names) => names.reduce((result, name) => {
      const position = sanitizeTargetPosition(source?.[name])
      if (position) result[name] = position
      return result
    }, {})
    storageSet(STORAGE_KEY, JSON.stringify({
      version: 2,
      shared: sanitizeMap(layout.shared, ['coach', 'delta']),
      grouped: sanitizeMap(layout.grouped, ['hud']),
      freeform: sanitizeMap(layout.freeform, FREEFORM_TARGETS)
    }))
  }

  function setNativeInteraction(enabled) {
    const invoke = globalScope.__TAURI_INTERNALS__?.invoke
    if (typeof invoke !== 'function') return Promise.resolve()
    return Promise.resolve(invoke('set_window_edit_mode', { enabled })).catch(() => {})
  }

  function createLayout() {
    const elements = {
      coach: document.getElementById('coach-card'),
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
        tools[name] = { root: existingRoot, reset: document.getElementById(`${name}-reset`), cancel: document.getElementById(`${name}-cancel`), save: document.getElementById(`${name}-save`) }
        return tools[name]
      }
      const root = document.createElement('div')
      root.className = 'layout-edit-tools'
      root.hidden = true
      root.innerHTML = `<span class="layout-edit__hint">DRAG ${name.toUpperCase()} OR A CORNER TO RESIZE</span><button class="layout-edit__button" type="button">RESET</button><button class="layout-edit__button" type="button">CANCEL</button><button class="layout-edit__button layout-edit__button--primary" type="button">SAVE</button>`
      const editorFrame = FREEFORM_TARGETS.includes(name) ? document.createElement('div') : null
      const editorSurface = editorFrame || elements[name]
      if (editorFrame) {
        editorFrame.className = 'hud-widget-editor-frame'
        editorFrame.dataset.layoutEditorTarget = name
        editorFrame.hidden = true
        hud.append(editorFrame)
      }
      editorSurface.append(root)
      const buttons = [...root.querySelectorAll('button')]
      for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
        const handle = document.createElement('button')
        handle.className = `layout-resize-handle layout-resize-handle--${corner}`
        handle.type = 'button'
        handle.dataset.layoutResizeTarget = name
        handle.dataset.layoutResizeHandle = corner
        handle.setAttribute('aria-label', `Resize ${name} from ${corner} corner`)
        editorSurface.append(handle)
      }
      tools[name] = { root, editorFrame, reset: buttons[0], cancel: buttons[1], save: buttons[2] }
      return tools[name]
    }
    for (const name of TARGET_NAMES) createTools(name)

    const stored = readStoredLayout()
    let mode = stored.mode
    const positions = { shared: stored.shared, grouped: stored.grouped, freeform: stored.freeform }
    let editingTarget = null
    let editingSnapshot = null
    let targetWasHidden = false
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
      if (name === 'coach' || name === 'delta') return positions.shared
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
      if (name === 'coach') return { width: Math.min(460, Math.max(0, viewport.width - 24)), height: 88 }
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
      return { left: hudLeft, top: hudTop - 60 - elementSize.height - 20 }
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

    function applyPosition(name) {
      const element = elements[name]
      if (element.hidden) {
        if (name !== editingTarget) return
        element.hidden = false
      }
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

    function refreshLayout() {
      if (mode === 'grouped') {
        syncHudFrameSize()
        applyPosition('hud')
      } else {
        FREEFORM_TARGETS.forEach(applyPosition)
      }
      applyPosition('delta')
      applyPosition('coach')
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

    function finishEdit() {
      if (!editingTarget) return
      const name = editingTarget
      dragging = false
      resizing = false
      resizeHandle = null
      resizeSnapshot = null
      elements[name].classList.remove('is-editing')
      setToolsVisible(name, false)
      document.body.classList.remove('is-editing')
      document.body.removeAttribute('data-editing-target')
      if (targetWasHidden) elements[name].hidden = true
      targetWasHidden = false
      editingTarget = null
      editingSnapshot = null
      elements[name].setAttribute('aria-grabbed', 'false')
      setNativeInteraction(false)
      notifySettingsEditingState(name, false)
      globalScope.HudPreferences?.apply?.()
      refreshLayout()
    }

    function notifySettingsEditingState(name, editing) {
      const invoke = globalScope.__TAURI_INTERNALS__?.invoke
      if (typeof invoke !== 'function') return Promise.resolve()
      return Promise.resolve(invoke('notify_layout_state', { target: name, editing })).catch(() => {})
    }

    function enterEditMode(name = 'coach') {
      const unavailableGroupedTarget = name === 'hud' && mode !== 'grouped'
      const unavailableFreeformTarget = FREEFORM_TARGETS.includes(name) && mode !== 'freeform'
      if (!TARGET_NAMES.includes(name) || unavailableGroupedTarget || unavailableFreeformTarget) return
      if (editingTarget === name) return
      if (editingTarget) cancelEditMode()
      if (elements[name].hidden) {
        targetWasHidden = true
        elements[name].hidden = false
      }
      if (FREEFORM_TARGETS.includes(name)) {
        hud.hidden = false
        elements.hud.hidden = false
      }
      ensurePosition(name)
      editingTarget = name
      editingSnapshot = { ...positionMap(name)[name] }
      elements[name].classList.add('is-editing')
      elements[name].setAttribute('aria-grabbed', 'false')
      setToolsVisible(name, true)
      document.body.classList.add('is-editing')
      document.body.dataset.editingTarget = name
      setNativeInteraction(true)
      notifySettingsEditingState(name, true)
      refreshLayout()
    }

    function savePosition() {
      if (!editingTarget) return
      persist()
      finishEdit()
    }

    function cancelEditMode() {
      if (!editingTarget) return
      const name = editingTarget
      const map = positionMap(name)
      if (editingSnapshot) map[name] = { ...editingSnapshot }
      else delete map[name]
      finishEdit()
    }

    function resetPosition(name = editingTarget || 'coach') {
      if (!TARGET_NAMES.includes(name)) return
      delete positionMap(name)[name]
      persist()
      refreshLayout()
      if (editingTarget === name) editingSnapshot = null
    }

    function resetLayout(targetMode = mode) {
      if (!MODES.includes(targetMode)) return
      if (editingTarget) cancelEditMode()
      if (targetMode === 'grouped') positions.grouped = {}
      else positions.freeform = {}
      persist()
      refreshLayout()
    }
    function setMode(nextMode) {
      if (!MODES.includes(nextMode) || nextMode === mode) return mode
      if (editingTarget) cancelEditMode()
      mode = nextMode
      storageSet(MODE_STORAGE_KEY, mode)
      persist()
      applyMode()
      globalScope.HudPreferences?.apply?.()
      globalScope.HudOverlay?.refresh?.()
      return mode
    }

    function startDrag(name, event) {
      if (editingTarget !== name || event.button !== 0 || event.target.closest('button, .layout-edit-tools, .coach-edit-tools')) return
      const rect = elements[name].getBoundingClientRect()
      dragOffsetX = event.clientX - rect.left
      dragOffsetY = event.clientY - rect.top
      dragging = true
      elements[name].setAttribute('aria-grabbed', 'true')
      elements[name].setPointerCapture?.(event.pointerId)
      event.preventDefault()
    }

    function updateFromPointer(clientX, clientY) {
      if (!editingTarget) return
      const name = editingTarget
      const element = elements[name]
      const viewport = getViewport()
      const size = getElementSize(element, getFallbackSize(name, viewport))
      const available = getAvailableSize(viewport, size)
      const map = positionMap(name)
      map[name] = {
        x: available.width > 0 ? clamp((clientX - dragOffsetX) / available.width, 0, 1) : 0,
        y: available.height > 0 ? clamp((clientY - dragOffsetY) / available.height, 0, 1) : 0,
        size: getWidgetSize(name)
      }
      applyPosition(name)
    }

    function finishDrag(event) {
      if (!dragging || !editingTarget) return
      dragging = false
      elements[editingTarget].setAttribute('aria-grabbed', 'false')
      elements[editingTarget].releasePointerCapture?.(event.pointerId)
    }

    function startWidgetResize(event) {
      const name = event.currentTarget.dataset.layoutResizeTarget
      if (editingTarget !== name || event.button !== 0) return
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
        resizing = false
        element.setAttribute('aria-grabbed', 'false')
      })
      targetTools.reset?.addEventListener('click', () => resetPosition(name))
      targetTools.cancel?.addEventListener('click', cancelEditMode)
      targetTools.save?.addEventListener('click', savePosition)
    }
    for (const handle of document.querySelectorAll('[data-layout-resize-handle]')) {
      handle.addEventListener('pointerdown', startWidgetResize)
      handle.addEventListener('pointermove', event => updateWidgetSizeFromPointer(event.clientX, event.clientY))
      handle.addEventListener('pointerup', finishWidgetResize)
      handle.addEventListener('pointercancel', finishWidgetResize)
    }

    window.addEventListener('resize', refreshLayout)
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && editingTarget) {
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
      isEditing: name => editingTarget === name,
      refreshPosition: refreshLayout,
      refreshLayout,
      getPosition: name => ({ ...(positionMap(name)[name] || ensurePosition(name)) })
    }
    if (new URLSearchParams(window.location.search).get('edit') === '1') {
      window.requestAnimationFrame(() => enterEditMode('coach'))
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
    MODES,
    GROUPED_TARGETS,
    FREEFORM_TARGETS
  }
  if (typeof document !== 'undefined') { const layout = createLayout(); if (layout) Object.assign(api, layout) }
  if (typeof globalScope !== 'undefined') globalScope.HudLayout = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
