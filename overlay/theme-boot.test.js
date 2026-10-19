const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'theme-boot.js'), 'utf8')
const displayPreferencesSource = fs.readFileSync(path.join(__dirname, 'display-preferences.js'), 'utf8')
const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8')

// Runs display-preferences.js first, as settings.html does, then theme-boot. The switch is
// flipped in that source only when a test asks for theme selection to be on.
function boot(stored, { prefersLight = false, selectionEnabled = false, preferencesLoaded = true } = {}) {
  const flag = 'const THEME_SELECTION_ENABLED = false'
  assert.ok(displayPreferencesSource.includes(flag), 'the theme switch is declared as false')
  const windowObject = {
    matchMedia: query => ({ matches: prefersLight && query === '(prefers-color-scheme: light)' })
  }
  if (preferencesLoaded) {
    const preferencesScope = {}
    vm.runInNewContext(displayPreferencesSource.replace(flag, `const THEME_SELECTION_ENABLED = ${selectionEnabled}`), preferencesScope)
    windowObject.DisplayPreferences = preferencesScope.DisplayPreferences
  }
  const root = { dataset: {} }
  const context = {
    document: { documentElement: root },
    localStorage: { getItem: () => stored },
    window: windowObject
  }
  vm.runInNewContext(source, context)
  return root.dataset.theme
}

test('theme-boot paints dark while theme selection is switched off, whatever is saved', () => {
  assert.equal(boot(null), 'dark')
  assert.equal(boot(JSON.stringify({ speedUnit: 'kmh' })), 'dark')
  assert.equal(boot(JSON.stringify({ theme: 'light' })), 'dark')
  assert.equal(boot(JSON.stringify({ theme: 'system' }), { prefersLight: true }), 'dark')
  assert.equal(boot(JSON.stringify({ theme: 'system' })), 'dark')
  assert.equal(boot('not json', { prefersLight: true }), 'dark')
})

test('theme-boot still applies light and system once theme selection is switched on', () => {
  assert.equal(boot(JSON.stringify({ theme: 'light' }), { selectionEnabled: true }), 'light')
  assert.equal(boot(JSON.stringify({ theme: 'system' }), { selectionEnabled: true, prefersLight: true }), 'light')
  assert.equal(boot(JSON.stringify({ theme: 'system' }), { selectionEnabled: true, prefersLight: false }), 'dark')
  assert.equal(boot(JSON.stringify({ theme: 'dark' }), { selectionEnabled: true, prefersLight: true }), 'dark')
  assert.equal(boot('not json', { selectionEnabled: true, prefersLight: true }), 'dark')
})

test('theme-boot paints dark when display-preferences.js did not load', () => {
  assert.equal(boot(JSON.stringify({ theme: 'light' }), { preferencesLoaded: false, selectionEnabled: true }), 'dark')
})

test('Only the Configuration page loads theme-boot, after display-preferences.js and the stylesheets', () => {
  const head = settingsHtml.slice(0, settingsHtml.indexOf('</head>'))
  assert.match(head, /<link rel="stylesheet" href="settings\.css">\s*<script src="display-preferences\.js"><\/script>\s*<script src="theme-boot\.js"><\/script>/)
  assert.equal(settingsHtml.match(/src="display-preferences\.js"/g).length, 1)
  const hudHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  assert.doesNotMatch(hudHtml, /theme-boot/)
})
