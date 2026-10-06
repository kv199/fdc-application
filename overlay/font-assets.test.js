const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('@font-face url() in tokens.css point to existing files', () => {
  const tokensPath = path.join(__dirname, 'tokens.css')
  const content = fs.readFileSync(tokensPath, 'utf8')

  // Extract all url() references from @font-face blocks
  const fontFacePattern = /@font-face\s*\{[^}]*src:\s*url\('([^']+)'\)[^}]*\}/g
  const matches = [...content.matchAll(fontFacePattern)]

  assert.ok(matches.length > 0, 'Should find @font-face rules with url()')

  for (const match of matches) {
    const fontPath = match[1]
    const fullPath = path.join(__dirname, fontPath)
    assert.ok(fs.existsSync(fullPath), `Font file should exist: ${fontPath}`)
  }
})

test('all .ttf files in overlay/assets/fonts/ are referenced in @font-face', () => {
  const fontsDir = path.join(__dirname, 'assets', 'fonts')
  const ttfFiles = fs.readdirSync(fontsDir)
    .filter(name => name.endsWith('.ttf'))
    .sort()

  const tokensPath = path.join(__dirname, 'tokens.css')
  const content = fs.readFileSync(tokensPath, 'utf8')

  assert.ok(ttfFiles.length > 0, 'Should have .ttf files in assets/fonts/')

  for (const ttfFile of ttfFiles) {
    assert.ok(content.includes(ttfFile), `${ttfFile} should be referenced in tokens.css`)
  }
})

test('license files exist and contain SIL OPEN FONT LICENSE text', () => {
  const fontsDir = path.join(__dirname, 'assets', 'fonts')
  const barlowLicense = path.join(fontsDir, 'barlow-OFL.txt')
  const barlowCondensedLicense = path.join(fontsDir, 'barlowcondensed-OFL.txt')

  assert.ok(fs.existsSync(barlowLicense), 'barlow-OFL.txt should exist')
  assert.ok(fs.existsSync(barlowCondensedLicense), 'barlowcondensed-OFL.txt should exist')

  const barlowContent = fs.readFileSync(barlowLicense, 'utf8')
  const barlowCondensedContent = fs.readFileSync(barlowCondensedLicense, 'utf8')

  assert.ok(barlowContent.includes('SIL OPEN FONT LICENSE'), 'barlow-OFL.txt should contain license text')
  assert.ok(barlowCondensedContent.includes('SIL OPEN FONT LICENSE'), 'barlowcondensed-OFL.txt should contain license text')
})

test('README.md mentions SIL Open Font License and assets/fonts/', () => {
  const readmePath = path.join(__dirname, '..', 'README.md')
  const content = fs.readFileSync(readmePath, 'utf8')

  assert.ok(content.includes('SIL Open Font License'), 'README.md should mention SIL Open Font License')
  assert.ok(content.includes('overlay/assets/fonts/'), 'README.md should mention overlay/assets/fonts/')
})

test('paint.jpg exists and is under 350 KB', () => {
  const paintPath = path.join(__dirname, 'assets', 'textures', 'paint.jpg')
  assert.ok(fs.existsSync(paintPath), 'paint.jpg should exist')

  const stats = fs.statSync(paintPath)
  const maxBytes = 350 * 1024
  assert.ok(stats.size <= maxBytes, `paint.jpg should be at most 350 KB, got ${(stats.size / 1024).toFixed(2)} KB`)
})
