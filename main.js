import { SettingsManager } from './settings.js'
import { FFTWebGPU } from './gpu.js'

import { SourceManager } from './Sources/manager.js'
import { CameraSource } from './Sources/Camera/camera-source.js'
import { GeneratorSource } from './Sources/Canvas/canvas-source.js'
import { ImageSource } from './Sources/Image/image-source.js'

import { showError, hideError } from './errors.js'

const SIZE = 512 // Must be a power of RADIX (default 2)

const settings = new SettingsManager()
const sources = new SourceManager()
const gpu = new FFTWebGPU()

const SOURCES = {
  CAMERA: 'camera',
  GENERATOR: 'generator',
  IMAGE: 'image'
}

const SETTING_DESCRIPTORS = {
  sourceMode: {
    el: document.getElementById('source-select'),
    storageKey: 'source',
    default: SOURCES.GENERATOR,
    onchange: async (mode) => {
      await sources.setActive(mode)
    }
  },
  // Input
  inputDisplay: {
    el: document.getElementById('input-display-select'),
    storageKey: 'input-display-mode',
    default: 'processed',
    onchange: (v) => {
      gpu.setInputTextureDisplayMode(FFTWebGPU.InputDisplayMode[v])
      sources.requestNewFrame()
    }
  },
  convertOption: {
    el: document.getElementById('input-convert-select'),
    storageKey: 'convert',
    default: 'PeriodicPlusSmooth',
    onchange: (v) => {
      gpu.setInputTextureConvertMethod(FFTWebGPU.InputConversionMode[v])
      sources.requestNewFrame()
    }
  },
  flipX: {
    el: document.getElementById('flip-x-checkbox'),
    storageKey: 'flip-x',
    default: false,
    onchange: (v) => {
      gpu.setFlipX(v)
      sources.requestNewFrame()
    }
  },

  // Output
  displayPhase: {
    el: document.getElementById('phase-checkbox'),
    storageKey: 'display-phase',
    default: false,
    onchange: (v) => {
      if (v) {
        elements.dashboard.classList.add('col-3')
        elements.phase.classList.remove('hidden')
        gpu.setRenderPhase(true)
      } else {
        elements.dashboard.classList.remove('col-3')
        elements.phase.classList.add('hidden')
        gpu.setRenderPhase(false)
      }

      sources.requestNewFrame()
    }
  },
  magnitudeColourMap: {
    el: document.getElementById('magnitude-colourmap-select'),
    storageKey: 'mag-colour-map',
    default: 'Viridis',
    onchange: (v) => {
      gpu.setMagnitudeColourMap(FFTWebGPU.MagnitudeColourMap[v])
      sources.requestNewFrame()
    }
  },
  phaseColourMap: {
    el: document.getElementById('phase-colourmap-select'),
    storageKey: 'phase-colour-map',
    default: 'Roma',
    onchange: (v) => {
      gpu.setPhaseColourMap(FFTWebGPU.PhaseColourMap[v])
      sources.requestNewFrame()
    }
  },
  intensityScale: {
    el: document.getElementById('intensity-range'),
    storageKey: 'intensity-scale',
    default: 0.25,
    toUI: (v) => v * 100,
    fromUI: (v) => v / 100,
    onchange: (v) => {
      gpu.setMagnitudeScale(v)
      sources.requestNewFrame()
    }
  },

  lightDark:  {
    el: document.getElementById('theme-switcher'),
    storageKey: 'theme',
    default: 'auto',
    onchange: (v) => {
      const isLight = v === 'light'
      document.body.classList.toggle('light-mode', isLight)
      const white = [ 1, 1, 1, 1 ]
      const black = [ 0, 0, 0, 1 ]
      gpu.setIntegrationPalette(isLight ? { fg: black, bg: white } : { fg: white, bg: black })

      const styles = getComputedStyle(document.body)
      const bgColour = styles.getPropertyValue('--bg-colour').trim()
      let activeMeta = document.querySelector("meta[name='theme-color']:not([media])")
      if (!activeMeta) {
        activeMeta = document.createElement('meta')
        activeMeta.name = "theme-color"
        document.head.appendChild(activeMeta)
      }
      activeMeta.setAttribute("content", bgColour)
    }
  }
}

const elements = {
  dashboard: document.getElementById('dashboard'),
  // Canvases
  input: document.getElementById('input-canvas'),
  magnitude: document.getElementById('fft-magnitude'),
  phase: document.getElementById('fft-phase'),
  integration: document.getElementById('integration-canvas'),

  // Input sections
  camSection: document.getElementById('camera-section'),
  genSection: document.getElementById('generator-section'),
  imageSection: document.getElementById('image-section'),

  // Buttons
  fullscreenBtn: document.getElementById('fullscreen-btn'),

  // Overlays
  loading: document.getElementById('loading-overlay'),
  noImages: document.getElementById('no-images-overlay'),
  drop: document.getElementById('drop-overlay'),
  errorOverlay: document.getElementById('error-overlay'),
  errorTitle: document.getElementById('error-title'),
  errorMsg: document.getElementById('error-message'),
  errorCode: document.getElementById('error-code')
}

async function render () {
  const frame = sources.getFrame(gpu.device)
  gpu.render(frame)
}

async function init () {
  elements.input.width = elements.input.height = SIZE
  elements.magnitude.width = elements.magnitude.height = SIZE
  elements.phase.width = elements.phase.height = SIZE
  elements.integration.width = SIZE * 2
  elements.integration.height = SIZE / 2

  try {
    await gpu.init(
      {
        input: elements.input,
        magnitude: elements.magnitude,
        phase: elements.phase,
        integration: elements.integration
      },
      SIZE
    )
    await initialiseSources()
    await initSettings()

    setupFullscreen()
    sources.startLoop(render)
  } catch (err) {
    showError(err)
    return
  } finally {
    elements.loading.classList.add('hidden')
  }
}

async function initialiseSources () {
  sources.addEventListener(SourceManager.events.error, (event) => {
    const { source, isActive, error } = event.detail
    if (isActive) {
      showError(error)
    } else {
      console.error(`Error from inactive source ${source}`)
      console.error(error)
    }
  })

  sources.addEventListener(SourceManager.events.activate,
    ({ detail: { name } }) => {
      settings.set('sourceMode', name)
      hideError()
    }
  )

  const camera = new CameraSource(settings)
  await sources.register(SOURCES.CAMERA, camera, SIZE)

  const generator = new GeneratorSource(settings)
  await sources.register(SOURCES.GENERATOR, generator, SIZE)

  const image = new ImageSource(settings)
  await sources.register(SOURCES.IMAGE, image, SIZE)
}

async function initSettings () {
  for (const [key, config] of Object.entries(SETTING_DESCRIPTORS)) {
    // TODO this is a temporary change pending a larger refactor
    if (config.onchange) {
      settings.subscribe(key, config.onchange)
    }
    settings.addSetting(key, config)
  }
}

function setupFullscreen () {
  elements.fullscreenBtn.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      } else {
        document.exitFullscreen()
      }
    } catch (err) {
      console.error(err)
    }
  })
}

init()

// Workaround for Safari bug:
// In a popover positioned with position-anchor, the OS native picker window
// is not positioned correctly unless the input is focused before the click
// event fires.
// This workaround forces the element to be focused before it receives the
// mousedown event, which seems to fix the bug.
// Chrome / Firefox work fine with or without this workaround, so enabling it
// everywhere for consistency.
document.addEventListener('mousedown', (e) => {
  if (e.target.tagName === 'SELECT') {
    e.target.focus()
    void e.target.offsetWidth
  }
}, { capture: true })
