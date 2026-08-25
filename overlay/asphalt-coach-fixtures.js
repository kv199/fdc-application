/*
 * Sanitized from a real FH6 lap-460 replay used during Stage 1 review.
 * Coordinates, timing identity, and non-coaching channels are removed; the
 * values are rounded and replayed at a regular 20 ms cadence in the tests.
 * This is a clean turning segment, not a reference or an ideal line.
 */
const CLEAN_REAL_SEGMENT = Object.freeze([
  {
    speedKmh: 131.178,
    throttle: 0.027,
    brake: 0,
    steer: -0.205,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.07, y: -13.031, z: -0.849 },
    angularVelocity: { x: 0.196, y: -0.115, z: 0.028 }
  },
  {
    speedKmh: 131.172,
    throttle: 0.008,
    brake: 0,
    steer: -0.583,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.061, y: -13.055, z: -0.628 },
    angularVelocity: { x: 0.195, y: -0.115, z: 0.028 }
  },
  {
    speedKmh: 131.167,
    throttle: 0.004,
    brake: 0,
    steer: -0.882,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: 0.142, y: -13.083, z: -0.434 },
    angularVelocity: { x: 0.194, y: -0.115, z: 0.028 }
  },
  {
    speedKmh: 131.162,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.121, y: -13.096, z: -0.64 },
    angularVelocity: { x: 0.194, y: -0.115, z: 0.028 }
  },
  {
    speedKmh: 131.159,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: 0.015, y: -13.105, z: -0.604 },
    angularVelocity: { x: 0.193, y: -0.115, z: 0.028 }
  },
  {
    speedKmh: 131.157,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: 0.065, y: -13.114, z: -0.359 },
    angularVelocity: { x: 0.192, y: -0.115, z: 0.027 }
  },
  {
    speedKmh: 131.155,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: 0.114, y: -13.137, z: -0.358 },
    angularVelocity: { x: 0.192, y: -0.115, z: 0.027 }
  },
  {
    speedKmh: 131.154,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.133, y: -13.15, z: -0.576 },
    angularVelocity: { x: 0.191, y: -0.115, z: 0.027 }
  },
  {
    speedKmh: 131.154,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.058, y: -13.148, z: -0.73 },
    angularVelocity: { x: 0.19, y: -0.115, z: 0.027 }
  },
  {
    speedKmh: 131.156,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.043, y: -13.177, z: -0.32 },
    angularVelocity: { x: 0.19, y: -0.115, z: 0.027 }
  },
  {
    speedKmh: 131.158,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: 0.051, y: -13.157, z: -0.285 },
    angularVelocity: { x: 0.189, y: -0.115, z: 0.027 }
  },
  {
    speedKmh: 131.161,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.117, y: -13.18, z: -0.754 },
    angularVelocity: { x: 0.188, y: -0.115, z: 0.026 }
  },
  {
    speedKmh: 131.165,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.132, y: -13.165, z: -0.447 },
    angularVelocity: { x: 0.187, y: -0.115, z: 0.026 }
  },
  {
    speedKmh: 131.17,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: 0.034, y: -13.185, z: -0.35 },
    angularVelocity: { x: 0.187, y: -0.115, z: 0.026 }
  },
  {
    speedKmh: 131.175,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.043, y: -13.188, z: -0.281 },
    angularVelocity: { x: 0.186, y: -0.115, z: 0.026 }
  },
  {
    speedKmh: 131.182,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.183, y: -13.209, z: -0.494 },
    angularVelocity: { x: 0.185, y: -0.115, z: 0.026 }
  },
  {
    speedKmh: 131.19,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: 0.059, y: -13.202, z: 0.069 },
    angularVelocity: { x: 0.185, y: -0.115, z: 0.026 }
  },
  {
    speedKmh: 131.198,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.101, y: -13.211, z: -0.546 },
    angularVelocity: { x: 0.184, y: -0.115, z: 0.026 }
  },
  {
    speedKmh: 131.208,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.105, y: -13.206, z: -0.229 },
    angularVelocity: { x: 0.183, y: -0.115, z: 0.025 }
  },
  {
    speedKmh: 131.218,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.052, y: -13.217, z: -0.383 },
    angularVelocity: { x: 0.183, y: -0.115, z: 0.025 }
  },
  {
    speedKmh: 131.229,
    throttle: 0,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: 0, rl: 0, rr: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    acceleration: { x: -0.046, y: -13.224, z: -0.2 },
    angularVelocity: { x: 0.182, y: -0.115, z: 0.025 }
  }
])

module.exports = { CLEAN_REAL_SEGMENT }
