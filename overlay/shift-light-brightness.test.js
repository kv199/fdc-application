const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const overlayCss = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8')

test('Redline and FDC Shift Light brightness affect their own alert layers only', () => {
  assert.match(overlayCss, /:root\s*{[^}]*--redline-brightness-scale:\s*1;/s)
  assert.match(overlayCss, /:root\s*{[^}]*--shift-light-brightness-scale:\s*1;/s)
  assert.match(
    overlayCss,
    /\.hud\.is-redline \.gear::before\s*{[^}]*background:\s*rgb\(255 49 43 \/ 24%\);[^}]*filter:\s*brightness\(var\(--redline-brightness-scale\)\);/s
  )
  assert.match(
    overlayCss,
    /\.hud\.is-shift \.gear::before\s*{[^}]*animation:\s*shift-alert[^}]*filter:\s*brightness\(var\(--shift-light-brightness-scale\)\);/s
  )
  assert.doesNotMatch(overlayCss, /\.gear\s*{[^}]*filter:/s)
})
