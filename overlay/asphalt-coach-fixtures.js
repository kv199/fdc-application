/*
 * Sanitized from the real FH6 lap-465 replay used during Stage 1 review.
 * Coordinates, timing identity, and non-coaching channels are removed; the
 * values are rounded and replayed at a regular 20 ms cadence in the tests.
 * This is a short clean high-speed segment, not a reference or an ideal line.
 */
const CLEAN_REAL_SEGMENT = Object.freeze([
  {
    speedKmh: 192.257,
    throttle: 1,
    brake: 0,
    steer: -0.213,
    slipRatio: { fl: -0.003, fr: -0.001, rl: 0.165, rr: 0.125 },
    slipAngle: { fl: -0.136, fr: -0.131, rl: -0.165, rr: -0.152 },
    combinedSlip: { fl: 0.136, fr: 0.131, rl: 0.234, rr: 0.196 },
    acceleration: { x: -6.236, y: -0.115, z: 1.746 },
    angularVelocity: { y: -0.169 }
  },
  {
    speedKmh: 192.29,
    throttle: 1,
    brake: 0,
    steer: -0.591,
    slipRatio: { fl: -0.003, fr: -0.001, rl: 0.169, rr: 0.128 },
    slipAngle: { fl: -0.149, fr: -0.143, rl: -0.167, rr: -0.153 },
    combinedSlip: { fl: 0.149, fr: 0.143, rl: 0.237, rr: 0.199 },
    acceleration: { x: -6.398, y: -0.202, z: 1.784 },
    angularVelocity: { y: -0.166 }
  },
  {
    speedKmh: 192.323,
    throttle: 1,
    brake: 0,
    steer: -0.85,
    slipRatio: { fl: -0.002, fr: 0, rl: 0.172, rr: 0.13 },
    slipAngle: { fl: -0.165, fr: -0.158, rl: -0.168, rr: -0.154 },
    combinedSlip: { fl: 0.165, fr: 0.158, rl: 0.241, rr: 0.202 },
    acceleration: { x: -6.144, y: -0.275, z: 1.62 },
    angularVelocity: { y: -0.164 }
  },
  {
    speedKmh: 192.356,
    throttle: 1,
    brake: 0,
    steer: -1,
    slipRatio: { fl: -0.002, fr: 0, rl: 0.175, rr: 0.132 },
    slipAngle: { fl: -0.182, fr: -0.173, rl: -0.17, rr: -0.155 },
    combinedSlip: { fl: 0.182, fr: 0.173, rl: 0.244, rr: 0.204 },
    acceleration: { x: -6.094, y: -0.338, z: 1.455 },
    angularVelocity: { y: -0.163 }
  },
  {
    speedKmh: 192.39,
    throttle: 1,
    brake: 0,
    steer: -1,
    slipRatio: { fl: -0.001, fr: 0, rl: 0.177, rr: 0.134 },
    slipAngle: { fl: -0.198, fr: -0.188, rl: -0.171, rr: -0.156 },
    combinedSlip: { fl: 0.198, fr: 0.188, rl: 0.246, rr: 0.206 },
    acceleration: { x: -6.39, y: -0.374, z: 1.647 },
    angularVelocity: { y: -0.163 }
  },
  {
    speedKmh: 192.426,
    throttle: 1,
    brake: 0,
    steer: -1,
    slipRatio: { fl: -0.001, fr: -0.001, rl: 0.178, rr: 0.135 },
    slipAngle: { fl: -0.215, fr: -0.204, rl: -0.172, rr: -0.158 },
    combinedSlip: { fl: 0.215, fr: 0.204, rl: 0.247, rr: 0.208 },
    acceleration: { x: -6.599, y: -0.421, z: 1.72 },
    angularVelocity: { y: -0.165 }
  },
  {
    speedKmh: 192.541,
    throttle: 1,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: -0.001, rl: 0.178, rr: 0.133 },
    slipAngle: { fl: -0.263, fr: -0.248, rl: -0.176, rr: -0.16 },
    combinedSlip: { fl: 0.263, fr: 0.248, rl: 0.25, rr: 0.208 },
    acceleration: { x: -6.643, y: -0.33, z: 1.706 },
    angularVelocity: { y: -0.176 }
  },
  {
    speedKmh: 192.618,
    throttle: 1,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0, fr: -0.001, rl: 0.176, rr: 0.13 },
    slipAngle: { fl: -0.296, fr: -0.278, rl: -0.178, rr: -0.162 },
    combinedSlip: { fl: 0.296, fr: 0.278, rl: 0.251, rr: 0.208 },
    acceleration: { x: -6.499, y: -0.197, z: 1.483 },
    angularVelocity: { y: -0.186 }
  },
  {
    speedKmh: 192.696,
    throttle: 1,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0.001, fr: -0.001, rl: 0.174, rr: 0.125 },
    slipAngle: { fl: -0.339, fr: -0.316, rl: -0.182, rr: -0.164 },
    combinedSlip: { fl: 0.339, fr: 0.316, rl: 0.252, rr: 0.206 },
    acceleration: { x: -7.231, y: -0.033, z: 1.668 },
    angularVelocity: { y: -0.198 }
  },
  {
    speedKmh: 192.772,
    throttle: 1,
    brake: 0,
    steer: -1,
    slipRatio: { fl: 0.002, fr: 0, rl: 0.171, rr: 0.121 },
    slipAngle: { fl: -0.376, fr: -0.35, rl: -0.186, rr: -0.166 },
    combinedSlip: { fl: 0.377, fr: 0.35, rl: 0.279, rr: 0.232 },
    acceleration: { x: -7.629, y: -0.317, z: 1.47 },
    angularVelocity: { y: -0.216 }
  },
  {
    speedKmh: 192.847,
    throttle: 1,
    brake: 0,
    steer: -0.819,
    slipRatio: { fl: 0.003, fr: 0.001, rl: 0.17, rr: 0.119 },
    slipAngle: { fl: -0.42, fr: -0.391, rl: -0.191, rr: -0.17 },
    combinedSlip: { fl: 0.42, fr: 0.391, rl: 0.255, rr: 0.208 },
    acceleration: { x: -7.615, y: 0.17, z: 1.623 },
    angularVelocity: { y: -0.222 }
  },
  {
    speedKmh: 192.923,
    throttle: 1,
    brake: 0,
    steer: -0.181,
    slipRatio: { fl: 0, fr: -0.002, rl: 0.17, rr: 0.118 },
    slipAngle: { fl: -0.409, fr: -0.382, rl: -0.197, rr: -0.176 },
    combinedSlip: { fl: 0.409, fr: 0.382, rl: 0.26, rr: 0.212 },
    acceleration: { x: -7.803, y: 0.093, z: 1.562 },
    angularVelocity: { y: -0.23 }
  },
  {
    speedKmh: 192.998,
    throttle: 1,
    brake: 0,
    steer: 0,
    slipRatio: { fl: -0.013, fr: -0.011, rl: 0.173, rr: 0.12 },
    slipAngle: { fl: -0.184, fr: -0.175, rl: -0.206, rr: -0.184 },
    combinedSlip: { fl: 0.185, fr: 0.175, rl: 0.269, rr: 0.22 },
    acceleration: { x: -8.026, y: -0.082, z: 1.708 },
    angularVelocity: { y: -0.23 }
  }
])

module.exports = { CLEAN_REAL_SEGMENT }
