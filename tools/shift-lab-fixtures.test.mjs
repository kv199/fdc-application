// Replays every local Shift Lab fixture through the current learner and checks its hand-written expectations.
// Fixtures are made from private recordings and never committed, so without them this file registers one skipped test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkExpectations, findFixtures, loadFixture, replayFrames } from './shift-lab.mjs'

const FIXTURE_DIR = fileURLToPath(new URL('./shift-lab-fixtures/', import.meta.url))
const { fixtures, unmatched } = findFixtures(FIXTURE_DIR)

if (fixtures.length === 0) {
  const ignored = unmatched.length === 0 ? '' : ` (ignored without an .expect.json: ${unmatched.join(', ')})`
  test('Shift Lab fixtures', { skip: `no local Shift Lab fixtures in tools/shift-lab-fixtures/${ignored}` }, () => {})
} else {
  for (const fixture of fixtures) {
    test(`Shift Lab fixture ${fixture.name}`, t => {
      const data = loadFixture(fixture.path)
      const expect = JSON.parse(readFileSync(fixture.expectPath, 'utf8'))
      if (expect.description) t.diagnostic(expect.description)
      const car = replayFrames(data.sessions).cars.find(item => item.key === data.key)
      assert.ok(car, `${fixture.name}: no frames for ${data.key}`)
      const failures = checkExpectations(car, expect)
      assert.deepEqual(failures, [], `${fixture.name} (${data.key}):\n  ${failures.join('\n  ')}`)
    })
  }
  for (const name of unmatched) {
    test(`Shift Lab fixture ${name}`, { skip: `no ${name}.expect.json next to the fixture` }, () => {})
  }
}
