/*
 * Sanitized from a real FH6 lap-460 replay used during Stage 1 review.
 * Coordinates, timing identity, and non-coaching channels are removed; the
 * values are rounded and replayed at a regular 20 ms cadence in the tests.
 * This is an airborne segment, not a reference or an ideal line.
 */
const FULL_EXTENSION = Object.freeze({ fl: 0, fr: 0, rl: 0, rr: 0 })

const AIRBORNE_REAL_SEGMENT = Object.freeze([
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
].map(input => Object.freeze({ ...input, suspension: FULL_EXTENSION })))

/*
 * Sanitized from a grounded, responsive braking turn in real FH6 lap 455.
 * It deliberately carries substantial brake, steering and tire load so the
 * negative replay proves response-aware gating instead of an empty signal path.
 */
const GROUNDED_RESPONSIVE_REAL_SEGMENT = Object.freeze([
  {
    speedKmh: 113.401,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.143, fr: -0.202, rl: -1.124, rr: -2.693 },
    slipAngle: { fl: 0.6, fr: 0.643, rl: 0.479, rr: 0.547 },
    combinedSlip: { fl: 0.616, fr: 0.674, rl: 1.222, rr: 2.748 },
    suspension: { fl: 0.801, fr: 0.699, rl: 0.294, rr: 0.222 },
    acceleration: { x: 9.394, y: 0.488, z: -11.134 },
    angularVelocity: { x: -0.083, y: 0.306, z: -0.008 }
  },
  {
    speedKmh: 112.83,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.138, fr: -0.394, rl: -1.126, rr: -2.64 },
    slipAngle: { fl: 0.628, fr: 0.674, rl: 0.479, rr: 0.55 },
    combinedSlip: { fl: 0.643, fr: 0.781, rl: 1.224, rr: 2.696 },
    suspension: { fl: 0.803, fr: 0.706, rl: 0.308, rr: 0.234 },
    acceleration: { x: 9.821, y: 0.595, z: -10.839 },
    angularVelocity: { x: -0.088, y: 0.329, z: -0.007 }
  },
  {
    speedKmh: 112.182,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.393, fr: -0.577, rl: -1.119, rr: -2.58 },
    slipAngle: { fl: 0.663, fr: 0.706, rl: 0.484, rr: 0.555 },
    combinedSlip: { fl: 0.77, fr: 0.912, rl: 1.219, rr: 2.639 },
    suspension: { fl: 0.802, fr: 0.708, rl: 0.322, rr: 0.248 },
    acceleration: { x: 9.973, y: 0.655, z: -10.597 },
    angularVelocity: { x: -0.084, y: 0.347, z: -0.01 }
  },
  {
    speedKmh: 111.141,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.392, fr: -0.327, rl: -1.111, rr: -2.478 },
    slipAngle: { fl: 0.71, fr: 0.762, rl: 0.494, rr: 0.566 },
    combinedSlip: { fl: 0.811, fr: 0.829, rl: 1.216, rr: 2.541 },
    suspension: { fl: 0.801, fr: 0.706, rl: 0.342, rr: 0.267 },
    acceleration: { x: 9.85, y: 0.629, z: -11.056 },
    angularVelocity: { x: -0.066, y: 0.362, z: -0.011 }
  },
  {
    speedKmh: 110.485,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.224, fr: -0.27, rl: -1.092, rr: -2.413 },
    slipAngle: { fl: 0.738, fr: 0.798, rl: 0.496, rr: 0.574 },
    combinedSlip: { fl: 0.771, fr: 0.842, rl: 1.2, rr: 2.481 },
    suspension: { fl: 0.799, fr: 0.704, rl: 0.354, rr: 0.279 },
    acceleration: { x: 9.813, y: 0.622, z: -11.096 },
    angularVelocity: { x: -0.054, y: 0.377, z: -0.01 }
  },
  {
    speedKmh: 109.826,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.176, fr: -0.479, rl: -1.063, rr: -2.362 },
    slipAngle: { fl: 0.765, fr: 0.83, rl: 0.503, rr: 0.583 },
    combinedSlip: { fl: 0.785, fr: 0.958, rl: 1.176, rr: 2.433 },
    suspension: { fl: 0.796, fr: 0.701, rl: 0.366, rr: 0.289 },
    acceleration: { x: 10.192, y: 0.652, z: -10.816 },
    angularVelocity: { x: -0.041, y: 0.393, z: -0.011 }
  },
  {
    speedKmh: 109.47,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.167, fr: -0.741, rl: -1.053, rr: -2.33 },
    slipAngle: { fl: 0.778, fr: 0.843, rl: 0.509, rr: 0.588 },
    combinedSlip: { fl: 0.796, fr: 1.122, rl: 1.17, rr: 2.403 },
    suspension: { fl: 0.794, fr: 0.698, rl: 0.369, rr: 0.294 },
    acceleration: { x: 9.978, y: 0.638, z: -10.939 },
    angularVelocity: { x: -0.033, y: 0.401, z: -0.013 }
  },
  {
    speedKmh: 107.92,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.38, fr: -0.331, rl: -1.075, rr: -2.134 },
    slipAngle: { fl: 0.837, fr: 0.918, rl: 0.537, rr: 0.609 },
    combinedSlip: { fl: 0.92, fr: 0.976, rl: 1.201, rr: 2.219 },
    suspension: { fl: 0.784, fr: 0.686, rl: 0.369, rr: 0.306 },
    acceleration: { x: 9.927, y: 0.598, z: -11.105 },
    angularVelocity: { x: -0.004, y: 0.424, z: -0.004 }
  },
  {
    speedKmh: 107.205,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.212, fr: -0.272, rl: -1.147, rr: -2.016 },
    slipAngle: { fl: 0.862, fr: 0.954, rl: 0.555, rr: 0.627 },
    combinedSlip: { fl: 0.887, fr: 0.992, rl: 1.274, rr: 2.111 },
    suspension: { fl: 0.778, fr: 0.679, rl: 0.371, rr: 0.316 },
    acceleration: { x: 10.082, y: 0.501, z: -11.074 },
    angularVelocity: { x: 0.001, y: 0.443, z: 0.002 }
  },
  {
    speedKmh: 106.847,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.181, fr: -0.636, rl: -1.18, rr: -1.959 },
    slipAngle: { fl: 0.876, fr: 0.97, rl: 0.561, rr: 0.637 },
    combinedSlip: { fl: 0.894, fr: 1.16, rl: 1.307, rr: 2.06 },
    suspension: { fl: 0.774, fr: 0.675, rl: 0.372, rr: 0.316 },
    acceleration: { x: 10.124, y: 0.432, z: -10.777 },
    angularVelocity: { x: 0.003, y: 0.454, z: 0.003 }
  },
  {
    speedKmh: 106.072,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.345, fr: -0.479, rl: -1.229, rr: -1.811 },
    slipAngle: { fl: 0.905, fr: 1.007, rl: 0.569, rr: 0.651 },
    combinedSlip: { fl: 0.969, fr: 1.115, rl: 1.354, rr: 1.924 },
    suspension: { fl: 0.767, fr: 0.667, rl: 0.371, rr: 0.311 },
    acceleration: { x: 10.443, y: 0.394, z: -10.632 },
    angularVelocity: { x: 0.009, y: 0.476, z: 0.006 }
  },
  {
    speedKmh: 104.874,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.31, fr: -0.296, rl: -1.287, rr: -1.697 },
    slipAngle: { fl: 0.955, fr: 1.067, rl: 0.597, rr: 0.696 },
    combinedSlip: { fl: 1.004, fr: 1.108, rl: 1.419, rr: 1.834 },
    suspension: { fl: 0.756, fr: 0.654, rl: 0.361, rr: 0.296 },
    acceleration: { x: 10.443, y: 0.276, z: -10.737 },
    angularVelocity: { x: 0.016, y: 0.498, z: 0.003 }
  },
  {
    speedKmh: 104.523,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.23, fr: -0.273, rl: -1.158, rr: -1.941 },
    slipAngle: { fl: 0.972, fr: 1.087, rl: 0.606, rr: 0.708 },
    combinedSlip: { fl: 0.999, fr: 1.121, rl: 1.307, rr: 2.067 },
    suspension: { fl: 0.752, fr: 0.649, rl: 0.357, rr: 0.288 },
    acceleration: { x: 10.317, y: 0.24, z: -10.563 },
    angularVelocity: { x: 0.015, y: 0.508, z: 0.001 }
  },
  {
    speedKmh: 103.804,
    throttle: 0,
    brake: 1,
    steer: 1,
    slipRatio: { fl: -0.166, fr: -0.622, rl: -1.064, rr: -2.16 },
    slipAngle: { fl: 1.002, fr: 1.118, rl: 0.627, rr: 0.732 },
    combinedSlip: { fl: 1.016, fr: 1.28, rl: 1.235, rr: 2.281 },
    suspension: { fl: 0.743, fr: 0.64, rl: 0.345, rr: 0.272 },
    acceleration: { x: 10.908, y: 0.142, z: -9.993 },
    angularVelocity: { x: 0.009, y: 0.531, z: -0.003 }
  }
])

module.exports = {
  AIRBORNE_REAL_SEGMENT,
  GROUNDED_RESPONSIVE_REAL_SEGMENT
}
