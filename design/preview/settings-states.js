(function(globalScope) {
  'use strict'

  // Utility functions
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  function closeDialogsAndMenus() {
    // Close any open dialogs by clicking NO or pressing Escape
    const dialogs = [
      document.getElementById('destructive-confirm-dialog'),
      document.getElementById('events-discard-dialog')
    ]
    for (const dialog of dialogs) {
      if (dialog && !dialog.hidden) {
        const noButton = dialog.querySelector('.confirm-dialog__no')
        if (noButton) noButton.click()
      }
    }

    // Close help menu if open
    const helpMenu = document.getElementById('settings-help-menu')
    if (helpMenu && !helpMenu.hidden) {
      const helpToggle = document.getElementById('settings-help-toggle')
      if (helpToggle) helpToggle.click()
    }

    // Close events create form if open
    const eventsCreateArea = document.getElementById('events-create-area')
    if (eventsCreateArea && !eventsCreateArea.hidden) {
      const createCancel = document.getElementById('events-create-cancel')
      if (createCancel) createCancel.click()
    }

    // Close events detail/run views if open
    const eventsDetailView = document.getElementById('events-detail-view')
    const eventsRunView = document.getElementById('events-run-view')
    if (eventsDetailView && !eventsDetailView.hidden) {
      const detailBack = document.getElementById('events-detail-back')
      if (detailBack) detailBack.click()
    }
    if (eventsRunView && !eventsRunView.hidden) {
      const runBack = document.getElementById('events-run-back')
      if (runBack) runBack.click()
    }

    // Close connection guide if open
    const connectGuide = document.getElementById('connect-guide')
    if (connectGuide && !connectGuide.hidden) {
      const skip = document.getElementById('connect-guide-skip')
      const done = document.getElementById('connect-guide-done')
      if (skip && !skip.hidden) skip.click()
      else if (done && !done.hidden) done.click()
    }

    // Close driver analysis detail if open
    const daDetailView = document.getElementById('driver-analysis-detail-view')
    if (daDetailView && !daDetailView.hidden) {
      const daDetailBack = document.getElementById('driver-analysis-detail-back')
      if (daDetailBack) daDetailBack.click()
    }
  }

  function scrollIntoView(element) {
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const states = [
    'guide-waiting',
    'guide-connected',
    'guide-problem',
    'confirm-destructive',
    'confirm-discard',
    'confirm-quit',
    'help-menu',
    'events-create',
    'hud-display',
    'driver-history',
    'hotkey-capture',
    'empty-states'
  ]

  async function open(name) {
    // Close any existing UI first
    closeDialogsAndMenus()
    await delay(100)

    switch (name) {
      case 'guide-waiting': {
        // Set connection guide to waiting state
        const guide = document.getElementById('connect-guide')
        if (guide) {
          guide.dataset.stage = 'waiting'
          guide.hidden = false
          const label = document.getElementById('connect-guide-status-label')
          if (label) label.textContent = 'WAITING FOR DATA FROM FORZA…'
          const hint = document.getElementById('connect-guide-hint')
          if (hint) hint.textContent = 'This screen updates as soon as the game sends data.'
          const retry = document.getElementById('connect-guide-retry')
          if (retry) retry.hidden = true
          const skip = document.getElementById('connect-guide-skip')
          if (skip) skip.hidden = false
          const done = document.getElementById('connect-guide-done')
          if (done) done.hidden = true
        }
        scrollIntoView(guide)
        return 'Connection guide in waiting state'
      }

      case 'guide-connected': {
        // Set connection guide to connected state
        const guide = document.getElementById('connect-guide')
        if (guide) {
          guide.dataset.stage = 'connected'
          guide.hidden = false
          const label = document.getElementById('connect-guide-status-label')
          if (label) label.textContent = 'CONNECTED'
          const hint = document.getElementById('connect-guide-hint')
          if (hint) hint.textContent = 'FDC is receiving data from Forza Horizon 6.'
          const retry = document.getElementById('connect-guide-retry')
          if (retry) retry.hidden = true
          const skip = document.getElementById('connect-guide-skip')
          if (skip) skip.hidden = true
          const done = document.getElementById('connect-guide-done')
          if (done) done.hidden = false
        }
        scrollIntoView(guide)
        return 'Connection guide in connected state'
      }

      case 'guide-problem': {
        // Set connection guide to problem state
        const guide = document.getElementById('connect-guide')
        if (guide) {
          guide.dataset.stage = 'problem'
          guide.hidden = false
          const label = document.getElementById('connect-guide-status-label')
          if (label) label.textContent = 'FDC CANNOT RECEIVE DATA OUT'
          const hint = document.getElementById('connect-guide-hint')
          if (hint) hint.textContent = 'Check your Forza settings. Make sure Data Out is enabled and the IP/Port match.'
          const retry = document.getElementById('connect-guide-retry')
          if (retry) retry.hidden = false
          const skip = document.getElementById('connect-guide-skip')
          if (skip) skip.hidden = false
          const done = document.getElementById('connect-guide-done')
          if (done) done.hidden = true
        }
        scrollIntoView(guide)
        return 'Connection guide in problem state'
      }

      case 'confirm-destructive': {
        // Open destructive confirmation dialog by deleting an event
        const destructiveDialog = document.getElementById('destructive-confirm-dialog')
        if (destructiveDialog) {
          const title = document.getElementById('destructive-confirm-title')
          if (title) title.textContent = 'ARE YOU SURE?'
          const message = document.getElementById('destructive-confirm-message')
          if (message) message.textContent = 'Delete this event and all its run history? This cannot be undone.'
          const yes = document.getElementById('destructive-confirm-yes')
          if (yes) yes.textContent = 'YES'
          const no = document.getElementById('destructive-confirm-no')
          if (no) no.textContent = 'NO'
          const option = document.getElementById('destructive-confirm-option')
          if (option) option.hidden = true
          destructiveDialog.hidden = false
          if (no) no.focus()
        }
        scrollIntoView(destructiveDialog)
        return 'Destructive confirmation dialog (event deletion)'
      }

      case 'confirm-discard': {
        // Open events discard dialog
        const eventsTab = document.querySelector('[data-settings-tab="events"]')
        if (eventsTab) eventsTab.click()
        await delay(100)

        const createToggle = document.getElementById('events-create-toggle')
        if (createToggle) createToggle.click()
        await delay(100)

        const nameInput = document.getElementById('event-name')
        if (nameInput) nameInput.value = 'Test Event'

        const discardDialog = document.getElementById('events-discard-dialog')
        if (discardDialog) {
          const createCancel = document.getElementById('events-create-cancel')
          if (createCancel) createCancel.click()
          await delay(50)
        }

        if (discardDialog && !discardDialog.hidden) {
          const noButton = document.getElementById('events-discard-no')
          if (noButton) noButton.focus()
        }
        scrollIntoView(discardDialog)
        return 'Events discard confirmation dialog'
      }

      case 'confirm-quit': {
        // Trigger quit confirmation dialog
        const destructiveDialog = document.getElementById('destructive-confirm-dialog')
        if (destructiveDialog) {
          const title = document.getElementById('destructive-confirm-title')
          if (title) title.textContent = 'QUIT FDC?'
          const message = document.getElementById('destructive-confirm-message')
          if (message) message.textContent = 'Are you sure you want to quit FDC?'
          const yes = document.getElementById('destructive-confirm-yes')
          if (yes) yes.textContent = 'QUIT'
          const no = document.getElementById('destructive-confirm-no')
          if (no) no.textContent = 'CANCEL'
          const option = document.getElementById('destructive-confirm-option')
          const optionInput = document.getElementById('destructive-confirm-option-input')
          const optionLabel = document.getElementById('destructive-confirm-option-label')
          if (option && optionLabel) {
            option.hidden = false
            optionLabel.textContent = 'Don\'t ask again'
            if (optionInput) optionInput.checked = false
          }
          destructiveDialog.hidden = false
          if (no) no.focus()
        }
        scrollIntoView(destructiveDialog)
        return 'Quit confirmation dialog with don\'t-ask option'
      }

      case 'help-menu': {
        // Open help menu
        const helpToggle = document.getElementById('settings-help-toggle')
        if (helpToggle) {
          helpToggle.click()
          await delay(100)
        }
        const helpMenu = document.getElementById('settings-help-menu')
        scrollIntoView(helpToggle)
        return 'Help menu open showing feedback options'
      }

      case 'events-create': {
        // Open events create form with values
        const eventsTab = document.querySelector('[data-settings-tab="events"]')
        if (eventsTab) eventsTab.click()
        await delay(100)

        const createToggle = document.getElementById('events-create-toggle')
        if (createToggle) createToggle.click()
        await delay(100)

        const nameInput = document.getElementById('event-name')
        if (nameInput) {
          nameInput.value = 'City Sprint'
          nameInput.dispatchEvent(new Event('input', { bubbles: true }))
        }

        const modeSelect = document.getElementById('event-mode')
        if (modeSelect) {
          modeSelect.value = 'Rivals'
          modeSelect.dispatchEvent(new Event('change', { bubbles: true }))
        }

        const routeSelect = document.getElementById('event-route-type')
        if (routeSelect) {
          routeSelect.value = 'Asphalt'
          routeSelect.dispatchEvent(new Event('change', { bubbles: true }))
        }

        const createArea = document.getElementById('events-create-area')
        scrollIntoView(createArea)
        return 'Events create form with sample data entered'
      }

      case 'hud-display': {
        // Open HUD tab and scroll to HUD DISPLAY
        const hudTab = document.querySelector('[data-settings-tab="hud"]')
        if (hudTab) hudTab.click()
        await delay(100)

        const hudDisplaySelect = document.getElementById('hud-display')
        scrollIntoView(hudDisplaySelect)
        return 'HUD tab with HUD DISPLAY monitor selector visible'
      }

      case 'driver-history': {
        // Open driver analysis tab with history visible
        const driverTab = document.querySelector('[data-settings-tab="driver-analysis"]')
        if (driverTab) driverTab.click()
        await delay(100)

        // Enable driver analysis
        const daEnabled = document.getElementById('driver-analysis-enabled')
        if (daEnabled && daEnabled.getAttribute('aria-pressed') === 'false') {
          daEnabled.click()
          await delay(100)
        }

        // Ensure history list is visible
        const historyView = document.getElementById('driver-analysis-history-view')
        scrollIntoView(historyView)
        return 'Driver Analysis tab with history rows visible (DETAILS/EXPORT/DELETE buttons)'
      }

      case 'hotkey-capture': {
        // Open driver analysis tab and start hotkey capture
        const driverTab = document.querySelector('[data-settings-tab="driver-analysis"]')
        if (driverTab) driverTab.click()
        await delay(100)

        // Enable driver analysis if not already
        const daEnabled = document.getElementById('driver-analysis-enabled')
        if (daEnabled && daEnabled.getAttribute('aria-pressed') === 'false') {
          daEnabled.click()
          await delay(100)
        }

        // Click the CHANGE button to start hotkey capture
        const hotkeyChange = document.getElementById('driver-analysis-hotkey-change')
        if (hotkeyChange) {
          hotkeyChange.click()
          await delay(100)
        }

        // Find the hotkey value element and update it to show capture state
        const hotkeyValue = document.getElementById('driver-analysis-hotkey-value')
        if (hotkeyValue) {
          hotkeyValue.textContent = 'Press a key combination…'
        }

        scrollIntoView(hotkeyChange)
        return 'Driver Analysis hotkey capture in waiting state (listening for input)'
      }

      case 'empty-states': {
        // Show a tab with empty state message - use garage tab if no cars
        const garageTab = document.querySelector('[data-settings-tab="garage"]')
        if (garageTab) garageTab.click()
        await delay(100)

        const garageGridEmpty = document.getElementById('garage-grid-empty')
        scrollIntoView(garageGridEmpty)
        return 'Garage tab showing empty state message'
      }

      default:
        return `Unknown state: ${name}`
    }
  }

  // Export to global scope
  globalScope.phase4 = {
    states,
    open
  }

  console.log('[Phase 4 States] Initialized with states:', states)
})(typeof globalThis === 'undefined' ? this : globalThis)
