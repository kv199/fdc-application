const test = require('node:test')
const assert = require('node:assert/strict')
const SettingsDriverAnalysis = require('./settings-driver-analysis.js')

const {
  create,
  formatDriverAnalysisDuration,
  formatDriverAnalysisDate,
  formatDriverAnalysisSize,
  driverAnalysisResultCopy,
  driverAnalysisHeadline
} = SettingsDriverAnalysis

test('the module loads in Node without a DOM and exports create() and its pure helpers', () => {
  assert.equal(typeof globalThis.document, 'undefined')
  assert.equal(typeof create, 'function')
  assert.equal(typeof formatDriverAnalysisDuration, 'function')
  assert.equal(typeof driverAnalysisHeadline, 'function')
})

test('formatDriverAnalysisDuration: seconds below a minute, minutes with two-digit seconds above', () => {
  assert.equal(formatDriverAnalysisDuration(0), '0s')
  assert.equal(formatDriverAnalysisDuration(42_000), '42s')
  assert.equal(formatDriverAnalysisDuration(125_000), '2m 05s')
  assert.equal(formatDriverAnalysisDuration(3_600_000), '60m 00s')
})

test('formatDriverAnalysisDuration: rounds to whole seconds and clamps missing or negative input to zero', () => {
  assert.equal(formatDriverAnalysisDuration(59_999), '1m 00s')
  assert.equal(formatDriverAnalysisDuration(499), '0s')
  assert.equal(formatDriverAnalysisDuration(-5_000), '0s')
  assert.equal(formatDriverAnalysisDuration(undefined), '0s')
  assert.equal(formatDriverAnalysisDuration('not a number'), '0s')
})

test('formatDriverAnalysisSize: bytes, then KB and MB with one decimal under 10 units', () => {
  assert.equal(formatDriverAnalysisSize(0), '0 B')
  assert.equal(formatDriverAnalysisSize(1023), '1023 B')
  assert.equal(formatDriverAnalysisSize(1024), '1.0 KB')
  assert.equal(formatDriverAnalysisSize(2560), '2.5 KB')
  assert.equal(formatDriverAnalysisSize(1024 * 1024), '1.0 MB')
  assert.equal(formatDriverAnalysisSize(2.5 * 1024 * 1024), '2.5 MB')
})

test('formatDriverAnalysisSize: from 10 units on, the value has no decimal', () => {
  assert.equal(formatDriverAnalysisSize(10 * 1024), '10 KB')
  assert.equal(formatDriverAnalysisSize(300 * 1024), '300 KB')
  assert.equal(formatDriverAnalysisSize(10 * 1024 * 1024), '10 MB')
})

test('formatDriverAnalysisSize: missing or negative sizes read as zero bytes', () => {
  assert.equal(formatDriverAnalysisSize(undefined), '0 B')
  assert.equal(formatDriverAnalysisSize(-1), '0 B')
})

test('formatDriverAnalysisDate: an invalid date reads as UNKNOWN TIME', () => {
  assert.equal(formatDriverAnalysisDate('not a date'), 'UNKNOWN TIME')
  assert.equal(formatDriverAnalysisDate(undefined), 'UNKNOWN TIME')
})

test('formatDriverAnalysisDate: a valid date shows the date and time separated by a middle dot', () => {
  const text = formatDriverAnalysisDate(Date.UTC(2026, 9, 16, 12, 30))
  assert.match(text, / · /)
  assert.notEqual(text, 'UNKNOWN TIME')
})

test('driverAnalysisResultCopy: each result has its own label and instruction', () => {
  assert.equal(driverAnalysisResultCopy({ status: 'recording' }).label, 'RECORDING IN PROGRESS')
  assert.equal(driverAnalysisResultCopy({ result: 'ambiguous' }).label, 'NO DRIVER-DOMINANT PATTERN DETECTED')
  assert.equal(driverAnalysisResultCopy({ result: 'no_recurring_problem' }).label, 'NO RECURRING PROBLEM DETECTED')
  assert.equal(driverAnalysisResultCopy({ result: 'interrupted' }).label, 'RECORDING INTERRUPTED')
  assert.equal(driverAnalysisResultCopy({ status: 'interrupted' }).label, 'RECORDING INTERRUPTED')
  assert.equal(driverAnalysisResultCopy({ result: 'issue' }).label, 'NOT ENOUGH ELIGIBLE MANEUVERS')
  assert.equal(driverAnalysisResultCopy(undefined).label, 'NOT ENOUGH ELIGIBLE MANEUVERS')
})

test('driverAnalysisResultCopy: an issue with a label shows that label and its instruction', () => {
  assert.deepEqual(
    driverAnalysisResultCopy({ result: 'issue', label: 'EARLY BRAKING', instruction: 'Brake later.' }),
    { label: 'EARLY BRAKING', instruction: 'Brake later.' }
  )
})

test('driverAnalysisHeadline: a saved issue keeps its label, instruction and result', () => {
  const headline = driverAnalysisHeadline({ result: 'issue', label: 'EARLY BRAKING', instruction: 'Brake later.' })
  assert.deepEqual(headline, { label: 'EARLY BRAKING', instruction: 'Brake later.', result: 'issue' })
})

test('driverAnalysisHeadline: a saved issue without an instruction gets the default instruction', () => {
  const headline = driverAnalysisHeadline({ result: 'issue', label: 'EARLY BRAKING' })
  assert.equal(headline.result, 'issue')
  assert.match(headline.instruction, /Repeat the session/)
})

test('driverAnalysisHeadline: a recording without a pattern reads as recording', () => {
  const headline = driverAnalysisHeadline({ status: 'recording' })
  assert.equal(headline.label, 'RECORDING IN PROGRESS')
  assert.equal(headline.result, 'recording')
})

test('driverAnalysisHeadline: a finished session without a pattern keeps its own result name', () => {
  const headline = driverAnalysisHeadline({ result: 'no_recurring_problem' })
  assert.equal(headline.label, 'NO RECURRING PROBLEM DETECTED')
  assert.equal(headline.result, 'no_recurring_problem')
})
