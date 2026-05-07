import { RenderLoop } from './render-loop.js'
import { Source } from './source.js'

export class SourceManager extends EventTarget {
  static events = {
    error: 'error',
    activate: 'activate'
  }

  #sources = new Map()
  #active = null

  #loop
  #callback
  #activeDirty = true

  async register (name, source, ...args) {
    this.#sources.set(name, source)

    source.addEventListener(Source.events.error, (e) => {
      this.#emitSourceError(source, e.detail)
    })

    source.addEventListener(Source.events.restart, () => {
      if (source === this.#active) {
        this.#setActive(source)
      }
    })

    source.addEventListener(Source.events.forceActivate, () => {
      if (source !== this.#active) {
        this.#setActive(source)
      }
    })

    await source.init(...args)
  }

  async setActive (name) {
    const next = this.#sources.get(name)
    await this.#setActive(next)
  }

  async #setActive (next) {
    if (this.#active) {
      await this.#loop?.stop?.()
      this.#active.deactivate()
    }

    this.#active = next
    this.#activeDirty = true

    if (!next) {
      return
    }

    try {
      await this.#active.activate?.()
    } catch (err) {
      this.#emitSourceError(next, err)
      return
    }

    this.dispatchEvent(new CustomEvent(SourceManager.events.activate, {
      detail: { name: this.getActiveName() }
    }))

    if (this.#callback) {
      this.#loop.start()
    }
  }

  // getFrame should really only be called from the callback
  // passed to startLoop. If a new frame is required e.g. due to
  // a change further down the pipeline which requires a full
  // re-render, then call requestNewFrame() which guarantees that
  // the callback will be run at the next available frame
  getFrame (device) {
    return this.#active?.getFrame?.(device) ?? null
  }

  requestNewFrame () {
    this.#activeDirty = true
  }

  #getSourceName (source) {
    for (const [k, v] of this.#sources.entries()) {
      if (v === source) {
        return k
      }
    }
    return null
  }

  getActiveName () {
    return this.#getSourceName(this.#active)
  }

  startLoop (callback) {
    this.#callback = callback
    this.#loop = new RenderLoop(
      this.#emitFrame,
      // Schedule a new frame
      (cb) => {
        this.#active.requestFrame(cb)
      },
      // Cancel the scheduled frame
      (handle) => {
        if (!handle) {
          return
        }
        this.#active.cancelFrame(handle)
      }
    )
    if (this.#active) {
      this.#loop.start()
    }
  }

  #emitFrame = () => {
    const cb = this.#callback
    if (!cb) {
      return
    }

    const isDirty = this.#activeDirty || (this.#active?.isDirty?.() ?? false)
    this.#activeDirty = false

    if (isDirty) {
      cb(this)
    }
  }

  #emitSourceError (source, error) {
    const isActive = source === this.#active
    const name = this.#getSourceName(source)

    this.dispatchEvent(new CustomEvent(SourceManager.events.error, {
      detail: { source: name, isActive, error }
    }))
  }
}
