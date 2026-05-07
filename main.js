import { SettingsManager } from './settings.js'
import { Renderer } from './Render/render.js'

import { SourceManager } from './Sources/manager.js'
import { CameraSource } from './Sources/Camera/camera-source.js'
import { GeneratorSource } from './Sources/Canvas/canvas-source.js'
import { ImageSource } from './Sources/Image/image-source.js'

import { showError, hideError } from './errors.js'

const SIZE = 512 // Must be a power of RADIX (default 2)

const settings = new SettingsManager()
const sources = new SourceManager()
const renderer = new Renderer(settings)

const SOURCES = {
  CAMERA: 'camera',
  GENERATOR: 'generator',
  IMAGE: 'image'
}

const SETTINGS = {
  SOURCE: 'sourceMode',
  LIGHT_DARK: 'lightDark'
}

const SETTING_DESCRIPTORS = {
  [SETTINGS.SOURCE]: {
    el: document.getElementById('source-select'),
    storageKey: 'source',
    default: SOURCES.GENERATOR
  },
  [SETTINGS.LIGHT_DARK]: {
    el: document.getElementById('theme-switcher'),
    storageKey: 'theme',
    default: 'auto',
    parse (_, el) {
      return el.resolvedValue
    }
  }
}

const canvases = {
  input: document.getElementById('input-canvas'),
  magnitude: document.getElementById('fft-magnitude'),
  phase: document.getElementById('fft-phase'),
  integration: document.getElementById('integration-canvas')
}

const elements = {
  dashboard: document.getElementById('dashboard'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  loading: document.getElementById('loading-overlay')
}

async function render () {
  const frame = sources.getFrame(renderer.gpu.device)
  if (frame) {
    renderer.render(frame)
  }
}

async function init () {
  canvases.input.width = canvases.input.height = SIZE
  canvases.magnitude.width = canvases.magnitude.height = SIZE
  canvases.phase.width = canvases.phase.height = SIZE
  canvases.integration.width = SIZE * 2
  canvases.integration.height = SIZE / 2

  try {
    await initialiseRenderer()
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

async function initialiseRenderer () {
  renderer.addEventListener(Renderer.events.dirty, () => sources.requestNewFrame())
  renderer.addEventListener(Renderer.events.canvasActive, (e) => {
    const { canvas, active } = e.detail
    const el = canvases[canvas]
    if (el) {
      el.classList.toggle('hidden', !active)
      // Note that currently we only ever toggle the phase canvas
      // If we want to toggle other canvases we need to make the
      // dashboard more flexible
      elements.dashboard.classList.toggle('col-3', active)
    }
  })

  await renderer.init(canvases, SIZE)
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
  settings.subscribe(SETTINGS.SOURCE, async (mode) => {
    await sources.setActive(mode)
  })

  settings.subscribe(SETTINGS.LIGHT_DARK, (value) => {
    document.body.classList.toggle('light-mode', value === 'light')

    const styles = getComputedStyle(document.body)
    const bgColour = styles.getPropertyValue('--bg-colour').trim()
    let activeMeta = document.querySelector("meta[name='theme-color']:not([media])")
    if (!activeMeta) {
      activeMeta = document.createElement('meta')
      activeMeta.name = "theme-color"
      document.head.appendChild(activeMeta)
    }
    activeMeta.setAttribute("content", bgColour)
  })

  for (const [key, config] of Object.entries(SETTING_DESCRIPTORS)) {
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
