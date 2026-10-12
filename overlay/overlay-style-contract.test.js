const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { readResolvedStylesheet } = require('../tools/stylesheet-tokens.cjs')

const overlayCss = readResolvedStylesheet('overlay.css')
const overlayHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')

function cssBlock(selector) {
  const block = overlayCss.match(new RegExp(`\\${selector}\\s*{([^}]*)}`, 's'))
  assert.ok(block, `Expected ${selector} CSS block`)
  return block[1]
}

test('Shift Light keeps the alert timing and distinct light-phase color', () => {
  assert.match(overlayCss, /0%,\s*44%,\s*100%\s*{\s*background:\s*rgb\(168 85 247 \/ 96%\);\s*}/s)
  assert.match(overlayCss, /45%,\s*72%\s*{\s*background:\s*rgb\(185 118 248 \/ 98%\);\s*}/s)
  assert.match(overlayCss, /animation:\s*shift-alert 440ms steps\(2, end\) infinite/)
  assert.doesNotMatch(overlayCss, /rgb\(216 180 254 \/ 98%\)/)
})

test('Limiter red flashes in step on the Gear block and the Shift Bar', () => {
  // Both alternate the Redline Brightness color with a dimmer mix of it, on the
  // same keyframe timing as the purple cue.
  assert.match(
    overlayCss,
    /@keyframes redline-alert\s*{\s*0%,\s*44%,\s*100%\s*{\s*background:\s*var\(--redline-background\);\s*}\s*45%,\s*72%\s*{\s*background:\s*color-mix\(in srgb, var\(--redline-background\) 45%, transparent\);\s*}\s*}/s
  )
  assert.match(
    overlayCss,
    /@keyframes shift-bar-redline-alert\s*{\s*0%,\s*44%,\s*100%\s*{\s*fill:\s*var\(--redline-background\);\s*}\s*45%,\s*72%\s*{\s*fill:\s*color-mix\(in srgb, var\(--redline-background\) 45%, transparent\);\s*}\s*}/s
  )
  assert.match(overlayCss, /\.hud\.is-redline \.gear::before\s*{\s*animation:\s*redline-alert 440ms steps\(2, end\) infinite;\s*}/s)
  assert.match(
    overlayCss,
    /\.shift-bar\[data-signal='redline'\] \.shift-bar__fill\s*{\s*animation:\s*shift-bar-redline-alert 440ms steps\(2, end\) infinite;\s*}/s
  )
})

test('Limiter red has no steady fill at 85 percent of max RPM', () => {
  // The old steady red set a plain background or fill on the redline state.
  assert.doesNotMatch(overlayCss, /\.hud\.is-redline \.gear::before\s*{[^}]*background:/s)
  assert.doesNotMatch(overlayCss, /\.shift-bar\[data-signal='redline'\] \.shift-bar__fill\s*{\s*fill:/s)
})

test('Pedal tracks and tire shapes keep their form without borders', () => {
  const pedalTrack = cssBlock('.pedal__track')
  const tire = cssBlock('.tire')

  assert.doesNotMatch(pedalTrack, /\bborder(?:-(?!radius\b)[\w-]+)?\s*:/)
  assert.match(pedalTrack, /border-radius:\s*2px/)
  assert.match(pedalTrack, /background:\s*rgb\(3 5 7 \/ 34%\)/)

  assert.doesNotMatch(tire, /\bborder(?:-(?!radius\b)[\w-]+)?\s*:/)
  assert.match(tire, /width:\s*12px/)
  assert.match(tire, /height:\s*19px/)
  assert.match(tire, /border-radius:\s*3px/)

  assert.match(overlayHtml, /id="brake-track" class="pedal__track" role="meter"[^>]*aria-valuenow="0"/)
  assert.match(overlayHtml, /id="throttle-track" class="pedal__track" role="meter"[^>]*aria-valuenow="0"/)
  assert.equal((overlayHtml.match(/class="tire" aria-hidden="true"/g) || []).length, 4)
})
