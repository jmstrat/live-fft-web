import { FFTWebGPU } from './gpu.js'
import { Generators, clearCanvas } from './generators.js'
import { ImageCache } from './image-cache.js'

// This is a super-simple vanilla JS page. This file handles the settings and
// fetching the input image (either from a live camera or by running an
// external function). The business logic for performing the FFT and integration
// is handled by gpu.js and its associated shaders. The "Example Images" come
// from generators.js


const SIZE = 512 // Must be a power of RADIX (default 2)

const SOURCES = {
  CAMERA: 'camera',
  GENERATOR: 'generator',
  IMAGE: 'image'
}

const settings = {
  // Sources
  sourceMode: {
    el: document.getElementById('sourceSelect'),
    storageKey: 'source',
    default: SOURCES.GENERATOR,
    onchange: (v) => changeSourceMode(v)
  },
  deviceId: {
    el: document.getElementById('videoDevices'),
    storageKey: 'camera',
    default: null
  },
  currentPattern: {
    el: document.getElementById('patternSelect'),
    storageKey: 'generator',
    default: Object.keys(Generators)[0]
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
  errorCode: document.getElementById('errorCode'),

  // Offscreen
  videoElement: document.createElement('video')
}


const gpu = new FFTWebGPU()
const generatorCanvas = new OffscreenCanvas(SIZE, SIZE)
const ctx = generatorCanvas.getContext('2d', { willReadFrequently: true })

const imageCache = new ImageCache(SIZE, SIZE)

async function init () {
  elements.input.width = elements.input.height = SIZE
  elements.output.width = elements.output.height = SIZE
  elements.integration.width = SIZE * 2
  elements.integration.height = SIZE / 2

  try {
    await gpu.init(elements.input, elements.output, elements.integration, SIZE)

    renderPatternOptions()
    await refreshCameraOptions()
    refreshImageOptions()
    initSettings()
    setupDragAndDrop()
    setupFullscreen()
  } catch (err) {
    showError(err)
    return
  } finally {
    loading.classList.add('hidden')
  }

  loop()
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
  const devices = await navigator.mediaDevices.enumerateDevices()
  const deviceOptions = devices
    .filter(({ kind }) => kind === 'videoinput')
    .map(({ deviceId, label }) => new Option(label || 'Camera', deviceId))
  settings.deviceId.el.replaceChildren(...deviceOptions)
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

async function changeSourceMode (mode) {
  const isCamera = mode === SOURCES.CAMERA
  elements.camSection.classList.toggle('hidden', !isCamera)
  elements.genSection.classList.toggle('hidden', mode !== SOURCES.GENERATOR)
  elements.imageSection.classList.toggle('hidden', mode !== SOURCES.IMAGE)
  if (isCamera) {
    await startCamera()
  } else {
    stopCamera()
  }
}

function initSettings () {
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
    cfg.value = val
    if (cfg.onchange) {
      cfg.onchange(val)
    }

    cfg.store = (value) => {
      cfg.value = value
      if (cfg.storageKey) {
        localStorage.setItem(cfg.storageKey, value)
      }
    }

    if (cfg.el) {
      const isCheckbox = cfg.el.type === 'checkbox'
      const uiVal = cfg.toUI ? cfg.toUI(val) : val

      if (isCheckbox) {
        cfg.el.checked = uiVal
      } else {
        cfg.el.value = uiVal
      }

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

async function startCamera () {
  const constraints = {
    width: { ideal: SIZE },
    height: { ideal: SIZE },
    aspectRatio: { exact: 1 },
    resizeMode: 'crop-and-scale',
    ...(settings.deviceId.value && { deviceId: { exact: settings.deviceId.value } })
  }
  // Need to use an exact rather than ideal deviceId to allow the camera to
  // change from the default, but this would cause an error if the stored
  // id no-longer exists, so we retry with no device id on failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: constraints })

      elements.videoElement.srcObject = stream
      elements.videoElement.play()

      const activeTrack = stream.getVideoTracks()[0]
      settings.deviceId.store(activeTrack.getSettings().deviceId)
      return
    } catch (err) {
      const isMissing = ['NotFoundError', 'DevicesNotFoundError'].includes(err.name)
      const isOverconstrained = err.name === 'OverconstrainedError' && err.constraint === 'deviceId'

      // Only retry if the deviceId was the problem and we haven't already tried the fallback
      if (constraints.deviceId && (isMissing || isOverconstrained)) {
        console.error(`Camera ${settings.deviceId.value} not found`)
        delete constraints.deviceId
        continue
      }

      showError(err)
      return
    }
  }
}

function stopCamera () {
  const stream = elements.videoElement?.srcObject
  if (stream) {
    const tracks = stream.getTracks()
    tracks.forEach(track => track.stop())
    elements.videoElement.srcObject = null
    elements.videoElement.load()
  }
}

async function loop () {
  let source
  let needsClose = false

  requestAnimationFrame(loop)

  const mode = settings.sourceMode.value

  if (mode === SOURCES.CAMERA) {
    if (elements.videoElement.readyState < 2) {
      return
    }

    const v = elements.videoElement
    const vWidth = v.videoWidth
    const vHeight = v.videoHeight
    const inputSquareSize = Math.min(vWidth, vHeight)
    const sx = (vWidth - inputSquareSize) / 2
    const sy = (vHeight - inputSquareSize) / 2
    source = await createImageBitmap(v, sx, sy, inputSquareSize, inputSquareSize, {
      resizeWidth: SIZE,
      resizeHeight: SIZE,
      resizeQuality: 'medium',
      premultiplyAlpha: 'none'
    })
    needsClose = true
  } else if (mode === SOURCES.GENERATOR) {
    clearCanvas(ctx)
    Generators[settings.currentPattern.value](ctx)
    source = generatorCanvas
  } else if (mode === SOURCES.IMAGE) {
    clearCanvas(ctx)
    source = imageCache.get(settings.currentImage.value)
    if (!source) {
      source = imageCache.black
    }
  }

  gpu.render(source)
  if (needsClose) {
    source.close()
  }
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
