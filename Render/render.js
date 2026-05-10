import { FFTWebGPU } from './WebGPU.js'
import { HoverTracker } from './HoverTracker.js'

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
  additionalOutput: {
    el: document.getElementById('additional-output-select'),
    storageKey: 'additional-output',
    default: 'None'
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
  },
  maskRange: {
    el: document.getElementById('ft-mask-range'),
    default: [0, 1],
    format: (v) => v.map(x => x * 100),
    parse: (v) => v.map(x => x / 100)
  },
  singleComponentZoom: {
    el: document.getElementById('single-component-zoom-checkbox'),
    storageKey: 'single-component-zoom',
    default: true
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
    this.canvases = canvases
    await this.gpu.init(canvases, size)
    this.hover = new HoverTracker(
      canvases.magnitude,
      canvases.hover,
      this.#updateHoverCoordinates
    )
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

    this.settings.subscribe('additionalOutput', (key) => {
      this.gpu.setRenderPhase(key === 'Phase')

      if (key === 'Inverse') {
        this.gpu.setRenderInverse(true)
        settings.maskRange.el.classList.remove('hidden')
        this.gpu.setMaskEnabled(true)
        this.gpu.setMaskWindow(FFTWebGPU.MaskWindows.HannWindow)
      } else {
        this.gpu.setRenderInverse(false)
        this.gpu.setMaskEnabled(false)
        settings.maskRange.el.classList.add('hidden')
      }

      // Update accessibility attributes
      if (key !== 'None') {
        const canvas = this.canvases.additional
        const labels = canvas.querySelectorAll('p')
        for (const el of labels) {
          if (el.id === key) {
            el.classList.remove('hidden')
            const title = el.getAttribute('data-title')
            canvas.title = title
            canvas.setAttribute('aria-label', title)
          } else {
            el.classList.add('hidden')
          }
        }
      }

      this.#markCanvasActive('additional', key !== 'None')
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

    this.settings.subscribe('maskRange', (val) => {
      this.gpu.setMaskRadii(...val)
      this.#emitDirty()
    })

    this.settings.subscribe('singleComponentZoom', (bool) => {
      this.hover.active = bool
      this.gpu.setRenderWave(bool)
      this.canvases.magnitude.classList.toggle('canvas-hover', bool)
    })

    this.settings.subscribe('lightDark', (val) => {
      const white = [ 1, 1, 1, 1 ]
      const black = [ 0, 0, 0, 1 ]
      this.gpu.setIntegrationPalette(val === 'light' ? { fg: black, bg: white } : { fg: white, bg: black })
      this.#emitDirty()
    })
  }

  #updateHoverCoordinates = (visible, x, y) => {
    this.gpu.setRenderWave(visible)
    if (visible) {
      this.gpu.setWaveCoordinates(x, y)
      this.#emitDirty()
    }
  }
}
