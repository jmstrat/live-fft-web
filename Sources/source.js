export class Source extends EventTarget {
  static events = {
    restart: 'restart',
    forceActivate: 'force-activate',
    error: 'error'
  }

  constructor (settingsManager) {
    super()
    this.settings = settingsManager
  }

  // One time
  async init () {}

  // When the "active" source changes
  async activate () {}
  deactivate () {}

  // re-activates this source if it is currently active
  // (i.e. stop -> deactivate -> activate -> start)
  restart () {
    this.dispatchEvent(new CustomEvent(Source.events.restart))
  }

  // Sets the source as the active source
  // This overrides the user's choice, so should only be called in
  // response to direct user action
  forceActivate () {
    this.dispatchEvent(new CustomEvent(Source.events.forceActivate))
  }

  getFrame () {
    throw new Error('getFrame() must be implemented')
  }

  isDirty () {
    return true
  }

  requestFrame (cb) {
    return requestAnimationFrame(cb)
  }

  cancelFrame (handle) {
    cancelAnimationFrame(handle)
  }

  emitError (error) {
    this.dispatchEvent(new CustomEvent(Source.events.error, { detail: error }))
  }
}
