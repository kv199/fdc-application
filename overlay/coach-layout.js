(function (globalScope) {
  'use strict'

  const STORAGE_KEY = 'forza-horizon-6-hud.coach-position.v2'

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

  function getViewport() {
    return {
      width: Math.max(1, document.documentElement.clientWidth || window.innerWidth),
      height: Math.max(1, document.documentElement.clientHeight || window.innerHeight)
    }
  }

  function getElementSize(element) {
    const rect = element.getBoundingClientRect()
    return {
      width: Math.max(0, rect.width),
      height: Math.max(0, rect.height)
    }
  }

  function getAvailableSize(viewport, elementSize) {
    return {
      width: Math.max(0, viewport.width - elementSize.width),
      height: Math.max(0, viewport.height - elementSize.height)
    }
  }

  function defaultPosition(viewport, elementSize, anchorRect) {
    const available = getAvailableSize(viewport, elementSize)
    const left = (viewport.width - elementSize.width) / 2
    const top = Math.max(12, anchorRect.top - elementSize.height - 18)
    return {
      x: available.width > 0 ? clamp(left / available.width, 0, 1) : 0,
      y: available.height > 0 ? clamp(top / available.height, 0, 1) : 0
    }
  }

  function readStoredPosition() {
    try {
      return sanitizePosition(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'))
    } catch {
      return null
    }
  }

  function savePosition(position) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clampPosition(position)))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
  }

  function clearStoredPosition() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // A restricted webview may not expose persistent storage.
    }
  }

  function setNativeInteraction(enabled) {
    const invoke = globalScope.__TAURI_INTERNALS__?.invoke
    if (typeof invoke !== 'function') return Promise.resolve()
    return Promise.resolve(invoke('set_window_edit_mode', { enabled })).catch(() => {})
  }

  function createLayout() {
    const coachCard = document.getElementById('coach-card')
    const hudFrame = document.querySelector('.hud-frame')
    const editTools = document.getElementById('coach-edit-tools')
    const resetButton = document.getElementById('coach-reset')
    const doneButton = document.getElementById('coach-done')
    if (!coachCard || !hudFrame || !editTools || !resetButton || !doneButton) return null

    let position = readStoredPosition()
    let hasStoredPosition = position !== null
    let editing = false
    let dragging = false
    let dragOffsetX = 0
    let dragOffsetY = 0

    function getCurrentMetrics() {
      const viewport = getViewport()
      const elementSize = getElementSize(coachCard)
      return { viewport, elementSize, available: getAvailableSize(viewport, elementSize) }
    }

    function ensurePosition() {
      const { viewport, elementSize } = getCurrentMetrics()
      if (!position || !hasStoredPosition) {
        const anchorRect = hudFrame.getBoundingClientRect()
        position = defaultPosition(viewport, elementSize, anchorRect)
      } else {
        position = clampPosition(position)
      }
      return position
    }

    function applyPosition() {
      const metrics = getCurrentMetrics()
      position = ensurePosition()
      const left = metrics.available.width * position.x
      const top = metrics.available.height * position.y
      coachCard.style.left = `${Math.round(left)}px`
      coachCard.style.top = `${Math.round(top)}px`
    }

    function persistPosition() {
      hasStoredPosition = true
      savePosition(position)
    }

    function enterEditMode() {
      if (editing || coachCard.hidden) return
      applyPosition()
      editing = true
      document.body.classList.add('is-editing')
      coachCard.classList.add('is-editing')
      coachCard.setAttribute('aria-grabbed', 'false')
      editTools.hidden = false
      setNativeInteraction(true)
    }

    function exitEditMode() {
      if (!editing) return
      persistPosition()
      editing = false
      dragging = false
      document.body.classList.remove('is-editing')
      coachCard.classList.remove('is-editing')
      coachCard.setAttribute('aria-grabbed', 'false')
      editTools.hidden = true
      setNativeInteraction(false)
    }

    function resetPosition() {
      clearStoredPosition()
      hasStoredPosition = false
      position = null
      applyPosition()
      persistPosition()
    }

    function updateFromPointer(clientX, clientY) {
      const metrics = getCurrentMetrics()
      const left = clientX - dragOffsetX
      const top = clientY - dragOffsetY
      position = {
        x: metrics.available.width > 0 ? clamp(left / metrics.available.width, 0, 1) : 0,
        y: metrics.available.height > 0 ? clamp(top / metrics.available.height, 0, 1) : 0
      }
      applyPosition()
    }

    coachCard.addEventListener('pointerdown', event => {
      if (!editing || event.button !== 0 || event.target.closest('button')) return

      const rect = coachCard.getBoundingClientRect()
      dragOffsetX = event.clientX - rect.left
      dragOffsetY = event.clientY - rect.top
      dragging = true
      coachCard.setAttribute('aria-grabbed', 'true')
      coachCard.setPointerCapture?.(event.pointerId)
      event.preventDefault()
    })

    coachCard.addEventListener('pointermove', event => {
      if (!dragging) return
      updateFromPointer(event.clientX, event.clientY)
    })

    coachCard.addEventListener('pointerup', event => {
      if (!dragging) return
      dragging = false
      coachCard.setAttribute('aria-grabbed', 'false')
      coachCard.releasePointerCapture?.(event.pointerId)
      persistPosition()
    })

    coachCard.addEventListener('pointercancel', () => {
      dragging = false
      coachCard.setAttribute('aria-grabbed', 'false')
    })

    resetButton.addEventListener('click', resetPosition)
    doneButton.addEventListener('click', exitEditMode)

    window.addEventListener('resize', () => {
      applyPosition()
      if (hasStoredPosition) persistPosition()
    })

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        if (!dragging) applyPosition()
      })
    resizeObserver?.observe(coachCard)

    window.addEventListener('keydown', event => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        if (editing) exitEditMode()
        else enterEditMode()
        return
      }

      if (event.key === 'Escape' && editing) {
        event.preventDefault()
        exitEditMode()
      }
    })

    applyPosition()

    const api = {
      enterEditMode,
      exitEditMode,
      resetPosition,
      toggleEditMode: () => (editing ? exitEditMode() : enterEditMode()),
      isEditing: () => editing,
      refreshPosition: applyPosition,
      getPosition: () => ({ ...position })
    }

    if (new URLSearchParams(window.location.search).get('edit') === '1') {
      window.requestAnimationFrame(enterEditMode)
    }

    return api
  }

  const api = {
    clamp,
    clampPosition,
    sanitizePosition
  }

  if (typeof document !== 'undefined') {
    const layout = createLayout()
    if (layout) Object.assign(api, layout)
  }

  if (typeof globalScope !== 'undefined') globalScope.HudLayout = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
