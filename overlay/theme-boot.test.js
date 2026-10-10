const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'theme-boot.js'), 'utf8')
const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8')

function boot(stored, prefersLight = false) {
  const root = { dataset: {} }
  const context = {
    document: { documentElement: root },
    localStorage: { getItem: () => stored },
    window: { matchMedia: query => ({ matches: prefersLight && query === '(prefers-color-scheme: light)' }) }
  }
  vm.runInNewContext(source, context)
  return root.dataset.theme
}

test('theme-boot applies the saved Configuration theme before the first paint', () => {
  assert.equal(boot(null), 'dark')
  assert.equal(boot(JSON.stringify({ speedUnit: 'kmh' })), 'dark')
  assert.equal(boot(JSON.stringify({ theme: 'light' })), 'light')
  assert.equal(boot(JSON.stringify({ theme: 'system' }), true), 'light')
  assert.equal(boot(JSON.stringify({ theme: 'system' }), false), 'dark')
  assert.equal(boot('not json'), 'dark')
})

test('Only the Configuration page loads theme-boot, in its head after the stylesheets', () => {
  const head = settingsHtml.slice(0, settingsHtml.indexOf('</head>'))
  assert.match(head, /<link rel="stylesheet" href="settings\.css">\s*<script src="theme-boot\.js"><\/script>/)
  const hudHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  assert.doesNotMatch(hudHtml, /theme-boot/)
})
