(function (globalScope) {
  'use strict'

  const VISIBILITY_STORAGE_KEY = 'forza-horizon-6-hud.hud-visibility.v1'
  const COMPONENTS = ['tires', 'pedals', 'steering', 'gear', 'history']
  const DEFAULT_VISIBILITY = COMPONENTS.reduce((state, name) => {
    state[name] = true
    return state
  }, {})
  const invoke = globalScope.__TAURI_INTERNALS__?.invoke
  const status = document.getElementById('settings-status')
  let editingTarget = null

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

  globalScope.SettingsController = { cancelEdit, setLayoutEditingState }
})(typeof globalThis === 'undefined' ? this : globalThis)
