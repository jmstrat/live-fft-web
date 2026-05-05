import { FFTWebGPU } from './gpu.js'
import { Camera } from './camera.js'
import { Generators, init as initGenerators, setPalette } from './generators.js'
import { ImageCache } from './image-cache.js'
import { RenderLoop } from './render-loop.js'

// This is a super-simple vanilla JS page. This file handles the settings and
// fetching the input image (either from a live camera or by running an
// external function). The business logic for performing the FFT and integration
// is handled by gpu.js and its associated shaders. The "Example Images" come
// from generators.js

const SIZE = 512 // Must be a power of RADIX (default 2)

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

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

const SOURCES = {
  CAMERA: 'camera',
  GENERATOR: 'generator',
  IMAGE: 'image'
}

function getActiveGenerator () {
  return Generators[settings.currentPattern.value] ?? Generators[Object.keys(Generators)[0]]
}

function markDirty () {
  const mode = settings.sourceMode.value

  if (mode === SOURCES.GENERATOR) {
    getActiveGenerator()?.markDirty?.()
  } else if (mode === SOURCES.IMAGE) {
    lastDrawnImage = null
  }
}

const settings = {
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
          const deviceID = await camera.start(settings.deviceId.value)
          settings.deviceId.store(deviceID)

          await refreshCameraOptions()
          _hideError()
        } catch (err) {
          showError(err)
          return
        }
      } else {
        camera.stop()
        _hideError()
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
      if (settings.sourceMode.value !== SOURCES.CAMERA) {
        return
      }

      await loop.stop()
      try {
        const deviceID = await camera.start(v)
        settings.deviceId.store(deviceID)
        _hideError()
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
    onchange: (v, e) => {
      const isLight = v === 'auto' ? !darkQuery.matches : v === 'light'
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

      if (!e) {
        return
      }
      if (!e.target.matches(':focus-visible')) {
        e.target.blur()
      }
    },
    setElValue: (v) => {
      const input = settings.lightDark.el.querySelector(`input[value="${v}"]`)
      if (input) {
        input.checked = true
      }
    }
  }
}

darkQuery.addEventListener('change', (e) => {
  settings.lightDark.onchange(settings.lightDark.value)
})

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
    if (settings.sourceMode.value === SOURCES.CAMERA) {
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

    if (settings.sourceMode.value === SOURCES.CAMERA) {
      camera.cancelFrame(handle)
    } else {
      cancelAnimationFrame(handle)
    }
  }
)

async function render () {
  let source
  const mode = settings.sourceMode.value

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
    source = imageCache.get(settings.currentImage.value)
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
  const patternOptions = Object.keys(Generators).map(name => {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    return opt
  })
  settings.currentPattern.el.replaceChildren(...patternOptions)
  settings.currentPattern.refreshElValue()
}

async function refreshCameraOptions () {
  const devices = await camera.getDevices()
  const deviceOptions = devices
    .map(({ deviceId, label }) => new Option(label || 'Camera', deviceId))
  settings.deviceId.el.replaceChildren(...deviceOptions)
  settings.deviceId.refreshElValue()
}

function refreshImageOptions () {
  const placeholder = new Option("Drag & Drop to add images to this list", "")
  placeholder.disabled = true
  const separator = new Option("\u2500".repeat(10))
  separator.disabled = true

  const names = imageCache.names
  const imageOptions = names.map(name => new Option(name, name))

  const imageSelect = settings.currentImage.el

  imageSelect.replaceChildren(placeholder, separator, ...imageOptions)

  if (names.length > 0) {
    imageSelect.value = names.at(-1)
    imageSelect.dispatchEvent(new Event('change'))
  } else {
    imageSelect.selectedIndex = 0
  }
}

function warnIfImageModeAndNoImages () {
  if (settings.sourceMode.value === SOURCES.IMAGE) {
    const size = imageCache.size
    if (size < 1) {
      elements.noImages.classList.remove('hidden')
      return
    }
  }

  elements.noImages.classList.add('hidden')
}

