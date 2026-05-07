// TODO move the render() function into here
// Make .gpu global (shader setup etc.)
// make renderer just the render function
// This file can be Forward2DFFT()
// idea would be to allow easily swapping render workflows

import { FFTWebGPU } from './WebGPU.js'

const settings = {
  inputDisplay: {
    el: document.getElementById('input-display-select'),
    storageKey: 'input-display-mode',
    default: 'processed'
  },
  convertOption: {
    el: document.getElementById('input-convert-select'),
    storageKey: 'convert',
    default: 'PeriodicPlusSmooth'
  },
  flipX: {
    el: document.getElementById('flip-x-checkbox'),
    storageKey: 'flip-x',
    default: false
  },
  displayPhase: {
    el: document.getElementById('phase-checkbox'),
    storageKey: 'display-phase',
    default: false
  },
  magnitudeColourMap: {
    el: document.getElementById('magnitude-colourmap-select'),
    storageKey: 'mag-colour-map',
    default: 'Viridis'
  },
  phaseColourMap: {
    el: document.getElementById('phase-colourmap-select'),
    storageKey: 'phase-colour-map',
    default: 'Roma'
  },
  intensityScale: {
    el: document.getElementById('intensity-range'),
    storageKey: 'intensity-scale',
    default: 0.25,
    format: (v) => v * 100,
    parse: (v) => v / 100
  }
}

export class Renderer extends EventTarget {
  #dirtyPending = false

  static events = {
    dirty: 'dirty',
    canvasActive: 'canvas-active'
  }

  constructor (settingsManager) {
    super()
    this.settings = settingsManager
    this.gpu = new FFTWebGPU()
  }

  #emitDirty () {
    if (this.#dirtyPending) {
      return
    }
    setTimeout(
      () =>  this.dispatchEvent(new CustomEvent(Renderer.events.dirty)),
      0
    )
  }

  #markCanvasActive (canvas, bool) {
    this.dispatchEvent(new CustomEvent(Renderer.events.canvasActive, {
      detail: {
        canvas,
        active: bool
      }
    }))
  }

  async init (canvases, size) {
    await this.gpu.init(canvases, size)
    this.#subscribeToSettingsChanges()
    this.#addSettings()
  }

  render (frame) {
    this.#dirtyPending = false
    return this.gpu.render(frame)
  }

  #addSettings () {
    for (const [key, config] of Object.entries(settings)) {
      this.settings.addSetting(key, config)
    }
  }

  #subscribeToSettingsChanges () {
    this.settings.subscribe('inputDisplay', (key) => {
      this.gpu.setInputTextureDisplayMode(FFTWebGPU.InputDisplayMode[key])
      this.#emitDirty()
    })

    this.settings.subscribe('convertOption', (key) => {
      this.gpu.setInputTextureConvertMethod(FFTWebGPU.InputConversionMode[key])
      this.#emitDirty()
    })

    this.settings.subscribe('flipX', (bool) => {
      this.gpu.setFlipX(bool)
      this.#emitDirty()
    })

    this.settings.subscribe('displayPhase', (bool) => {
      this.#markCanvasActive('phase', bool)
      this.gpu.setRenderPhase(bool)
      this.#emitDirty()
    })

    this.settings.subscribe('magnitudeColourMap', (key) => {
      this.gpu.setMagnitudeColourMap(FFTWebGPU.MagnitudeColourMap[key])
      this.#emitDirty()
    })

    this.settings.subscribe('phaseColourMap', (key) => {
      this.gpu.setPhaseColourMap(FFTWebGPU.PhaseColourMap[key])
      this.#emitDirty()
    })

    this.settings.subscribe('intensityScale', (v) => {
      this.gpu.setMagnitudeScale(v)
      this.#emitDirty()
    })

    this.settings.subscribe('lightDark', (val) => {
      const white = [ 1, 1, 1, 1 ]
      const black = [ 0, 0, 0, 1 ]
      this.gpu.setIntegrationPalette(val === 'light' ? { fg: black, bg: white } : { fg: white, bg: black })
      this.#emitDirty()
    })
  }
}
