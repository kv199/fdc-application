const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const overlayCss = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8')

function expectedScale(viewportWidth) {
  return Math.min(2, (viewportWidth - 16) / 736)
}

test('responsive HUD scale keeps the Engine layout readable through the intermediate range', () => {
  assert.match(overlayCss, /--hud-scale:\s*min\(2,\s*calc\(\(100vw - 16px\) \/ 736px\)\)/)
  assert.doesNotMatch(overlayCss, /@media\s*\(max-width:\s*1487px\)[\s\S]*?transform:\s*none/)

  assert.ok(expectedScale(1280) > 1.7)
  assert.ok(expectedScale(1366) > expectedScale(1280))
  assert.ok(expectedScale(1440) < 2)
  assert.equal(expectedScale(1600), 2)
})

test('HUD frame and Delta keep responsive width while Delta has its own scale', () => {
  assert.match(overlayCss, /\.hud-frame[\s\S]*?width:\s*min\(1472px,\s*calc\(100vw - 16px\)\)/)
  assert.match(overlayCss, /\.delta-strip[\s\S]*?width:\s*min\(calc\(1472px \* var\(--delta-user-scale\)\),\s*calc\(100vw - 16px\)\)/)
  assert.match(overlayCss, /bottom:\s*calc\(38px \+ 69px \* var\(--hud-scale\)\)/)

  const layoutSource = fs.readFileSync(path.join(__dirname, 'coach-layout.js'), 'utf8')
  assert.match(layoutSource, /if \(name === 'delta'\) elements\.delta\.style\.setProperty\('--delta-user-scale'/)
  assert.doesNotMatch(layoutSource, /elements\.delta\.style\.width =/)
})
