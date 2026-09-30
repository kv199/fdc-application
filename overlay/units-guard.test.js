const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Displayed units must come from units.js so every view follows the user's
// unit preferences. This guard flags unit labels written into output strings.
// Bare quoted unit ids such as 'mph' or 'mi' are preference values and allowed.
const EXEMPT = new Set(['units.js', 'shift-light-engine.js'])
const UNIT_IN_STRING = [
  /['"`][^'"`]*km\/h[^'"`]*['"`]/,
  /['"`][^'"`]*[\s}]mph\b/,
  /['"`]\s(?:km|mi|m|ft)['"`]/,
  /\}\s(?:km|mi|ft)\b/,
  /\}\sm(?![/\w])/
]

function codeLines(source) {
  return source.split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
}

test('overlay code formats speed and distance only through FdcUnits', () => {
  const files = fs.readdirSync(__dirname)
    .filter(name => name.endsWith('.js') && !name.endsWith('.test.js') && !EXEMPT.has(name))
  const offenders = []
  for (const name of files) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8')
    for (const { line, number } of codeLines(source)) {
      if (UNIT_IN_STRING.some(pattern => pattern.test(line))) offenders.push(`${name}:${number}: ${line.trim()}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('the guard recognizes hardcoded unit labels', () => {
  const flagged = [
    "value: String(Math.round(speed)) + ' km/h'",
    "value: String(distance) + ' m'",
    'parts.push(`${distanceKm.toFixed(1)} km`)',
    'label: `${meters} m`',
    'return `${Math.round(speed)} mph`'
  ]
  const allowed = [
    'parts.push(`lateral ${lateral.toFixed(1)} m/s²`)',
    'FdcUnits.formatSpeed(speed)',
    "status.textContent = 'SPEED UNIT SET TO KM/H'",
    "speedUnit: candidate.speedUnit === 'mph' ? 'mph' : 'kmh'",
    "distanceUnit: candidate.distanceUnit === 'mi' ? 'mi' : 'km'"
  ]
  for (const line of flagged) assert.ok(UNIT_IN_STRING.some(pattern => pattern.test(line)), line)
  for (const line of allowed) assert.ok(!UNIT_IN_STRING.some(pattern => pattern.test(line)), line)
})
