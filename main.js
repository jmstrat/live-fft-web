import { SettingsManager } from './settings.js'
import { FFTWebGPU } from './gpu.js'
import { Camera } from './camera.js'
import { Generators, init as initGenerators, setPalette } from './generators.js'
import { ImageCache } from './image-cache.js'
import { RenderLoop } from './render-loop.js'

import { showError, hideError } from './errors.js'

// This is a super-simple vanilla JS page. This file handles the settings and
// fetching the input image (either from a live camera or by running an
// external function). The business logic for performing the FFT and integration
// is handled by gpu.js and its associated shaders. The "Example Images" come
// from generators.js

const SIZE = 512 // Must be a power of RADIX (default 2)

const settings = new SettingsManager()
const gpu = new FFTWebGPU()
const camera = new Camera(SIZE)

camera.addEventListener('error', (event) => {
  const err = event.detail
  showError(err)
})

const imageCache = new ImageCache(SIZE, SIZE)
initGenerators(SIZE, SIZE)
let isReady = false
let lastDrawnImage = null

const SOURCES = {
  CAMERA: 'camera',
  GENERATOR: 'generator',
  IMAGE: 'image'
}

function getActiveGenerator () {
  return Generators[settings.get('currentPattern')] ?? Generators[Object.keys(Generators)[0]]
}

function markDirty () {
  const mode = settings.get('sourceMode')

  if (mode === SOURCES.GENERATOR) {
    getActiveGenerator()?.markDirty?.()
  } else if (mode === SOURCES.IMAGE) {
    lastDrawnImage = null
  }
}

