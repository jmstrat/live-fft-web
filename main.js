import { FFTWebGPU } from './gpu.js'
import { Generators, clearCanvas } from './generators.js'

// This is a super-simple vanilla JS page. This file handles the settings and
// fetching the input image (either from a live camera or by running an
// external function). The business logic for performing the FFT and integration
// is handled by gpu.js and its associated shaders. The "Example Images" come
// from generators.js

const SIZE = 1024 // Must be a power of RADIX (default 4)

const state = {
  sourceMode: 'generator',
  deviceId: null,
  currentPattern: Object.keys(Generators)[0],
  videoElement: document.createElement('video')
}

const elements = {
  input: document.getElementById('inputCanvas'),
  output: document.getElementById('gpuCanvas'),
  integ: document.getElementById('integrationCanvas'),
  sourceSelect: document.getElementById('sourceSelect'),
  patternSelect: document.getElementById('patternSelect'),
  videoDevices: document.getElementById('videoDevices'),
  camSection: document.getElementById('cameraSection'),
  genSection: document.getElementById('generatorSection')
}

const gpu = new FFTWebGPU()
const ctx = elements.input.getContext('2d', { willReadFrequently: true })

async function init() {
  elements.input.width = elements.input.height = SIZE
  elements.output.width = elements.output.height = SIZE
  elements.integ.width = SIZE
  elements.integ.height = SIZE / 2

  try {
    await setupUI()
    await gpu.init(elements.output, elements.integ, SIZE)
  } catch (err) {
    showError(err)
    return
  }

  loop()
}

async function setupUI () {
  // Populate Patterns
  elements.patternSelect.innerHTML = Object.keys(Generators)
    .map(k => `<option value="${k}">${k}</option>`).join('')

  // Device Enumeration
  const devices = await navigator.mediaDevices.enumerateDevices()
  const cameras = devices.filter(d => d.kind === 'videoinput')
  elements.videoDevices.innerHTML = cameras
    .map(c => `<option value="${c.deviceId}">${c.label || 'Camera'}</option>`).join('')

  // Event Handlers
  elements.sourceSelect.onchange = (e) => {
    state.sourceMode = e.target.value
    const is_camera = state.sourceMode === 'camera'
    elements.camSection.style.display = is_camera ? 'block' : 'none'
    elements.genSection.style.display = is_camera ? 'none' : 'block'
    elements.input.style.display = is_camera ? 'none' : 'block'
    if (is_camera) {
      startCamera()
    } else {
      stopCamera()
    }
  }
  elements.sourceSelect.value = state.sourceMode
  elements.patternSelect.onchange = (e) => state.currentPattern = e.target.value
  elements.videoDevices.onchange = (e) => {
    state.deviceId = e.target.value
    startCamera()
  }
}

async function startCamera () {
  const constraints = {
    video: {
      width: { ideal: SIZE },
      height: { ideal: SIZE },
      aspectRatio: { ideal: 1 },
      ...(state.deviceId && { deviceId: { exact: state.deviceId } })
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    state.videoElement.srcObject = stream
    state.videoElement.classList.add('input')
    elements.input.parentElement.appendChild(state.videoElement)
    state.videoElement.play()
  } catch (err) {
    showError(err)
  }
}

async function stopCamera () {
  const stream = state.videoElement?.srcObject
  if (stream) {
    const tracks = stream.getTracks()
    tracks.forEach(track => track.stop())
    state.videoElement.srcObject = null
    state.videoElement.load()
    state.videoElement.remove()
  }
}

async function loop() {
  let source
  if (state.sourceMode === 'camera') {
    if (state.videoElement.readyState < 2) {
      return requestAnimationFrame(loop)
    }

    const v = state.videoElement
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
  } else {
    clearCanvas(ctx)
    Generators[state.currentPattern](ctx)
    source = elements.input
  }

  gpu.render(source)
  source?.close?.()
  requestAnimationFrame(loop)
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
  const overlay = document.getElementById('errorOverlay')
  const titleEl = document.getElementById('errorTitle')
  const msgEl = document.getElementById('errorMessage')
  const codeEl = document.getElementById('errorCode')

  titleEl.textContent = title
  msgEl.textContent = message

  if (code) {
    codeEl.textContent = code
    codeEl.classList.remove('hidden')
  } else {
    codeEl.classList.add('hidden')
  }

  overlay.classList.remove('hidden')
}

init()
