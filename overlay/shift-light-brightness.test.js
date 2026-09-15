const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const overlayCss = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8')

test('Redline color and FDC Shift Light brightness affect their own alert layers only', () => {
  assert.match(overlayCss, /:root\s*{[^}]*--redline-background:\s*rgb\(217 42 37 \/ 96%\);/s)
  assert.match(overlayCss, /:root\s*{[^}]*--shift-light-brightness-scale:\s*1;/s)
  assert.match(
    overlayCss,
    /\.hud\.is-redline \.gear::before\s*{[^}]*background:\s*var\(--redline-background\);/s
  )
  assert.match(
    overlayCss,
    /\.hud\.is-shift \.gear::before\s*{[^}]*animation:\s*shift-alert[^}]*filter:\s*brightness\(var\(--shift-light-brightness-scale\)\);/s
  )
  assert.doesNotMatch(overlayCss, /\.hud\.is-redline \.gear::before\s*{[^}]*filter:/s)
})
