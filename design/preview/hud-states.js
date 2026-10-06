/**
 * HUD Preview Script - Sets the HUD DOM into representative visual states
 * for screenshot/design purposes without calling Tauri or requiring telemetry.
 *
 * Usage:
 *   hudPreview.set('grouped-live')  // Apply a state
 *   console.log(hudPreview.states)   // List available states
 */

(function (globalScope) {
  'use strict'

  // Stop the runtime from interfering with our DOM changes
  // Disable requestAnimationFrame callback loop
  let rafId = null
  const originalRAF = globalScope.requestAnimationFrame
  globalScope.requestAnimationFrame = () => {
    // Do nothing; no-op to prevent render loops
    return 0
  }

  // Clear all existing intervals
  for (let id = 1; id < 10000; id++) {
    clearInterval(id)
  }

  // Clear all existing timeouts
  for (let id = 1; id < 10000; id++) {
    clearTimeout(id)
  }

  // Get element references
  const hud = document.getElementById('hud')
  const deltaStrip = document.getElementById('delta-strip')
  const tireElements = {
    fl: document.getElementById('tire-fl'),
    fr: document.getElementById('tire-fr'),
    rl: document.getElementById('tire-rl'),
    rr: document.getElementById('tire-rr')
  }
  const tireShapes = {
    fl: document.getElementById('tire-shape-fl'),
    fr: document.getElementById('tire-shape-fr'),
    rl: document.getElementById('tire-shape-rl'),
    rr: document.getElementById('tire-shape-rr')
  }
  const speedValue = document.getElementById('speed-value')
  const gearValue = document.getElementById('gear-value')
  const rpmValue = document.getElementById('rpm-value')
  const engineElements = {
    boost: document.getElementById('engine-boost'),
    power: document.getElementById('engine-power'),
    torque: document.getElementById('engine-torque')
  }
  const throttleFill = document.getElementById('throttle-fill')
  const brakeFill = document.getElementById('brake-fill')
  const steeringCanvas = document.getElementById('steering-canvas')
  const historyCanvas = document.getElementById('history-canvas')
  const deltaValue = document.getElementById('delta-value')
  const deltaBar = document.getElementById('delta-bar')
  const deltaFill = document.getElementById('delta-fill')
  const deltaBest = document.getElementById('delta-best')
  const deltaBestContainer = document.querySelector('[data-delta-best-container]')
  const hudFrame = document.getElementById('hud-frame')

  // Tire color function (from overlay.js)
  function tireColor(tempC) {
    if (!Number.isFinite(tempC)) return '#71717a'
    if (tempC < 70) return '#38bdf8'
    if (tempC < 82) return '#69e83f'
    if (tempC < 92) return '#ffd400'
    return '#ff312b'
  }

  // Base state: reset everything
  function resetToBase() {
    // Set body background for translucency visibility
    document.body.style.backgroundColor = '#5a6b5f'

    // Ensure HUD frame and HUD are visible (HudPreferences might have hidden them)
    if (hudFrame) {
      hudFrame.removeAttribute('hidden')
      hudFrame.style.display = ''
    }
    if (hud) {
      hud.removeAttribute('hidden')
      hud.style.display = ''
    }

    // Remove edit mode
    if (hud) {
      hud.classList.remove('is-editing', 'is-redline', 'is-shift', 'is-waiting', 'is-live', 'is-offline')
      hud.classList.add('is-live')
      hud.removeAttribute('data-layout-mode')
      hud.style.removeProperty('--hud-opacity')
    }
    if (hudFrame) {
      hudFrame.classList.remove('is-editing')
    }
    if (deltaStrip) {
      deltaStrip.classList.remove('is-editing')
      deltaStrip.removeAttribute('hidden')
    }
    document.body.classList.remove('is-editing')
    document.body.removeAttribute('data-editing-target')

    // Hide delta best by default
    if (deltaBestContainer) deltaBestContainer.setAttribute('hidden', '')

    // Reset opacity
    document.documentElement.style.setProperty('--hud-opacity', '0.8')
  }

  // Set tire values and colors
  function setTires(fl, fr, rl, rr) {
    const temps = { fl, fr, rl, rr }
    for (const corner of Object.keys(tireElements)) {
      const value = temps[corner]
      const color = tireColor(value)
      tireElements[corner].textContent = `${Math.round(value)}°`
      tireElements[corner].style.color = color
      tireShapes[corner].style.color = color
      tireShapes[corner].style.backgroundColor = color
    }
  }

  // Set engine values
  function setEngine(boost, power, torque) {
    engineElements.boost.textContent = `${boost.toFixed(2)} BAR`
    engineElements.power.textContent = `${power} HP`
    engineElements.torque.textContent = `${torque} NM`
  }

  // Set pedal fills
  function setPedals(brake, throttle) {
    const brakePercent = Math.round(brake * 100)
    const throttlePercent = Math.round(throttle * 100)
    brakeFill.style.transform = `scaleY(${brake})`
    throttleFill.style.transform = `scaleY(${throttle})`
    document.getElementById('brake-track').setAttribute('aria-valuenow', String(brakePercent))
    document.getElementById('throttle-track').setAttribute('aria-valuenow', String(throttlePercent))
  }

  // Draw history canvas with throttle and brake lines
  function drawHistory(throttleHistory, brakeHistory) {
    const ctx = historyCanvas.getContext('2d')
    if (!ctx) return

    const width = historyCanvas.width
    const height = historyCanvas.height

    ctx.clearRect(0, 0, width, height)

    // Draw grid
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.16)'
    for (let column = 1; column < 6; column += 1) {
      const x = Math.round((column / 6) * width) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let row = 1; row < 3; row += 1) {
      const y = Math.round((row / 3) * height) + 0.5
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    // Draw throttle line (green)
    if (throttleHistory && throttleHistory.length > 0) {
      ctx.beginPath()
      throttleHistory.forEach((value, index) => {
        const x = (index / (throttleHistory.length - 1 || 1)) * width
        const y = height - Math.max(0, Math.min(1, value)) * (height - 4) - 2
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.strokeStyle = '#69e83f'
      ctx.lineWidth = 2.25
      ctx.lineJoin = 'miter'
      ctx.lineCap = 'butt'
      ctx.stroke()
    }

    // Draw brake line (red)
    if (brakeHistory && brakeHistory.length > 0) {
      ctx.beginPath()
      brakeHistory.forEach((value, index) => {
        const x = (index / (brakeHistory.length - 1 || 1)) * width
        const y = height - Math.max(0, Math.min(1, value)) * (height - 4) - 2
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.strokeStyle = '#ff312b'
      ctx.lineWidth = 2.25
      ctx.lineJoin = 'miter'
      ctx.lineCap = 'butt'
      ctx.stroke()
    }

    // Draw baseline
    ctx.beginPath()
    ctx.moveTo(0, height - 1.5)
    ctx.lineTo(width, height - 1.5)
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.75)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // Set delta state
  function setDelta(deltaValueText, tone, barFill) {
    if (deltaValue) deltaValue.textContent = deltaValueText
    if (deltaBar) deltaBar.setAttribute('data-tone', tone)
    if (deltaFill) {
      deltaFill.style.width = Math.round(barFill * 100) + '%'
    }
  }

  // Enable freeform layout
  function enableFreeform() {
    if (!hud) return
    hud.setAttribute('data-layout-mode', 'freeform')

    const freeformTargets = ['tires', 'pedals', 'steering', 'gear', 'engine', 'history']
    const columnWidths = {
      tires: 72,
      pedals: 46,
      steering: 68,
      gear: 92,
      engine: 116,
      history: 342
    }

    freeformTargets.forEach((name, index) => {
      const element = document.getElementById(`hud-${name}`)
      if (!element) return

      element.classList.add('hud-freeform-widget', 'layout-positioned')
      element.style.width = columnWidths[name] + 'px'
      element.style.height = '69px'

      // Spread them apart on screen
      const spacing = 120
      const startY = 50
      element.style.left = (index % 3) * spacing + 'px'
      element.style.top = Math.floor(index / 3) * spacing + startY + 'px'
      element.style.setProperty('--hud-widget-scale', '1')
    })
  }

  // Disable freeform layout
  function disableFreeform() {
    if (!hud) return
    hud.removeAttribute('data-layout-mode')

    const freeformTargets = ['tires', 'pedals', 'steering', 'gear', 'engine', 'history']
    freeformTargets.forEach((name) => {
      const element = document.getElementById(`hud-${name}`)
      if (!element) return
      element.classList.remove('hud-freeform-widget', 'layout-positioned')
      element.style.left = ''
      element.style.top = ''
      element.style.width = ''
      element.style.height = ''
      element.style.removeProperty('--hud-widget-scale')
    })
  }

  // Show resize handles and edit tools
  function showEditMode(target) {
    if (target === 'hud') {
      if (hudFrame) hudFrame.classList.add('is-editing')
      if (hud) hud.classList.add('is-editing')
    } else if (target === 'delta') {
      if (deltaStrip) deltaStrip.classList.add('is-editing')
    } else if (target === 'freeform-widget') {
      const element = document.getElementById(`hud-${target.split('-')[2]}`)
      if (element) {
        element.classList.add('is-editing')
        const editorFrame = hud.querySelector('.hud-widget-editor-frame')
        if (editorFrame) {
          editorFrame.removeAttribute('hidden')
          editorFrame.style.left = element.offsetLeft + 'px'
          editorFrame.style.top = element.offsetTop + 'px'
          editorFrame.style.width = element.offsetWidth + 'px'
          editorFrame.style.height = element.offsetHeight + 'px'
        }
      }
    }
    document.body.classList.add('is-editing')
    document.body.setAttribute('data-editing-target', target)
  }

  // Hide edit mode
  function hideEditMode() {
    if (hudFrame) hudFrame.classList.remove('is-editing')
    if (hud) hud.classList.remove('is-editing')
    if (deltaStrip) deltaStrip.classList.remove('is-editing')
    const freeformTargets = ['tires', 'pedals', 'steering', 'gear', 'engine', 'history']
    freeformTargets.forEach((name) => {
      const element = document.getElementById(`hud-${name}`)
      if (element) element.classList.remove('is-editing')
    })
    const editorFrames = hud.querySelectorAll('.hud-widget-editor-frame')
    editorFrames.forEach((frame) => frame.setAttribute('hidden', ''))
    document.body.classList.remove('is-editing')
    document.body.removeAttribute('data-editing-target')
  }

  // State implementations
  const states = {
    'grouped-live': function () {
      resetToBase()
      disableFreeform()
      hideEditMode()
      if (hud) {
        hud.classList.remove('is-waiting', 'is-offline', 'is-redline', 'is-shift')
        hud.classList.add('is-live')
      }
      setTires(67, 68, 70, 70)
      setPedals(0, 0.85)
      speedValue.textContent = '187 km/h'
      gearValue.textContent = '6'
      rpmValue.textContent = '8,173 RPM'
      setEngine(0.60, 566, 494)
      drawHistory([0, 0.2, 0.5, 0.85, 0.85, 0.8, 0.2], [0, 0, 0, 0, 0.05, 0.15, 0])
    },

    'grouped-redline': function () {
      states['grouped-live']()
      if (hud) {
        hud.classList.remove('is-shift')
        hud.classList.add('is-redline')
      }
    },

    'grouped-shift': function () {
      states['grouped-live']()
      if (hud) {
        hud.classList.remove('is-redline')
        hud.classList.add('is-shift')
      }
    },

    'grouped-waiting': function () {
      resetToBase()
      disableFreeform()
      hideEditMode()
      if (hud) {
        hud.classList.remove('is-live', 'is-offline', 'is-redline', 'is-shift')
        hud.classList.add('is-waiting')
      }
      setTires(NaN, NaN, NaN, NaN)
      setPedals(0, 0)
      speedValue.textContent = '-- km/h'
      gearValue.textContent = '—'
      rpmValue.textContent = '-- RPM'
      engineElements.boost.textContent = '—'
      engineElements.power.textContent = '—'
      engineElements.torque.textContent = '—'
      drawHistory([], [])
    },

    'freeform': function () {
      resetToBase()
      enableFreeform()
      hideEditMode()
      if (hud) {
        hud.classList.remove('is-waiting', 'is-offline', 'is-redline', 'is-shift')
        hud.classList.add('is-live')
      }
      setTires(67, 68, 70, 70)
      setPedals(0, 0.85)
      speedValue.textContent = '187 km/h'
      gearValue.textContent = '6'
      rpmValue.textContent = '8,173 RPM'
      setEngine(0.60, 566, 494)
      drawHistory([0, 0.2, 0.5, 0.85, 0.85, 0.8, 0.2], [0, 0, 0, 0, 0.05, 0.15, 0])
    },

    'edit-grouped': function () {
      states['grouped-live']()
      showEditMode('hud')
      const editTools = document.getElementById('hud-edit-tools')
      if (editTools) editTools.removeAttribute('hidden')
    },

    'edit-freeform': function () {
      states['freeform']()
      showEditMode('hud')
      // Show editor frame for first widget
      const editTools = document.getElementById('hud-edit-tools')
      if (editTools) editTools.removeAttribute('hidden')
      // Make one widget editable
      const tiresWidget = document.getElementById('hud-tires')
      if (tiresWidget) {
        tiresWidget.classList.add('is-editing')
        let editorFrame = hud.querySelector('.hud-widget-editor-frame')
        if (!editorFrame) {
          editorFrame = document.createElement('div')
          editorFrame.className = 'hud-widget-editor-frame'
          editorFrame.dataset.layoutEditorTarget = 'tires'
          hud.appendChild(editorFrame)
        }
        editorFrame.removeAttribute('hidden')
        const rect = tiresWidget.getBoundingClientRect()
        editorFrame.style.left = rect.left + 'px'
        editorFrame.style.top = rect.top + 'px'
        editorFrame.style.width = rect.width + 'px'
        editorFrame.style.height = rect.height + 'px'
      }
    },

    'delta-ahead': function () {
      resetToBase()
      disableFreeform()
      hideEditMode()
      if (hud) {
        hud.classList.remove('is-waiting', 'is-offline', 'is-redline', 'is-shift')
        hud.classList.add('is-live')
      }
      setTires(67, 68, 70, 70)
      setPedals(0, 0.85)
      speedValue.textContent = '187 km/h'
      gearValue.textContent = '6'
      rpmValue.textContent = '8,173 RPM'
      setEngine(0.60, 566, 494)
      // Show delta strip with best lap time and ahead state
      if (deltaBestContainer) deltaBestContainer.removeAttribute('hidden')
      if (deltaBest) deltaBest.textContent = '00:51.933'
      setDelta('-0.214', 'ahead', 0.214)
    },

    'delta-behind': function () {
      states['delta-ahead']()
      setDelta('+1.298', 'behind', 0.65)
    },

    'opacity-40': function () {
      states['grouped-live']()
      document.documentElement.style.setProperty('--hud-opacity', '0.4')
    }
  }

  // Main API
  window.hudPreview = {
    states: Object.keys(states),
    set: function (name) {
      if (typeof states[name] === 'function') {
        try {
          states[name]()
        } catch (error) {
          console.error(`[hudPreview] Error applying state "${name}":`, error)
        }
      } else {
        console.warn(`[hudPreview] Unknown state: "${name}"`)
      }
    }
  }

  console.log('[hudPreview] Ready. Available states:', Object.keys(states))
})(typeof globalThis !== 'undefined' ? globalThis : this)
