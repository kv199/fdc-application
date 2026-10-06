const test = require('node:test')
const assert = require('node:assert/strict')
const { readTokens } = require('../tools/stylesheet-tokens.cjs')

function hexToRgb(hex) {
  if (!/^#(?:[0-9a-f]{3}){1,2}$/i.test(hex)) {
    throw new Error(`Invalid hex color: ${hex}`)
  }
  const digits = hex.length === 4 ? [...hex.slice(1)].map(digit => digit + digit).join('') : hex.slice(1)
  return [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16) / 255)
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex)
  const luminance = channel => channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
  return 0.2126 * luminance(r) + 0.7152 * luminance(g) + 0.0722 * luminance(b)
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1)
  const l2 = relativeLuminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function assertContrast(textColor, bgColor, minRatio, message) {
  const ratio = contrastRatio(textColor, bgColor)
  const ratioRounded = Math.round(ratio * 100) / 100
  assert.ok(ratio >= minRatio, `${message}: ${textColor} on ${bgColor} = ${ratioRounded} (need ${minRatio})`)
}

test('WCAG 2.x contrast ratios for text on backgrounds', () => {
  const tokens = readTokens()

  const textTokens = ['--text', '--text-soft', '--text-muted', '--text-subtle']
  const bgTokens = ['--bg', '--surface-deep', '--surface', '--panel']
  const statusTokens = ['--accent', '--danger-text', '--best', '--caution', '--warning', '--notice']

  for (const textToken of textTokens.concat(statusTokens)) {
    for (const bgToken of bgTokens) {
      const textHex = tokens.get(textToken)
      const bgHex = tokens.get(bgToken)
      assertContrast(textHex, bgHex, 4.5, `${textToken} on ${bgToken}`)
    }
  }
})

test('WCAG 2.x contrast ratios for text on surface-hover', () => {
  const tokens = readTokens()
  const textTokens = ['--text', '--text-soft', '--text-muted']
  const bgHex = tokens.get('--surface-hover')

  for (const textToken of textTokens) {
    const textHex = tokens.get(textToken)
    assertContrast(textHex, bgHex, 4.5, `${textToken} on --surface-hover`)
  }
})

test('WCAG 2.x contrast ratios for text on semantic fills', () => {
  const tokens = readTokens()

  // Text on accent
  const textOnAccentHex = tokens.get('--text-on-accent')
  assertContrast(textOnAccentHex, tokens.get('--accent'), 4.5, '--text-on-accent on --accent')
  assertContrast(textOnAccentHex, tokens.get('--accent-hover'), 4.5, '--text-on-accent on --accent-hover')

  // Text on danger
  const textOnDangerHex = tokens.get('--text-on-danger')
  assertContrast(textOnDangerHex, tokens.get('--danger'), 4.5, '--text-on-danger on --danger')

  // Text on paint
  const textHex = tokens.get('--text')
  assertContrast(textHex, tokens.get('--paint'), 4.5, '--text on --paint')
})

test('WCAG 2.x contrast ratios for badge text on mode fills', () => {
  const tokens = readTokens()
  const badgeTextHex = tokens.get('--text-on-badge')
  const modeTokens = ['--mode-any', '--mode-rivals', '--mode-online', '--mode-eventlab']

  for (const modeToken of modeTokens) {
    const modeHex = tokens.get(modeToken)
    assertContrast(badgeTextHex, modeHex, 4.5, `--text-on-badge on ${modeToken}`)
  }
})

test('WCAG 2.x contrast ratios for faint text', () => {
  const tokens = readTokens()
  const textFaintHex = tokens.get('--text-faint')
  const bgTokens = ['--bg', '--surface-deep', '--surface']

  for (const bgToken of bgTokens) {
    const bgHex = tokens.get(bgToken)
    assertContrast(textFaintHex, bgHex, 3, `--text-faint on ${bgToken}`)
  }
})

test('WCAG 2.x contrast ratios for non-text controls', () => {
  const tokens = readTokens()
  const accentHex = tokens.get('--accent')
  const lineStrongHex = tokens.get('--line-strong')
  const bgTokens = ['--bg', '--surface-deep', '--surface']

  for (const bgToken of bgTokens) {
    const bgHex = tokens.get(bgToken)
    assertContrast(accentHex, bgHex, 3, `--accent on ${bgToken}`)
    assertContrast(lineStrongHex, bgHex, 3, `--line-strong on ${bgToken}`)
  }
})
