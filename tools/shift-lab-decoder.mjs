// Decodes one 324-byte Forza Horizon 6 Data Out packet into the object the native decoder sends to the HUD.
// Mirrors decode_direct_packet in src-tauri/src/telemetry.rs: f32 arithmetic, then the shortest f32 decimal JSON would print.
const PACKET_BYTES = 324
const DASH = 244
const f32 = Math.fround

// serde_json writes the shortest decimal that round-trips as f32; the HUD then parses that decimal.
export function f32ToJson(value) {
  if (!Number.isFinite(value)) return null
  if (value === 0) return Object.is(value, -0) ? -0 : 0
  for (let precision = 1; precision <= 9; precision++) {
    const candidate = Number(value.toPrecision(precision))
    if (Math.fround(candidate) === value) return candidate
  }
  return value
}

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function isPacket(bytes) {
  return bytes instanceof Uint8Array && bytes.byteLength === PACKET_BYTES
}

export function decodeIdentity(bytes) {
  if (!isPacket(bytes)) return null
  const view = viewOf(bytes)
  return {
    ordinal: view.getInt32(212, true),
    class: view.getInt32(216, true),
    pi: view.getInt32(220, true),
    drivetrain: view.getInt32(224, true),
    cylinders: view.getInt32(228, true)
  }
}

export function decodePacket(bytes) {
  if (!isPacket(bytes)) return null
  const view = viewOf(bytes)
  const float = offset => view.getFloat32(offset, true)
  const out = offset => f32ToJson(float(offset))
  const quad = offset => ({
    fl: out(offset), fr: out(offset + 4), rl: out(offset + 8), rr: out(offset + 12)
  })
  const convertedQuad = (offset, convert) => ({
    fl: f32ToJson(convert(float(offset))), fr: f32ToJson(convert(float(offset + 4))),
    rl: f32ToJson(convert(float(offset + 8))), rr: f32ToJson(convert(float(offset + 12)))
  })
  const vec3 = offset => ({ x: out(offset), y: out(offset + 4), z: out(offset + 8) })
  const u8 = offset => view.getUint8(offset)
  const unitFraction = (raw, scale) => f32(f32(raw) / scale)
  const fahrenheitToCelsius = value => f32(f32(f32(value - 32) * 5) / 9)
  const rumble = offset => float(offset) > 0

  return {
    isRaceOn: view.getInt32(0, true) === 1,
    timestampMs: view.getUint32(4, true),
    rpmMax: out(8),
    rpmIdle: out(12),
    rpm: out(16),
    speedKmh: f32ToJson(f32(float(DASH + 12) * f32(3.6))),
    power: out(DASH + 16),
    torque: out(DASH + 20),
    boost: out(DASH + 40),
    gear: u8(DASH + 75),
    throttle: f32ToJson(unitFraction(u8(DASH + 71), 255)),
    brake: f32ToJson(unitFraction(u8(DASH + 72), 255)),
    clutch: f32ToJson(unitFraction(u8(DASH + 73), 255)),
    handBrake: f32ToJson(unitFraction(u8(DASH + 74), 255)),
    steer: f32ToJson(unitFraction(view.getInt8(DASH + 76), 127)),
    drivingLine: view.getInt8(DASH + 77),
    aiBrakeDifference: view.getInt8(DASH + 78),
    suspension: quad(68),
    suspensionMeters: quad(196),
    slipRatio: quad(84),
    slipAngle: quad(164),
    combinedSlip: quad(180),
    tireTempC: convertedQuad(DASH + 24, fahrenheitToCelsius),
    wheelRotation: quad(100),
    rumble: { fl: rumble(116), fr: rumble(120), rl: rumble(124), rr: rumble(128) },
    puddle: quad(132),
    yaw: out(56),
    pitch: out(60),
    roll: out(64),
    position: vec3(DASH),
    velocity: vec3(32),
    acceleration: vec3(20),
    angularVelocity: vec3(44),
    car: {
      ordinal: view.getInt32(212, true),
      class: view.getInt32(216, true),
      pi: view.getInt32(220, true),
      carGroup: view.getUint32(232, true),
      drivetrain: view.getInt32(224, true),
      cylinders: view.getInt32(228, true)
    },
    lap: {
      number: view.getUint16(DASH + 68, true),
      racePosition: u8(DASH + 70),
      current: out(DASH + 60),
      last: out(DASH + 56),
      best: out(DASH + 52),
      raceTime: out(DASH + 64),
      distance: out(DASH + 48)
    },
    fuel: out(DASH + 44),
    rawLength: PACKET_BYTES
  }
}
