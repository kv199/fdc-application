import { test } from 'node:test'
import assert from 'node:assert'
import FdcVehicle from './vehicle.js'

test('CLASS_LABELS are correct', () => {
  assert.deepStrictEqual(FdcVehicle.CLASS_LABELS, ['D', 'C', 'B', 'A', 'S1', 'S2', 'R', 'X'])
})

test('DRIVETRAIN_LABELS are correct', () => {
  assert.deepStrictEqual(FdcVehicle.DRIVETRAIN_LABELS, ['FWD', 'RWD', 'AWD'])
})

test('classLabel with numeric class', () => {
  assert.strictEqual(FdcVehicle.classLabel(0), 'D')
  assert.strictEqual(FdcVehicle.classLabel(3), 'A')
  assert.strictEqual(FdcVehicle.classLabel(7), 'X')
  assert.strictEqual(FdcVehicle.classLabel(3.7), 'S1')
  assert.strictEqual(FdcVehicle.classLabel(4.7), 'S2')
})

test('classLabel with string class', () => {
  assert.strictEqual(FdcVehicle.classLabel('d'), 'D')
  assert.strictEqual(FdcVehicle.classLabel('  B  '), 'B')
  assert.strictEqual(FdcVehicle.classLabel('s1'), 'S1')
})

test('classLabel with invalid values', () => {
  assert.strictEqual(FdcVehicle.classLabel(null), null)
  assert.strictEqual(FdcVehicle.classLabel(undefined), null)
  assert.strictEqual(FdcVehicle.classLabel(''), null)
  assert.strictEqual(FdcVehicle.classLabel(Infinity), null)
  assert.strictEqual(FdcVehicle.classLabel(NaN), null)
})

test('classLabel with custom string labels', () => {
  assert.strictEqual(FdcVehicle.classLabel('custom'), 'CUSTOM')
  assert.strictEqual(FdcVehicle.classLabel('invalid'), 'INVALID')
})

test('classLabel with out-of-range numeric class', () => {
  assert.strictEqual(FdcVehicle.classLabel(8), '8')
  assert.strictEqual(FdcVehicle.classLabel(100), '100')
})

test('drivetrainLabel with numeric drivetrain', () => {
  assert.strictEqual(FdcVehicle.drivetrainLabel(0), 'FWD')
  assert.strictEqual(FdcVehicle.drivetrainLabel(1), 'RWD')
  assert.strictEqual(FdcVehicle.drivetrainLabel(2), 'AWD')
})

test('drivetrainLabel with invalid values', () => {
  assert.strictEqual(FdcVehicle.drivetrainLabel(null), null)
  assert.strictEqual(FdcVehicle.drivetrainLabel(undefined), null)
  assert.strictEqual(FdcVehicle.drivetrainLabel(''), null)
  assert.strictEqual(FdcVehicle.drivetrainLabel(Infinity), null)
  assert.strictEqual(FdcVehicle.drivetrainLabel(-1), null)
})

test('drivetrainLabel with out-of-range numeric drivetrain', () => {
  assert.strictEqual(FdcVehicle.drivetrainLabel(3), null)
  assert.strictEqual(FdcVehicle.drivetrainLabel(100), null)
})

test('displayName with non-empty name', () => {
  assert.strictEqual(FdcVehicle.displayName('Ford Mustang', 123), 'Ford Mustang')
  assert.strictEqual(FdcVehicle.displayName('  Ferrari  ', 456), 'Ferrari')
})

test('displayName with empty or null name', () => {
  assert.strictEqual(FdcVehicle.displayName('', 1234), '1234')
  assert.strictEqual(FdcVehicle.displayName(null, 5678), '5678')
  assert.strictEqual(FdcVehicle.displayName(undefined, 9999), '9999')
  assert.strictEqual(FdcVehicle.displayName('   ', 100), '100')
})

test('displayName with whitespace-only name', () => {
  assert.strictEqual(FdcVehicle.displayName('  \t\n  ', 777), '777')
})

test('displayName with ordinal truncation', () => {
  assert.strictEqual(FdcVehicle.displayName(null, 123.9), '123')
  assert.strictEqual(FdcVehicle.displayName(null, 456.1), '456')
})

test('displayName with invalid ordinal', () => {
  assert.strictEqual(FdcVehicle.displayName(null, null), '')
  assert.strictEqual(FdcVehicle.displayName(null, undefined), '')
  assert.strictEqual(FdcVehicle.displayName(null, 0), '')
  assert.strictEqual(FdcVehicle.displayName(null, -100), '')
  assert.strictEqual(FdcVehicle.displayName(null, Infinity), '')
})

test('vehicleFromTelemetry with valid telemetry', () => {
  const telemetry = {
    car: {
      ordinal: 123,
      class: 3,
      pi: 850,
      carGroup: 5,
      drivetrain: 0,
      cylinders: 8
    },
    rpmMax: 6500
  }
  const result = FdcVehicle.vehicleFromTelemetry(telemetry)
  assert.deepStrictEqual(result, {
    ordinal: 123,
    class: 3,
    pi: 850,
    carGroup: 5,
    drivetrain: 0,
    cylinders: 8
  })
})

test('vehicleFromTelemetry with partial telemetry', () => {
  const telemetry = {
    car: {
      ordinal: 456,
      pi: 950
    }
  }
  const result = FdcVehicle.vehicleFromTelemetry(telemetry)
  assert.deepStrictEqual(result, {
    ordinal: 456,
    class: null,
    pi: 950,
    carGroup: null,
    drivetrain: null,
    cylinders: null
  })
})

test('vehicleFromTelemetry with null or invalid telemetry', () => {
  assert.strictEqual(FdcVehicle.vehicleFromTelemetry(null), null)
  assert.strictEqual(FdcVehicle.vehicleFromTelemetry(undefined), null)
  assert.strictEqual(FdcVehicle.vehicleFromTelemetry({}), null)
  assert.strictEqual(FdcVehicle.vehicleFromTelemetry({ car: {} }), null)
})

test('vehicleFromTelemetry with invalid ordinal', () => {
  assert.strictEqual(FdcVehicle.vehicleFromTelemetry({ car: { ordinal: 0 } }), null)
  assert.strictEqual(FdcVehicle.vehicleFromTelemetry({ car: { ordinal: -100 } }), null)
  assert.strictEqual(FdcVehicle.vehicleFromTelemetry({ car: { ordinal: Infinity } }), null)
})

test('vehicleFromTelemetry reads only the telemetry car object', () => {
  const telemetry = {
    car: {
      ordinal: 789
    },
    carOrdinal: 1,
    carGroup: 2,
    drivetrain: 1,
    class: 4
  }
  const result = FdcVehicle.vehicleFromTelemetry(telemetry)
  assert.deepStrictEqual(result, {
    ordinal: 789,
    class: null,
    pi: null,
    carGroup: null,
    drivetrain: null,
    cylinders: null
  })
  assert.equal(FdcVehicle.vehicleFromTelemetry({ carOrdinal: 789 }), null)
})

test('vehicleFromTelemetry with ordinal truncation', () => {
  const telemetry = {
    car: {
      ordinal: 123.9,
      class: 2.1,
      pi: 500.9
    }
  }
  const result = FdcVehicle.vehicleFromTelemetry(telemetry)
  assert.deepStrictEqual(result, {
    ordinal: 124,
    class: 2,
    pi: 501,
    carGroup: null,
    drivetrain: null,
    cylinders: null
  })
})
