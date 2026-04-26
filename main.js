import { FFTWebGPU } from './gpu.js'
import { Generators, clearCanvas } from './generators.js'
import { ImageCache } from './image-cache.js'

// This is a super-simple vanilla JS page. This file handles the settings and
// fetching the input image (either from a live camera or by running an
// external function). The business logic for performing the FFT and integration
// is handled by gpu.js and its associated shaders. The "Example Images" come
// from generators.js

const SIZE = 512 // Must be a power of RADIX (default 2)

const STORE = {
  SOURCE: 'source',
  CAMERA: 'camera',
  GENERATOR: 'generator',
  CONVERT: 'convert',
  INPUT_DISPLAY: 'input-display-mode',
  FLIP_X: 'flip-x',
  COLOUR_MAP: 'colour-map',
  INTENSITY_SCALE: 'intensity-scale'
}

const SOURCES = {
  CAMERA: 'camera',
  GENERATOR: 'generator',
  IMAGE: 'image'
}

const state = {
  sourceMode: localStorage.getItem(STORE.SOURCE) ?? SOURCES.GENERATOR,
  deviceId: localStorage.getItem(STORE.CAMERA) ?? null,
  currentPattern: localStorage.getItem(STORE.GENERATOR) ?? Object.keys(Generators)[0],
  currentImage: "",
  convertOption: localStorage.getItem(STORE.CONVERT) ?? "PeriodicPlusSmooth",
  flipX: (localStorage.getItem(STORE.FLIP_X) ?? "false") === "true",
  inputDisplay: localStorage.getItem(STORE.INPUT_DISPLAY) ?? "processed",
  colourMap: localStorage.getItem(STORE.COLOUR_MAP) ?? "None",
  intensityScale: parseFloat(localStorage.getItem(STORE.INTENSITY_SCALE)) || 0.25
}

const elements = {
  // Canvases
  input: document.getElementById('inputCanvas'),
  output: document.getElementById('gpuCanvas'),
  integ: document.getElementById('integrationCanvas'),

  // Inputs
  sourceSelect: document.getElementById('sourceSelect'),
  patternSelect: document.getElementById('patternSelect'),
  imageSelect: document.getElementById('imageSelect'),
  videoDevices: document.getElementById('videoDevices'),
  convertOption: document.getElementById('convert'),
  flipX: document.getElementById('flip-x'),
  inputDisplay: document.getElementById('input-display'),
  colourMap: document.getElementById('colourMap'),
  intensityScale: document.getElementById('scale'),

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
  elements.integ.width = SIZE * 2
  elements.integ.height = SIZE / 2

  try {
    await setupUI()
    setupDragAndDrop()
    await gpu.init(elements.input, elements.output, elements.integ, SIZE)
    gpu.setInputTextureConvertMethod(FFTWebGPU.InputConversionMode[state.convertOption])
    gpu.setFlipX(state.flipX)
    gpu.setInputTextureDisplayMode(FFTWebGPU.InputDisplayMode[state.inputDisplay])
    gpu.setColourMap(FFTWebGPU.ColourMap[state.colourMap])
    gpu.setMagnitudeScale(state.intensityScale)
  } catch (err) {
    showError(err)
    return
  } finally {
    loading.classList.add('hidden')
  }

  loop()
}