async function initSettings () {
  for (const cfg of Object.values(settings)) {
    const saved = cfg.storageKey ? localStorage.getItem(cfg.storageKey) : null

    let val = cfg.default
    if (saved !== null) {
      if (typeof cfg.default === 'boolean') {
        val = saved === 'true'
      } else if (typeof cfg.default === 'number') {
        val = parseFloat(saved)
      } else {
        val = saved
      }
    }

    cfg.store = (value) => {
      cfg.value = value
      if (cfg.storageKey) {
        localStorage.setItem(cfg.storageKey, value)
      }
    }

    cfg.value = val

    if (cfg.el) {
      const isCheckbox = cfg.el.type === 'checkbox'
      cfg.refreshElValue = () => {
        const uiVal = cfg.toUI ? cfg.toUI(cfg.value) : cfg.value

        if (cfg.setElValue) {
          cfg.setElValue(uiVal)
        }
        else if (isCheckbox) {
          cfg.el.checked = uiVal
        } else {
          cfg.el.value = uiVal
        }
      }

      cfg.refreshElValue()
      cfg.el.addEventListener(isCheckbox ? 'click' : 'change', (e) => {
        const raw = isCheckbox ? e.target.checked : e.target.value
        const final = cfg.fromUI ? cfg.fromUI(raw) : raw

        cfg.store(final)

        if (cfg.onchange) {
          cfg.onchange(final, e)
        }
      })
    }
  }

  for (const cfg of Object.values(settings)) {
    if (cfg.onchange) {
      await cfg.onchange(cfg.value)
    }
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
    settings.sourceMode.el.value = "image"
    settings.sourceMode.el.dispatchEvent(new Event('change'))
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

function showError (err) {
  console.error(err)
  let title = "Application Error"
  let message = "An unexpected error occurred."
  let code
  let modal = true

  switch (err.code || err.name) {
    case 'WEBGPU_MISSING':
      title = "Browser Update Required"
      message = "Your browser doesn't support WebGPU. Try updating to a newer version."
      break
    case 'WEBGPU_ADAPTER_MISSING':
      title = "Graphics Card Issue"
      message = "We couldn't find a compatible graphics card. Make sure your drivers are up to date."
      break
    case 'LIMITS_UNSUPPORTED':
      title = "Hardware Unsupported"
      message = "Your GPU may not be powerful enough to run at this resolution."
      break
    case 'OverconstrainedError':
      title = "Camera Error"
      message = "Unable to capture images from your camera at the required resolution."
      modal = false
      break
    case 'CAMERA_DENIED':
    case 'CAMERA_REVOKED':
      title = 'Camera Permission Denied'
      message = "If you wish to use the live camera input, you must enable the camera permission in your browser and OS settings. You can use the other input modes without granting camera permission."
      modal = false
      break
    case 'CAMERA_ERROR':
      title = 'Camera Error'
      message = 'The camera could not be started, please try another camera or a different input mode.'
      code = err.message
      modal = false
      break
    case 'CAMERA_STOPPED':
      title = 'Camera Error'
      message = "The camera unexpectedly stopped."
      modal = false
      break
    case 'CAMERA_DISCONNECTED':
      title = 'Camera Disconnected'
      message = "The selected camera is no-longer available. Please reconnect the device or choose an alternative camera or input mode."
      modal = false
      break
    default:
      message = `${message}\n${err.message || err.name}.`
      code = err.code
  }
  _showError(title, message, code, modal)
}

function _showError (title, message, code = "", modal=true) {
  elements.errorTitle.textContent = title
  elements.errorMsg.textContent = message

  if (code) {
    elements.errorCode.textContent = code
    elements.errorCode.classList.remove('hidden')
  } else {
    elements.errorCode.classList.add('hidden')
  }

  elements.errorOverlay.classList.toggle('modal', modal)
  elements.errorOverlay.classList.remove('hidden')
}

function _hideError () {
  elements.errorOverlay.classList.add('hidden')
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
