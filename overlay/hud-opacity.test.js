const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const overlayCss = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8')
const overlayJs = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')

test('HUD opacity applies to the game overlay shell with an 80 percent default', () => {
  assert.match(overlayCss, /:root\s*{[^}]*--hud-opacity:\s*0\.8;/s)
  assert.match(overlayCss, /\.hud-shell\s*{[^}]*opacity:\s*var\(--hud-opacity\);/s)
  assert.match(overlayJs, /setProperty\('--hud-opacity', String\(displayPreferences\.hudOpacity \/ 100\)\)/)
})
