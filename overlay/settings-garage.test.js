const test = require('node:test')
const assert = require('node:assert/strict')

// The Garage rules read FdcVehicle when they run. vehicle.js sets it on the global
// object when it loads in Node, the same way the browser loads it before settings.js.
require('./vehicle.js')
const garage = require('./settings-garage.js')

test('settings-garage.js loads without a DOM and exports create()', () => {
  assert.equal(typeof document, 'undefined')
  assert.equal(typeof garage.create, 'function')
})

test('Garage performance class: labels become lowercase CSS-safe names, and a missing label is unknown', () => {
  assert.equal(garage.garagePerformanceClass('S1'), 's1')
  assert.equal(garage.garagePerformanceClass('A+ class'), 'a-class')
  assert.equal(garage.garagePerformanceClass(null), 'unknown')
  assert.equal(garage.garagePerformanceClass('   '), 'unknown')
})

test('Garage display name: the Garage name wins, and an unnamed car shows its ordinal', () => {
  assert.equal(garage.garageDisplayName({ name: ' Mustang ', carOrdinal: 12 }), 'Mustang')
  assert.equal(garage.garageDisplayName({ name: null, carOrdinal: 12 }), '12')
  assert.equal(garage.garageDisplayName(null), '')
})

test('Garage drivetrain: codes map to FWD, RWD and AWD, and unknown codes have no label', () => {
  assert.equal(garage.garageDrivetrainLabel({ drivetrain: 0 }), 'FWD')
  assert.equal(garage.garageDrivetrainLabel({ drivetrain: 1 }), 'RWD')
  assert.equal(garage.garageDrivetrainLabel({ drivetrain: 2 }), 'AWD')
  assert.equal(garage.garageDrivetrainLabel({ drivetrain: 9 }), null)
  assert.equal(garage.garageDrivetrainLabel({}), null)
})

test('Garage variants: a car lists its observed variants, or one row built from its class and PI', () => {
  const variants = [{ class: 3, pi: 700 }, { class: 4, pi: 800 }]
  assert.deepEqual(garage.garageVariantsFor({ carOrdinal: 1, variants }), variants)
  assert.deepEqual(garage.garageVariantsFor({ carOrdinal: 1, variants: [], class: 3, classLabel: 'B', pi: 700 }), [
    { class: 3, classLabel: 'B', pi: 700, drivetrain: undefined, drivetrainLabel: undefined }
  ])
  assert.deepEqual(garage.garageVariantsFor({ carOrdinal: 1, pi: 800 }), [
    { class: undefined, classLabel: undefined, pi: 800, drivetrain: undefined, drivetrainLabel: undefined }
  ])
  assert.deepEqual(garage.garageVariantsFor({ carOrdinal: 1 }), [])
  assert.deepEqual(garage.garageVariantsFor(null), [])
})

test('Garage cylinders: a variant count wins, then the car count, and a missing count is null', () => {
  assert.equal(garage.garageVariantCylinders({ cylinders: 8 }, { cylinders: 6 }), 8)
  assert.equal(garage.garageVariantCylinders({ numCylinders: 6 }, { cylinders: 4 }), 6)
  assert.equal(garage.garageVariantCylinders({ num_cylinders: 4 }, { cylinders: 2 }), 4)
  assert.equal(garage.garageVariantCylinders({}, { cylinders: 2 }), 2)
  assert.equal(garage.garageVariantCylinders({}, {}), null)
  assert.equal(garage.garageVariantCylinders(undefined, undefined), null)
})
