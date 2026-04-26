// Switching between requestVideoFrameCallback (for live camera) and
// requestAnimationFrame for non-video images has some subtlety to it
// so this class handles the necessary tracking. If the scheduling method
// is to be changed you must await .stop() and then call start()
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
    this.#b_tick = this.#tick.bind(this)
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
