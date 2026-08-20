const test = require('node:test')
const assert = require('node:assert/strict')

const { createSuiteProbe } = require('./suite-probe.js')

class FakeWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = new Map()
    FakeWebSocket.instances.push(this)
  }

  addEventListener(name, handler) {
    const handlers = this.listeners.get(name) || []
    handlers.push(handler)
    this.listeners.set(name, handlers)
  }

  emit(name, payload = {}) {
    for (const handler of this.listeners.get(name) || []) handler(payload)
  }

  close() {
    this.readyState = 3
    this.emit('close')
  }
}

function createTimerHarness() {
  let nextId = 1
  const timers = new Map()
  return {
    setTimer(handler, delay) {
      const id = nextId++
      timers.set(id, { handler, delay })
      return id
    },
    clearTimer(id) {
      timers.delete(id)
    },
    runNext() {
      const [id, timer] = timers.entries().next().value || []
      if (!timer) return null
      timers.delete(id)
      timer.handler()
      return timer.delay
    },
    count() {
      return timers.size
    }
  }
}

function setupProbe() {
  FakeWebSocket.instances = []
  const timers = createTimerHarness()
  const statuses = []
  const probe = createSuiteProbe({
    WebSocketImpl: FakeWebSocket,
    url: 'ws://127.0.0.1:3001/_ws',
    intervalMs: 5000,
    timeoutMs: 1000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onStatus: status => statuses.push(status)
  })
  return { probe, statuses, timers }
}

test('reports the provider waiting state and closes after the initial status', () => {
  const { probe, statuses, timers } = setupProbe()
  probe.start()
  assert.equal(timers.runNext(), 0)
  const socket = FakeWebSocket.instances[0]

  socket.emit('message', { data: JSON.stringify({ type: 'telemetry', t: {} }) })
  assert.deepEqual(statuses, [])
  socket.emit('message', { data: JSON.stringify({ type: 'forza_status', connected: false }) })

  assert.deepEqual(statuses, ['waiting'])
  assert.equal(socket.readyState, 3)
  assert.equal(timers.count(), 1)
})

test('reports when co-driver is also receiving Forza packets', () => {
  const { probe, statuses, timers } = setupProbe()
  probe.start()
  timers.runNext()
  FakeWebSocket.instances[0].emit('message', {
    data: JSON.stringify({ type: 'forza_status', connected: true })
  })

  assert.deepEqual(statuses, ['receiving'])
})

test('reports an unavailable provider after the probe timeout', () => {
  const { probe, statuses, timers } = setupProbe()
  probe.start()
  timers.runNext()
  assert.equal(timers.runNext(), 1000)

  assert.deepEqual(statuses, ['unavailable'])
})

test('keeps one probe in flight and cleans it up without reporting a false failure', () => {
  const { probe, statuses, timers } = setupProbe()
  probe.start()
  probe.start()
  assert.equal(timers.count(), 1)
  timers.runNext()
  const socket = FakeWebSocket.instances[0]

  probe.stop()

  assert.equal(socket.readyState, 3)
  assert.equal(timers.count(), 0)
  assert.deepEqual(statuses, [])
})