const SETTING_DESCRIPTORS = {
  // Sources
  sourceMode: {
    el: document.getElementById('source-select'),
    storageKey: 'source',
    default: SOURCES.GENERATOR,
    onchange: async (mode) => {
      await loop.stop()
      const isCamera = mode === SOURCES.CAMERA
      const isGenerator = mode === SOURCES.GENERATOR
      const isImage = mode === SOURCES.IMAGE

      elements.camSection.classList.toggle('hidden', !isCamera)
      elements.genSection.classList.toggle('hidden', !isGenerator)
      elements.imageSection.classList.toggle('hidden', !isImage)

      warnIfImageModeAndNoImages()

      if (isCamera) {
        try {
          const deviceID = await camera.start(settings.get('deviceId'))
          settings.set('deviceId', deviceID)

          await refreshCameraOptions()
          hideError()
        } catch (err) {
          showError(err)
          return
        }
      } else {
        camera.stop()
        hideError()
      }

      markDirty()
      loop.start()
    }
  },
  deviceId: {
    el: document.getElementById('camera-select'),
    storageKey: 'camera',
    default: null,
    onchange: async (v) => {
      if (settings.get('sourceMode') !== SOURCES.CAMERA) {
        return
      }

      await loop.stop()
      try {
        const deviceID = await camera.start(v)
        settings.set('deviceId', deviceID)
        hideError()
      } catch (err) {
        showError(err)
      }
      loop.start()
    }
  },
  currentPattern: {
    el: document.getElementById('generator-select'),
    storageKey: 'generator',
    default: Object.keys(Generators)[0],
    onchange: () => {
      markDirty()
    }
  },
  currentImage: {
    el: document.getElementById('image-select'),
    default: ""
  },

  // Input
  inputDisplay: {
    el: document.getElementById('input-display-select'),
    storageKey: 'input-display-mode',
    default: 'processed',
    onchange: (v) => {
      gpu.setInputTextureDisplayMode(FFTWebGPU.InputDisplayMode[v])
      markDirty()
    }
  },
  convertOption: {
    el: document.getElementById('input-convert-select'),
    storageKey: 'convert',
    default: 'PeriodicPlusSmooth',
    onchange: (v) => {
      gpu.setInputTextureConvertMethod(FFTWebGPU.InputConversionMode[v])
      markDirty()
    }
  },
  flipX: {
    el: document.getElementById('flip-x-checkbox'),
    storageKey: 'flip-x',
    default: false,
    onchange: (v) => {
      gpu.setFlipX(v)
      markDirty()
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

      markDirty()
    }
  },
  magnitudeColourMap: {
    el: document.getElementById('magnitude-colourmap-select'),
    storageKey: 'mag-colour-map',
    default: 'Viridis',
    onchange: (v) => {
      gpu.setMagnitudeColourMap(FFTWebGPU.MagnitudeColourMap[v])
      markDirty()
    }
  },
  phaseColourMap: {
    el: document.getElementById('phase-colourmap-select'),
    storageKey: 'phase-colour-map',
    default: 'Roma',
    onchange: (v) => {
      gpu.setPhaseColourMap(FFTWebGPU.PhaseColourMap[v])
      markDirty()
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
      markDirty()
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
      const palette = isLight ? { fg: 'black', bg: 'white' } : { fg: 'white', bg: 'black' }
      setPalette(palette)
      markDirty()

      // Sync theme-colour (affects background and scrollbars on Safari)
      const systemMetas = document.querySelectorAll("meta[name='theme-color'][media]")
      systemMetas.forEach(el => el.remove())

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

const loop = new RenderLoop(
  render,
  // Schedule a new frame
  (cb) => {
    if (!isReady) {
      return false
    }
    if (settings.get('sourceMode') === SOURCES.CAMERA) {
      return camera.requestFrame(cb)
    } else {
      return requestAnimationFrame(cb)
    }
  },
  // Cancel the scheduled frame
  (handle) => {
    if (!handle) {
      return
    }

    if (settings.get('sourceMode') === SOURCES.CAMERA) {
      camera.cancelFrame(handle)
    } else {
      cancelAnimationFrame(handle)
    }
  }
)

async function render () {
  let source
  const mode = settings.get('sourceMode')

  if (mode === SOURCES.CAMERA) {
    source = camera.getExternalTexture(gpu.device)

    if (!source) {
      return
    }

  } else if (mode === SOURCES.GENERATOR) {
    const generator = getActiveGenerator()
    if (!generator.isDirty()) {
      return
    }
    generator.draw()
    source = generator.canvas
  } else if (mode === SOURCES.IMAGE) {
    source = imageCache.get(settings.get('currentImage'))
    if (!source) {
      source = imageCache.black
    }

    if (source === lastDrawnImage) {
      return
    }
    lastDrawnImage = source
  }

  gpu.render(source)
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
    await initSettings()

    renderPatternOptions()
    await refreshCameraOptions()
    refreshImageOptions()
    setupDragAndDrop()
    setupFullscreen()
    isReady = true
    await loop.stop()
    loop.start()
  } catch (err) {
    showError(err)
    return
  } finally {
    elements.loading.classList.add('hidden')
  }
}

function renderPatternOptions () {
    const patternOptions = Object.keys(Generators).map(name => new Option(name, name))
    settings.setOptions('currentPattern', patternOptions)
}

async function refreshCameraOptions () {
  const devices = await camera.getDevices()
  const deviceOptions = devices
    .map(({ deviceId, label }) => new Option(label || 'Camera', deviceId))

  settings.setOptions('deviceId', deviceOptions)
}

function refreshImageOptions () {
  const placeholder = new Option("Drag & Drop to add images to this list", "")
  placeholder.disabled = true
  const separator = new Option("\u2500".repeat(10))
  separator.disabled = true

  const names = imageCache.names
  const imageOptions = names.map(name => new Option(name, name))

  settings.setOptions('currentImage', [placeholder, separator, ...imageOptions])

  if (names.length > 0) {
    const value = names.at(-1)
    settings.set('currentImage', value)
  } else {
    settings.set('currentImage', "")
  }
}

function warnIfImageModeAndNoImages () {
  if (settings.get('sourceMode') === SOURCES.IMAGE) {
    const size = imageCache.size
    if (size < 1) {
      elements.noImages.classList.remove('hidden')
      return
    }
  }

  elements.noImages.classList.add('hidden')
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

function setupDragAndDrop () {
  window.addEventListener('dragover', e => {
    e.preventDefault()
    const types = Array.from(e.dataTransfer.types || [])
    const isFileDrag = types.includes('Files')

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      let hasImage = false
      let hasMultipleImages = false
      for (const item of e.dataTransfer.items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          if (hasImage) {
            hasMultipleImages = true
            break
          } else {
            hasImage = true
          }
        }
      }

      if (hasImage) {
        elements.drop.classList.remove('hidden')
        elements.noImages.classList.add('hidden')
        e.dataTransfer.dropEffect = 'copy'

        if (hasMultipleImages) {
          elements.drop.classList.add('contains-plural')
        } else {
          elements.drop.classList.remove('contains-plural')
        }
      } else {
        e.dataTransfer.dropEffect = 'none'
      }
    } else if (isFileDrag) {
      // Safari doesn't populate items on dragover
      elements.drop.classList.remove('hidden')
      elements.noImages.classList.add('hidden')
      elements.drop.classList.add('contains-plural')
      e.dataTransfer.dropEffect = 'copy'
    }
  })

  window.addEventListener('dragleave', e => {
    elements.drop.classList.add('hidden')
    warnIfImageModeAndNoImages()
  })

  window.addEventListener('drop', e => {
    e.preventDefault()
    elements.drop.classList.add('hidden')
  })

  window.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer.files)
                  .filter(file => file.type.startsWith('image/'))

    if (files.length === 0) {
      return
    }

    await Promise.all(files.map(file => imageCache.add(file)))
    refreshImageOptions()
    SETTING_DESCRIPTORS.sourceMode.el.value = "image"
    SETTING_DESCRIPTORS.sourceMode.el.dispatchEvent(new Event('change'))
    warnIfImageModeAndNoImages()
  })
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