async function setupUI () {
  // Populate Patterns
  const patternOptions = Object.keys(Generators).map(name => {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    return opt
  })
  elements.patternSelect.replaceChildren(...patternOptions)
  elements.patternSelect.value = state.currentPattern
  elements.patternSelect.addEventListener('change', e => {
    state.currentPattern = e.target.value
    localStorage.setItem(STORE.GENERATOR, state.currentPattern)
  })


  // Populate Cameras (note as implemented this will only refresh on page load)
  const devices = await navigator.mediaDevices.enumerateDevices()
  const deviceOptions = devices
    .filter(({ kind }) => kind === 'videoinput')
    .map(({ deviceId, label }) => new Option(label || 'Camera', deviceId))
  elements.videoDevices.replaceChildren(...deviceOptions)
  elements.videoDevices.value = state.deviceId
  elements.videoDevices.addEventListener('change', e => {
    state.deviceId = e.target.value
    startCamera()
  })

  // Source mode selection
  async function changeSourceMode (mode) {
    state.sourceMode = mode
    const isCamera = mode === SOURCES.CAMERA
    elements.camSection.classList.toggle('hidden', !isCamera)
    elements.genSection.classList.toggle('hidden', mode !== SOURCES.GENERATOR)
    elements.imageSection.classList.toggle('hidden', mode !== SOURCES.IMAGE)
    if (isCamera) {
      await startCamera()
    } else {
      stopCamera()
    }
    localStorage.setItem(STORE.SOURCE, state.sourceMode)
  }
  elements.sourceSelect.addEventListener('change', e => changeSourceMode(e.target.value))
  elements.sourceSelect.value = state.sourceMode
  await changeSourceMode(state.sourceMode)

  // Input conversion method
  elements.inputDisplay.addEventListener('change', e => {
    state.inputDisplay = e.target.value
    gpu.setInputTextureDisplayMode(FFTWebGPU.InputDisplayMode[state.inputDisplay])
    localStorage.setItem(STORE.INPUT_DISPLAY, state.inputDisplay)
  })
  elements.inputDisplay.value = state.inputDisplay

  // Input display method
  elements.convertOption.addEventListener('change', e => {
    state.convertOption = e.target.value
    gpu.setInputTextureConvertMethod(FFTWebGPU.InputConversionMode[state.convertOption])
    localStorage.setItem(STORE.CONVERT, state.convertOption)
  })
  elements.convertOption.value = state.convertOption

  elements.flipX.addEventListener('click', e => {
    state.flipX = e.target.checked
    gpu.setFlipX(state.flipX)
    localStorage.setItem(STORE.FLIP_X, state.flipX)
  })
  elements.flipX.checked = state.flipX

  // Colour map selection
  elements.colourMap.addEventListener('change', e => {
    state.colourMap = e.target.value
    gpu.setColourMap(FFTWebGPU.ColourMap[state.colourMap])
    localStorage.setItem(STORE.COLOUR_MAP, state.colourMap)
  })
  elements.colourMap.value = state.colourMap

  // Intensity slider
  elements.intensityScale.addEventListener('change', e => {
    const percent = e.target.value
    state.intensityScale = percent / 100
    gpu.setMagnitudeScale(state.intensityScale)
    localStorage.setItem(STORE.INTENSITY_SCALE, state.intensityScale)
  })
  elements.intensityScale.value = state.intensityScale * 100

  // Fullscreen
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

  const { imageSelect, sourceSelect } = elements

  function updateImageSelect () {
    const placeholder = new Option("Drag & Drop to add images to this list", "")
    placeholder.disabled = true
    const separator = new Option("\u2500".repeat(10))
    separator.disabled = true

    const names = imageCache.names
    const imageOptions = names.map(name => new Option(name, name))

    imageSelect.replaceChildren(placeholder, separator, ...imageOptions)

    if (names.length > 0) {
      imageSelect.value = names.at(-1)
      imageSelect.dispatchEvent(new Event('change'))
    } else {
      imageSelect.selectedIndex = 0
    }
  }

  updateImageSelect()

  window.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer.files)
                  .filter(file => file.type.startsWith('image/'))

    if (files.length === 0) {
      return
    }

    await Promise.all(files.map(file => imageCache.add(file)))
    updateImageSelect()
    sourceSelect.value = "image"
    sourceSelect.dispatchEvent(new Event('change'))
  })

  imageSelect.addEventListener('change', () => {
    state.currentImage = imageSelect.value
  })
}

async function startCamera () {
  const constraints = {
    width: { ideal: SIZE },
    height: { ideal: SIZE },
    aspectRatio: { exact: 1 },
    resizeMode: 'crop-and-scale',
    ...(state.deviceId && { deviceId: { exact: state.deviceId } })
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
      state.deviceId = activeTrack.getSettings().deviceId
      localStorage.setItem(STORE.CAMERA, state.deviceId)
      return
    } catch (err) {
      const isMissing = ['NotFoundError', 'DevicesNotFoundError'].includes(err.name)
      const isOverconstrained = err.name === 'OverconstrainedError' && err.constraint === 'deviceId'

      // Only retry if the deviceId was the problem and we haven't already tried the fallback
      if (constraints.deviceId && (isMissing || isOverconstrained)) {
        console.error(`Camera ${state.deviceId} not found`)
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

  if (state.sourceMode === SOURCES.CAMERA) {
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
      resizeQuality: 'medium'
    })
    needsClose = true
  } else if (state.sourceMode === SOURCES.GENERATOR) {
    clearCanvas(ctx)
    Generators[state.currentPattern](ctx)
    source = generatorCanvas
  } else if (state.sourceMode === SOURCES.IMAGE) {
    clearCanvas(ctx)
    source = imageCache.get(state.currentImage)
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
