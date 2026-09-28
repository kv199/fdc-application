import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  buildCatalog,
  decodeHtmlEntities,
  diffCatalogs,
  normalizeCarType,
  normalizeName,
  parseHdrOrdinals,
  parseOfficialCarList,
  renderCatalog,
  scoreCandidate,
  validateOverrides
} from './update-vehicle-catalog.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const noOverrides = { schema: 1, matches: {} }
const sources = {
  hdr: { url: 'https://example.test/hdr', revision: 'abc', updatedAt: '2026-09-19T13:47:37Z' },
  official: { url: 'https://example.test/official', fetchedAt: '2026-09-28' }
}

function officialHtml(rows, headers = ['Make', 'Car Name', 'Car Type', 'Car Class']) {
  const head = `<thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr></thead>`
  const body = rows.map(cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('\n')
  return `<p>intro</p><table>${head}<tbody>${body}</tbody></table>`
}

function official(name, carType = 'Cult Cars') {
  return { make: name.split(' ')[1], name, carType }
}

test('entities decode in a single pass', () => {
  assert.equal(decodeHtmlEntities('Pickups &amp; 4x4&#39;s'), "Pickups & 4x4's")
  assert.equal(decodeHtmlEntities('Coup&#xE9; &quot;R&quot; &lt;&gt;'), 'Coupé "R" <>')
  assert.equal(decodeHtmlEntities('&amp;#39;'), '&#39;')
  assert.equal(decodeHtmlEntities('  <a href="x">Link</a>\n text '), 'Link text')
})

test('car types normalize known official typos', () => {
  assert.equal(normalizeCarType('Rods and Customs'), 'Rods & Customs')
  assert.equal(normalizeCarType('Electic Domestics'), 'Eclectic Domestics')
  assert.equal(normalizeCarType('Hypercars'), 'Hypercars')
})

test('names normalize case, diacritics, and punctuation', () => {
  assert.equal(normalizeName('1954 Mercedes-Benz 300 SL Coupé'), '1954mercedesbenz300slcoupe')
  assert.equal(normalizeName('1969 Toyota 2000 GT'), normalizeName('1969 TOYOTA 2000GT'))
})

test('the official table parses rows, entities, nested tags, and type aliases', () => {
  const rows = parseOfficialCarList(officialHtml([
    ['Abarth', '1968 Abarth 595 esseesse', 'Cult Cars', '100 D'],
    ['Toyota', '<a href="/car">2019 Toyota 4Runner TRD Pro</a>', 'Pickups &amp; 4x4&#39;s', '421 C'],
    ['Ford', '1932 Ford De Luxe Five-Window Coupe', 'Rods and Customs', '350 D']
  ]))
  assert.deepEqual(rows, [
    { make: 'Abarth', name: '1968 Abarth 595 esseesse', carType: 'Cult Cars' },
    { make: 'Toyota', name: '2019 Toyota 4Runner TRD Pro', carType: "Pickups & 4x4's" },
    { make: 'Ford', name: '1932 Ford De Luxe Five-Window Coupe', carType: 'Rods & Customs' }
  ])
})

test('the official table rejects an unexpected layout', () => {
  assert.throws(() => parseOfficialCarList('<div></div>'), /no table found/)
  assert.throws(() => parseOfficialCarList(officialHtml([['a', 'b', 'c']], ['Make', 'Name', 'Type'])), /header must start/)
  assert.throws(() => parseOfficialCarList(officialHtml([])), /no rows found/)
  assert.throws(() => parseOfficialCarList(officialHtml([['Abarth', '', 'Cult Cars']])), /row 1 lacks/)
})

test('HDR ordinals skip placeholders and traffic vehicles and reject invalid or duplicate ordinals', () => {
  assert.deepEqual(parseHdrOrdinals({
    '1969 Toyota 2000 GT': '247',
    NUL_CAR_00: '1215',
    '2014 Bus (Traffic)': '2714',
    '2025 Ferrari F80': '4156'
  }), [
    { ordinal: 247, name: '1969 Toyota 2000 GT' },
    { ordinal: 4156, name: '2025 Ferrari F80' }
  ])
  for (const value of ['0', '-5', 'abc', '12abc', '']) {
    assert.throws(() => parseHdrOrdinals({ '1969 Car': value }), /invalid ordinal/, value)
  }
  assert.throws(() => parseHdrOrdinals({ '1969 Car': '247', '1970 Car': '247' }), /duplicate ordinal 247/)
})

test('overrides accept official names and null only', () => {
  assert.doesNotThrow(() => validateOverrides({ schema: 1, matches: { 100: '1969 Toyota 2000 GT', 200: null } }))
  assert.throws(() => validateOverrides(null), /must be an object/)
  assert.throws(() => validateOverrides({ schema: 2, matches: {} }), /schema must be 1/)
  assert.throws(() => validateOverrides({ schema: 1 }), /"matches" object/)
  assert.throws(() => validateOverrides({ schema: 1, matches: { '012': 'Car' } }), /positive integer/)
  assert.throws(() => validateOverrides({ schema: 1, matches: { abc: 'Car' } }), /positive integer/)
  assert.throws(() => validateOverrides({ schema: 1, matches: { 100: ' ' } }), /non-empty string or null/)
  assert.throws(() => validateOverrides({ schema: 1, matches: { 100: 5 } }), /non-empty string or null/)
})

test('an exact normalized match takes the official name and car type', () => {
  const result = buildCatalog({
    hdr: [{ ordinal: 251, name: '1954 Mercedes-Benz 300 SL Coupe' }],
    official: [official('1954 Mercedes-Benz 300 SL Coupé', 'Rare Classics')],
    overrides: noOverrides
  })
  assert.deepEqual(result.vehicles, [{ ordinal: 251, name: '1954 Mercedes-Benz 300 SL Coupé', carType: 'Rare Classics' }])
  assert.deepEqual(result.stats, { exact: 1, override: 0, hdrOnly: 0, unresolved: 0, stale: 0 })
})

test('overrides map to an official row or keep the HDR name without a type', () => {
  const result = buildCatalog({
    hdr: [
      { ordinal: 2017, name: '1968 Fiat 595 SS' },
      { ordinal: 249, name: '1964 Ferrari 250 GTO' },
      { ordinal: 247, name: '1969 Toyota 2000 GT' }
    ],
    official: [official('1968 Abarth 595 esseesse'), official('1969 Toyota 2000 GT', 'Rare Classics')],
    overrides: { schema: 1, matches: { 2017: '1968 Abarth 595 esseesse', 249: null, 247: '1968 Abarth 595 esseesse' } }
  })
  assert.deepEqual(result.vehicles, [
    { ordinal: 247, name: '1968 Abarth 595 esseesse', carType: 'Cult Cars' },
    { ordinal: 249, name: '1964 Ferrari 250 GTO', carType: null },
    { ordinal: 2017, name: '1968 Abarth 595 esseesse', carType: 'Cult Cars' }
  ])
  assert.deepEqual(result.stats, { exact: 0, override: 2, hdrOnly: 1, unresolved: 0, stale: 0 })
})

test('stale overrides are reported instead of guessed', () => {
  const result = buildCatalog({
    hdr: [{ ordinal: 100, name: '1969 Toyota 2000 GT' }, { ordinal: 101, name: '1970 Datsun 510' }],
    official: [official('1969 Toyota 2000 GT'), official('1970 Datsun 510'), official('1970 Datsun 510')],
    overrides: { schema: 1, matches: { 100: 'Missing Car', 101: '1970 Datsun 510', 999: null } }
  })
  assert.deepEqual(result.vehicles, [])
  assert.deepEqual(result.staleOverrides.map(item => [item.ordinal, item.reason]), [
    [100, 'the official list has no such Car Name'],
    [101, 'the Car Name matches several official rows'],
    [999, 'HDR no longer lists this ordinal']
  ])
  assert.equal(result.stats.stale, 3)
})

test('unmatched and ambiguous ordinals stay unresolved with ranked candidates', () => {
  const result = buildCatalog({
    hdr: [{ ordinal: 1022, name: '2007 Ferrari F430 Scuderia' }, { ordinal: 300, name: '1970 Datsun 510' }],
    official: [
      official('2008 Ferrari 430 Scuderia'),
      official('2007 Ferrari 430 Scuderia', 'Modern Supercars'),
      official('2007 Alfa Romeo 8C Competizione'),
      official('1970 Datsun 510'),
      official('1970 Datsun 510', 'Classic Racers')
    ],
    overrides: noOverrides
  })
  assert.deepEqual(result.vehicles, [])
  assert.equal(result.stats.unresolved, 2)
  const [ambiguous, unmatched] = result.unresolved
  assert.equal(ambiguous.reason, 'several official rows share this name')
  assert.equal(ambiguous.candidates.length, 2)
  assert.equal(unmatched.reason, 'no exact official match')
  assert.deepEqual(unmatched.candidates.map(candidate => candidate.name), ['2007 Ferrari 430 Scuderia', '2008 Ferrari 430 Scuderia'])
})

test('candidate scores reward shared words and penalize distant years', () => {
  assert.equal(scoreCandidate('2007 Ferrari F430 Scuderia', '2007 Ferrari 430 Scuderia'), 0.67)
  assert.equal(scoreCandidate('2007 Ferrari F430 Scuderia', '2008 Ferrari 430 Scuderia'), 0.42)
  assert.equal(scoreCandidate('1964 Ferrari 250 GTO', '1962 Ferrari 250 GTO'), 0.5)
  assert.equal(scoreCandidate('1964 Ferrari 250 GTO', '1964 Toyota Corolla'), 0)
})

test('the rendered catalog is deterministic JSON with one vehicle per line', () => {
  const vehicles = [
    { ordinal: 4156, name: '2025 Ferrari F80', carType: 'Hypercars' },
    { ordinal: 249, name: 'Name with "quotes", {braces} and ]', carType: null }
  ]
  const rendered = renderCatalog({ sources, vehicles })
  assert.equal(rendered, renderCatalog({ sources, vehicles: [...vehicles].reverse() }))
  assert.ok(rendered.endsWith('}\n'))
  const parsed = JSON.parse(rendered)
  assert.deepEqual(parsed, { schema: 1, game: 'fh6', sources, vehicles: [vehicles[1], vehicles[0]] })
  const vehicleLines = rendered.split('\n').filter(line => line.includes('"ordinal"'))
  assert.deepEqual(vehicleLines, [
    '    { "ordinal": 249, "name": "Name with \\"quotes\\", {braces} and ]", "carType": null },',
    '    { "ordinal": 4156, "name": "2025 Ferrari F80", "carType": "Hypercars" }'
  ])
  assert.deepEqual(JSON.parse(renderCatalog({ sources, vehicles: [] })).vehicles, [])
})

test('catalog diffs list added, removed, and changed vehicles', () => {
  const diff = diffCatalogs(
    [{ ordinal: 1, name: 'One', carType: 'A' }, { ordinal: 2, name: 'Two', carType: 'B' }, { ordinal: 3, name: 'Three', carType: null }],
    [{ ordinal: 1, name: 'One', carType: 'A' }, { ordinal: 3, name: 'Three', carType: 'C' }, { ordinal: 4, name: 'Four', carType: 'D' }]
  )
  assert.deepEqual(diff.added.map(vehicle => vehicle.ordinal), [4])
  assert.deepEqual(diff.removed.map(vehicle => vehicle.ordinal), [2])
  assert.deepEqual(diff.changed.map(change => [change.ordinal, change.previous.carType, change.next.carType]), [[3, null, 'C']])
})

test('the committed vehicle catalog is valid', (t) => {
  const path = resolve(root, 'src-tauri/data/vehicle-catalog.json')
  if (!existsSync(path)) {
    t.skip('src-tauri/data/vehicle-catalog.json has not been generated')
    return
  }
  const catalog = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(catalog.schema, 1)
  assert.equal(catalog.game, 'fh6')
  assert.ok(Array.isArray(catalog.vehicles) && catalog.vehicles.length > 0)
  let previous = 0
  for (const vehicle of catalog.vehicles) {
    assert.deepEqual(Object.keys(vehicle), ['ordinal', 'name', 'carType'])
    assert.ok(Number.isInteger(vehicle.ordinal) && vehicle.ordinal > previous, `ordinal ${vehicle.ordinal} is not ascending and unique`)
    assert.ok(typeof vehicle.name === 'string' && vehicle.name.trim() === vehicle.name && vehicle.name !== '', `ordinal ${vehicle.ordinal} name`)
    assert.ok(vehicle.carType === null || (typeof vehicle.carType === 'string' && vehicle.carType !== ''), `ordinal ${vehicle.ordinal} carType`)
    previous = vehicle.ordinal
  }
})

test('the committed overrides are valid', (t) => {
  const path = resolve(root, 'tools/vehicle-catalog-overrides.json')
  if (!existsSync(path)) {
    t.skip('tools/vehicle-catalog-overrides.json has not been created')
    return
  }
  assert.doesNotThrow(() => validateOverrides(JSON.parse(readFileSync(path, 'utf8'))))
})
