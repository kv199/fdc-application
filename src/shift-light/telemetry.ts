/**
 * Build-time telemetry contract for the FDC Shift Light learner.
 *
 * The native FH6 decoder and the normalized browser pipeline provide this
 * shape at runtime. Keeping the type local makes the learner independent of
 * any other application checkout.
 */
export interface Quad {
  fl: number
  fr: number
  rl: number
  rr: number
}

export interface Telemetry {
  isRaceOn: boolean
  timestampMs: number

  rpm: number
  rpmMax: number
  rpmIdle: number

  speedKmh: number
  power: number
  torque: number | null
  boost: number | null

  gear: number
  throttle: number
  brake: number
  clutch: number
  handBrake: number
  steer: number
  drivingLine: number | null
  aiBrakeDifference: number | null

  suspension: Quad
  suspensionMeters: Quad
  slipRatio: Quad
  slipAngle: Quad
  combinedSlip: Quad
  tireTempC: Quad
  wheelRotation: Quad | null
  rumble: { fl: boolean, fr: boolean, rl: boolean, rr: boolean } | null
  puddle: Quad | null

  yaw: number
  pitch: number
  roll: number

  position: { x: number, y: number, z: number }
  velocity: { x: number, y: number, z: number }
  acceleration: { x: number, y: number, z: number }
  angularVelocity: { x: number, y: number, z: number }

  car: {
    ordinal: number
    class: number
    pi: number
    drivetrain: number
    cylinders: number
  }

  lap: {
    number: number
    racePosition: number
    current: number
    last: number
    best: number
    raceTime: number
    distance: number
  }

  fuel: number | null
  rawLength: number
}
