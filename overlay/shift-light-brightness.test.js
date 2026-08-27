const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const overlayCss = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8')

test('Shift Light brightness affects only the alert layer', () => {
  assert.match(overlayCss, /:root\s*{[^}]*--shift-light-brightness-scale:\s*1;/s)
  assert.match(
    overlayCss,
    /\.gear::before\s*{[^}]*filter:\s*brightness\(var\(--shift-light-brightness-scale\)\);/s
  )
  assert.match(overlayCss, /\.hud\.is-redline \.gear::before\s*{/)
  assert.match(overlayCss, /\.hud\.is-shift \.gear::before\s*{[^}]*animation:\s*shift-alert/s)
  assert.doesNotMatch(overlayCss, /\.gear\s*{[^}]*filter:/s)
})
