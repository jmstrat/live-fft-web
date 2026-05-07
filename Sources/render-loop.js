// Switching between requestVideoFrameCallback (for live camera) and
// requestAnimationFrame for non-video images has some subtlety to it
// so this class handles the necessary tracking. If the scheduling method
// is to be changed you must await .stop() and then call start()

const MONITOR_PERFORMANCE = false

export class RenderLoop {
  #renderCB
  #scheduleCB
  #cancelCB

  #isActive = false
  #isRendering = false
  #resolveStop = null
  #handle = null

  #b_tick

  constructor (render, schedule, cancel) {
    this.#renderCB = render
    this.#scheduleCB = schedule
    this.#cancelCB = cancel

    if (MONITOR_PERFORMANCE) {
      const monitor = new PerformanceMonitor()
      this.#b_tick = () => monitor.measure(this.#tick.bind(this))
    } else {
      this.#b_tick = this.#tick.bind(this)
    }
  }

  start () {
    if (this.#isActive) {
      return
    }
    this.#isActive = true
    this.#schedule()
  }

  async stop () {
    if (!this.#isActive) {
      return
    }

    this.#isActive = false

    if (!this.#isRendering) {
      this.#cancel()
      return
    }

    return new Promise((resolve) => {
      this.#resolveStop = resolve
    })
  }

  #schedule () {
    this.#handle = this.#scheduleCB(this.#b_tick)
  }

  async #tick () {
    this.#isRendering = true
    await this.#renderCB()
    this.#isRendering = false

    if (!this.#isActive) {
      if (this.#resolveStop) {
        this.#resolveStop()
        this.#resolveStop = null
      }
      return
    }
    this.#schedule()
  }

  #cancel () {
    if (this.#handle !== null) {
      this.#cancelCB(this.#handle)
      this.#handle = null
    }
  }
}

// n.b. This doesn't measure GPU Time
class PerformanceMonitor {
  constructor (interval = 1000) {
    this.interval = interval
    this.lastTime = performance.now()
    this.frameCount = 0
    this.totalDelta = 0
    this.totalWork = 0
  }

  async measure (fn) {
    const start = performance.now()
    const delta = start - this.lastTime
    this.lastTime = start

    await fn()

    const work = performance.now() - start
    this.frameCount++
    this.totalDelta += delta
    this.totalWork += work

    if (this.totalDelta >= this.interval) {
      const fps = Math.round((this.frameCount * 1000) / this.totalDelta)
      const avgF = (this.totalDelta / this.frameCount).toFixed(2)
      const avgW = (this.totalWork / this.frameCount).toFixed(2)
      console.log(`FPS: ${fps} | Frame: ${avgF}ms | Work: ${avgW}ms`)
      this.frameCount = 0
      this.totalDelta = 0
      this.totalWork = 0
    }
  }
}
