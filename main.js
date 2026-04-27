import { FFTWebGPU } from './gpu.js'
import { Camera } from './camera.js'
import { Generators, init as initGenerators } from './generators.js'
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
  return Generators[settings.currentPattern.value]
}

const settings = {
  // Sources
  sourceMode: {
    el: document.getElementById('sourceSelect'),
    storageKey: 'source',
    default: SOURCES.GENERATOR,
    onchange: async (mode) => {
      await loop.stop()
      const isCamera = mode === SOURCES.CAMERA
      elements.camSection.classList.toggle('hidden', !isCamera)
      elements.genSection.classList.toggle('hidden', mode !== SOURCES.GENERATOR)
      elements.imageSection.classList.toggle('hidden', mode !== SOURCES.IMAGE)
      if (isCamera) {
        try {
          const deviceID = await camera.start(settings.deviceId.value)
          settings.deviceId.store(deviceID)

          await refreshCameraOptions()
        } catch (err) {
          showError(err)
        }
      } else {
        camera.stop()
      }

      if (mode === SOURCES.GENERATOR) {
        getActiveGenerator().markDirty()
      }

      if (mode === SOURCES.IMAGE) {
        lastDrawnImage = null
      }

      loop.start()
    }
  },
  deviceId: {
    el: document.getElementById('videoDevices'),
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
      } catch (err) {
        showError(err)
      }
      loop.start()
    }
  },
  currentPattern: {
    el: document.getElementById('patternSelect'),
    storageKey: 'generator',
    default: Object.keys(Generators)[0],
    onchange: () => {
      getActiveGenerator().markDirty()
    }
  },
  currentImage: {
    el: document.getElementById('imageSelect'),
    default: ""
  },

  // Input
  inputDisplay: {
    el: document.getElementById('input-display'),
    storageKey: 'input-display-mode',
    default: 'processed',
    onchange: (v) => gpu.setInputTextureDisplayMode(FFTWebGPU.InputDisplayMode[v])
  },
  convertOption: {
    el: document.getElementById('convert'),
    storageKey: 'convert',
    default: 'PeriodicPlusSmooth',
    onchange: (v) => gpu.setInputTextureConvertMethod(FFTWebGPU.InputConversionMode[v])
  },
  flipX: {
    el: document.getElementById('flip-x'),
    storageKey: 'flip-x',
    default: false,
    onchange: (v) => gpu.setFlipX(v)
  },

  // Output
  colourMap: {
    el: document.getElementById('colourMap'),
    storageKey: 'colour-map',
    default: 'None',
    onchange: (v) => gpu.setColourMap(FFTWebGPU.ColourMap[v])
  },
  intensityScale: {
    el: document.getElementById('scale'),
    storageKey: 'intensity-scale',
    default: 0.25,
    toUI: (v) => v * 100,
    fromUI: (v) => v / 100,
    onchange: (v) => gpu.setMagnitudeScale(v)
  }
}

const elements = {
  // Canvases
  input: document.getElementById('inputCanvas'),
  output: document.getElementById('gpuCanvas'),
  integration: document.getElementById('integrationCanvas'),

  // Input sections
  camSection: document.getElementById('cameraSection'),
  genSection: document.getElementById('generatorSection'),
  imageSection: document.getElementById('imageSection'),

  // Buttons
  fullscreenBtn: document.getElementById('fullscreen-btn'),

  // Overlays
  loading: document.getElementById('loading'),
  drop: document.getElementById('drop'),
  errorOverlay: document.getElementById('errorOverlay'),
  errorTitle: document.getElementById('errorTitle'),
  errorMsg: document.getElementById('errorMessage'),
  errorCode: document.getElementById('errorCode')
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
  elements.output.width = elements.output.height = SIZE
  elements.integration.width = SIZE * 2
  elements.integration.height = SIZE / 2

  try {
    await gpu.init(elements.input, elements.output, elements.integration, SIZE)
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
    loading.classList.add('hidden')
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

        if (isCheckbox) {
          cfg.el.checked = uiVal
        } else {
          cfg.el.value = uiVal
        }
      }


      cfg.refreshElValue()
      cfg.el.addEventListener(isCheckbox ? 'click' : 'change', () => {
        const raw = isCheckbox ? cfg.el.checked : cfg.el.value
        const final = cfg.fromUI ? cfg.fromUI(raw) : raw

        cfg.store(final)

        if (cfg.onchange) {
          cfg.onchange(final)
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
    if (e.dataTransfer.items) {
      const isImage = Array.from(e.dataTransfer.items).some(item =>
        item.kind === 'file' && item.type.startsWith('image/')
      )

      if (isImage) {
        elements.drop.classList.remove('hidden')
        e.dataTransfer.dropEffect = 'copy'
      } else {
        e.dataTransfer.dropEffect = 'none'
      }
    }
  })

  window.addEventListener('dragleave', e => {
    elements.drop.classList.add('hidden')
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
  })
}

function setupFullscreen () {
  elements.fullscreenBtn.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      await document.body.requestFullscreen()
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
      break
    default:
      message = `${message}\n${err.message || err.name}.`
      code = err.code
  }
  _showError(title, message, code)
}

function _showError (title, message, code = "") {
  elements.errorTitle.textContent = title
  elements.errorMsg.textContent = message

  if (code) {
    elements.errorCode.textContent = code
    elements.errorCode.classList.remove('hidden')
  } else {
    elements.errorCode.classList.add('hidden')
  }

  elements.errorOverlay.classList.remove('hidden')
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
