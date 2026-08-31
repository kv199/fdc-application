(function (globalScope) {
  'use strict'

  const STORAGE_KEY = 'fdc.layout.v1'
  const TARGET_NAMES = ['coach', 'delta', 'hud']
  const HUD_DEFAULT_SIZE = 0
  const MIN_HUD_SIZE = 0.5
  const MAX_HUD_SIZE = 2

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

  function sanitizeHudSize(raw) {
    const size = Number(raw)
    if (!Number.isFinite(size) || size <= HUD_DEFAULT_SIZE) return HUD_DEFAULT_SIZE
    return clamp(size, MIN_HUD_SIZE, MAX_HUD_SIZE)
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

  function readStoredPositions() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      const positions = raw && typeof raw === 'object'
        ? TARGET_NAMES.reduce((result, name) => {
          const position = sanitizePosition(raw[name])
          if (position) {
            result[name] = position
            if (name === 'hud') result[name].size = sanitizeHudSize(raw[name].size)
          }
          return result
        }, {})
        : {}
      return positions
    } catch {
      return {}
    }
  }

  function saveStoredPositions(positions) {
    try {
      const safePositions = TARGET_NAMES.reduce((result, name) => {
        if (positions[name]) {
          result[name] = clampPosition(positions[name])
          if (name === 'hud') result[name].size = sanitizeHudSize(positions[name].size)
        }
        return result
      }, {})
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safePositions))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
  }

  function removeStoredPosition(positions, name) {
    delete positions[name]
    saveStoredPositions(positions)
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
      hud: document.getElementById('hud-frame')
    }
    const hud = document.getElementById('hud')
    if (!elements.coach || !elements.delta || !elements.hud || !hud) return null

    const tools = {
      coach: {
        root: document.getElementById('coach-edit-tools'),
        reset: document.getElementById('coach-reset'),
        cancel: document.getElementById('coach-cancel'),
        save: document.getElementById('coach-save')
      },
      delta: {
        root: document.getElementById('delta-edit-tools'),
        reset: document.getElementById('delta-reset'),
        cancel: document.getElementById('delta-cancel'),
        save: document.getElementById('delta-save')
      },
      hud: {
        root: document.getElementById('hud-edit-tools'),
        reset: document.getElementById('hud-reset'),
        cancel: document.getElementById('hud-cancel'),
        save: document.getElementById('hud-save')
      }
    }
    if (Object.values(tools).some(tool => Object.values(tool).some(value => !value))) return null

    let positions = readStoredPositions()
    let editingTarget = null
    let editingSnapshot = null
    let targetWasHidden = false
    let dragging = false
    let dragOffsetX = 0
    let dragOffsetY = 0
    let resizing = false
    let resizeHandle = null
    let resizeSnapshot = null

    function notifySettingsEditingState(name, editing) {
      const invoke = globalScope.__TAURI_INTERNALS__?.invoke
      if (typeof invoke !== 'function') return Promise.resolve()
      return Promise.resolve(invoke('notify_layout_state', { target: name, editing })).catch(() => {})
    }

    function syncHudFrameSize() {
      const hudRect = hud.getBoundingClientRect()
      if (!hudRect.width || !hudRect.height) return
      elements.hud.style.width = `${Math.round(hudRect.width)}px`
      elements.hud.style.height = `${Math.round(hudRect.height)}px`
      elements.delta.style.width = `${Math.round(hudRect.width)}px`
    }

    function getHudSize() {
      return sanitizeHudSize(positions.hud?.size)
    }

    function getHudScaleFactor() {
      const size = getHudSize()
      return size === HUD_DEFAULT_SIZE ? 1 : size
    }

    function applyHudSize() {
      hud.style.setProperty('--hud-user-scale', String(getHudScaleFactor()))
    }

    function getHudBaseSize() {
      const rendered = getElementSize(hud, getFallbackSize('hud', getViewport()))
      const factor = getHudScaleFactor()
      return {
        width: factor > 0 ? rendered.width / factor : rendered.width,
        height: factor > 0 ? rendered.height / factor : rendered.height
      }
    }

    function getMaximumHudSize() {
      const viewport = getViewport()
      const baseSize = getHudBaseSize()
      const widthLimit = baseSize.width > 0 ? viewport.width / baseSize.width : MAX_HUD_SIZE
      const heightLimit = baseSize.height > 0 ? viewport.height / baseSize.height : MAX_HUD_SIZE
      return Math.max(MIN_HUD_SIZE, Math.min(MAX_HUD_SIZE, widthLimit, heightLimit))
    }

    function getFallbackSize(name, viewport) {
      if (name === 'coach') return { width: Math.min(460, Math.max(0, viewport.width - 24)), height: 88 }
      if (name === 'delta') return { width: Math.min(1472, Math.max(0, viewport.width - 16)), height: 60 }
      return { width: Math.min(1472, Math.max(0, viewport.width - 16)), height: 138 }
    }

    function getDefaultAnchor(name, elementSize, viewport) {
      const hudRect = elements.hud.getBoundingClientRect()
      const hudSize = getElementSize(elements.hud, getFallbackSize('hud', viewport))
      const hudLeft = hudRect.width ? hudRect.left : (viewport.width - hudSize.width) / 2
      const hudTop = hudRect.height ? hudRect.top : viewport.height - hudSize.height - 28

      if (name === 'hud') return { left: hudLeft, top: hudTop }
      if (name === 'delta') return { left: hudLeft, top: hudTop - elementSize.height - 10 }
      const deltaSize = getElementSize(elements.delta, getFallbackSize('delta', viewport))
      return { left: hudLeft, top: hudTop - deltaSize.height - elementSize.height - 20 }
    }

    function ensurePosition(name) {
      if (positions[name]) return positions[name]

      const viewport = getViewport()
      const fallback = getFallbackSize(name, viewport)
      const elementSize = getElementSize(elements[name], fallback)
      const anchor = getDefaultAnchor(name, elementSize, viewport)
      const available = getAvailableSize(viewport, elementSize)
      positions[name] = {
        x: available.width > 0 ? clamp(anchor.left / available.width, 0, 1) : 0,
        y: available.height > 0 ? clamp(anchor.top / available.height, 0, 1) : 0
      }
      if (name === 'hud') positions[name].size = HUD_DEFAULT_SIZE
      return positions[name]
    }

    function applyPosition(name) {
      const element = elements[name]
      if (element.hidden && name !== editingTarget) return

      if (name === 'hud') applyHudSize()

      const viewport = getViewport()
      const elementSize = getElementSize(element, getFallbackSize(name, viewport))
      const available = getAvailableSize(viewport, elementSize)
      const position = ensurePosition(name)
      const left = available.width * position.x
      const top = available.height * position.y
      element.classList.add('layout-positioned')
      element.style.left = `${Math.round(left)}px`
      element.style.top = `${Math.round(top)}px`
    }

    function refreshLayout() {
      applyHudSize()
      syncHudFrameSize()
      applyPosition('hud')
      syncHudFrameSize()
      applyPosition('delta')
      applyPosition('coach')
    }

    function persistPosition(name) {
      positions[name] = clampPosition(positions[name])
      if (name === 'hud') positions[name].size = getHudSize()
      saveStoredPositions(positions)
    }

    function setToolsVisible(name, visible) {
      tools[name].root.hidden = !visible
    }

    function restoreTemporaryVisibility() {
      if (
        editingTarget === 'coach'
        && targetWasHidden
        && elements.coach.dataset.hasCoachGuidance !== 'true'
      ) {
        elements.coach.hidden = true
      }
      targetWasHidden = false
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
      restoreTemporaryVisibility()
      editingTarget = null
      editingSnapshot = null
      elements[name].setAttribute('aria-grabbed', 'false')
      setNativeInteraction(false)
      notifySettingsEditingState(name, false)
      refreshLayout()
    }

    function enterEditMode(name = 'coach') {
      if (!TARGET_NAMES.includes(name)) return
      if (editingTarget === name) return
      if (editingTarget) cancelEditMode()

      if (name === 'coach' && elements.coach.hidden) {
        targetWasHidden = true
        elements.coach.hidden = false
      }

      syncHudFrameSize()
      applyPosition(name)
      editingTarget = name
      editingSnapshot = positions[name] ? { ...positions[name] } : null
      elements[name].classList.add('is-editing')
      elements[name].setAttribute('aria-grabbed', 'false')
      setToolsVisible(name, true)
      document.body.classList.add('is-editing')
      document.body.dataset.editingTarget = name
      setNativeInteraction(true)
      notifySettingsEditingState(name, true)
    }

    function savePosition() {
      if (!editingTarget) return
      persistPosition(editingTarget)
      finishEdit()
    }

    function cancelEditMode() {
      if (!editingTarget) return
      const name = editingTarget
      if (editingSnapshot) positions[name] = { ...editingSnapshot }
      else delete positions[name]
      finishEdit()
      applyPosition(name)
    }

    function resetPosition(name = editingTarget || 'coach') {
      if (!TARGET_NAMES.includes(name)) return
      removeStoredPosition(positions, name)
      refreshLayout()
      if (editingTarget === name) {
        editingSnapshot = null
        return
      }
    }

    function updateFromPointer(clientX, clientY) {
      if (!editingTarget) return
      const name = editingTarget
      const element = elements[name]
      const hudSize = name === 'hud' ? getHudSize() : null
      const viewport = getViewport()
      const elementSize = getElementSize(element, getFallbackSize(name, viewport))
      const available = getAvailableSize(viewport, elementSize)
      const left = clientX - dragOffsetX
      const top = clientY - dragOffsetY
      positions[name] = {
        x: available.width > 0 ? clamp(left / available.width, 0, 1) : 0,
        y: available.height > 0 ? clamp(top / available.height, 0, 1) : 0
      }
      if (name === 'hud') positions[name].size = hudSize
      applyPosition(name)
    }

    function updateHudSizeFromPointer(clientX, clientY) {
      if (!resizing || editingTarget !== 'hud' || !resizeSnapshot || !resizeHandle) return

      const { rect, baseSize } = resizeSnapshot
      const horizontalDirection = resizeHandle.includes('left') ? -1 : 1
      const verticalDirection = resizeHandle.includes('top') ? -1 : 1
      const widthFromPointer = rect.width + (clientX - resizeSnapshot.startX) * horizontalDirection
      const heightFromPointer = rect.height + (clientY - resizeSnapshot.startY) * verticalDirection
      const widthScale = baseSize.width > 0 ? widthFromPointer / baseSize.width : 1
      const heightScale = baseSize.height > 0 ? heightFromPointer / baseSize.height : 1
      const currentSize = getHudScaleFactor()
      const requestedSize = Math.abs(widthScale - currentSize) >= Math.abs(heightScale - currentSize)
        ? widthScale
        : heightScale
      const size = clamp(requestedSize, MIN_HUD_SIZE, getMaximumHudSize())

      positions.hud = {
        ...ensurePosition('hud'),
        size
      }
      applyHudSize()

      const nextSize = getElementSize(hud, getFallbackSize('hud', getViewport()))
      const viewport = getViewport()
      const fixedRight = rect.left + rect.width
      const fixedBottom = rect.top + rect.height
      const left = horizontalDirection < 0 ? fixedRight - nextSize.width : rect.left
      const top = verticalDirection < 0 ? fixedBottom - nextSize.height : rect.top
      const available = getAvailableSize(viewport, nextSize)
      positions.hud.x = available.width > 0 ? clamp(left / available.width, 0, 1) : 0
      positions.hud.y = available.height > 0 ? clamp(top / available.height, 0, 1) : 0
      applyPosition('hud')
      syncHudFrameSize()
      applyPosition('delta')
      applyPosition('coach')
    }

    function startDrag(name, event) {
      if (
        editingTarget !== name
        || event.button !== 0
        || event.target.closest('button, [data-layout-resize-handle], .layout-edit-tools, .coach-edit-tools')
      ) return
      const rect = elements[name].getBoundingClientRect()
      dragOffsetX = event.clientX - rect.left
      dragOffsetY = event.clientY - rect.top
      dragging = true
      elements[name].setAttribute('aria-grabbed', 'true')
      elements[name].setPointerCapture?.(event.pointerId)
      event.preventDefault()
    }

    function moveDrag(event) {
      if (!dragging) return
      updateFromPointer(event.clientX, event.clientY)
    }

    function finishDrag(event) {
      if (!dragging || !editingTarget) return
      const name = editingTarget
      dragging = false
      elements[name].setAttribute('aria-grabbed', 'false')
      elements[name].releasePointerCapture?.(event.pointerId)
    }

    function startHudResize(event) {
      if (editingTarget !== 'hud' || event.button !== 0) return
      const handle = event.currentTarget.dataset.layoutResizeHandle
      if (!handle) return
      const rect = elements.hud.getBoundingClientRect()
      resizeHandle = handle
      resizeSnapshot = {
        rect,
        baseSize: getHudBaseSize(),
        startX: event.clientX,
        startY: event.clientY
      }
      resizing = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
    }

    function moveHudResize(event) {
      if (!resizing) return
      updateHudSizeFromPointer(event.clientX, event.clientY)
    }

    function finishHudResize(event) {
      if (!resizing) return
      resizing = false
      resizeHandle = null
      resizeSnapshot = null
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }

    for (const name of TARGET_NAMES) {
      elements[name].addEventListener('pointerdown', event => startDrag(name, event))
      elements[name].addEventListener('pointermove', moveDrag)
      elements[name].addEventListener('pointerup', finishDrag)
      elements[name].addEventListener('pointercancel', () => {
        dragging = false
        elements[name].setAttribute('aria-grabbed', 'false')
      })
      tools[name].reset.addEventListener('click', () => resetPosition(name))
      tools[name].cancel.addEventListener('click', cancelEditMode)
      tools[name].save.addEventListener('click', savePosition)
    }

    for (const handle of document.querySelectorAll('[data-layout-resize-handle]')) {
      handle.addEventListener('pointerdown', startHudResize)
      handle.addEventListener('pointermove', moveHudResize)
      handle.addEventListener('pointerup', finishHudResize)
      handle.addEventListener('pointercancel', finishHudResize)
    }

    window.addEventListener('resize', () => {
      refreshLayout()
      if (editingTarget) applyPosition(editingTarget)
    })

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        if (!dragging && !resizing) refreshLayout()
      })
    resizeObserver?.observe(hud)

    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && editingTarget) {
        event.preventDefault()
        cancelEditMode()
      }
    })

    refreshLayout()

    const api = {
      enterEditMode,
      savePosition,
      cancelEditMode,
      resetPosition,
      isEditing: name => editingTarget === name,
      refreshPosition: refreshLayout,
      refreshLayout,
      getPosition: name => ({ ...(positions[name] || ensurePosition(name)) })
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
    sanitizeHudSize
  }

  if (typeof document !== 'undefined') {
    const layout = createLayout()
    if (layout) Object.assign(api, layout)
  }

  if (typeof globalScope !== 'undefined') globalScope.HudLayout = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
