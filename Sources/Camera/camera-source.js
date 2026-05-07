import { Source } from '../source.js'
import { Camera } from './adapter.js'

export class CameraSource extends Source {
  #camera

  #cameraSettingsEl = document.getElementById('camera-section')

  init (size) {
    this.#camera = new Camera(size)

    this.settings.subscribe('deviceId', () => this.restart())

    this.settings.addSetting(
      'deviceId',
      {
        el: document.getElementById('camera-select'),
        storageKey: 'camera',
        default: null
      }
    )

    this.#camera.addEventListener(Camera.events.error, (event) => {
      const err = event.detail
      this.emitError(err)
    })
  }

  async activate () {
    this.#cameraSettingsEl.classList.remove('hidden')
    const deviceID = await this.#camera.start(this.settings.get('deviceId'))
    this.settings.set('deviceId', deviceID)
    await this.#refreshCameraOptions()
  }

  deactivate () {
    this.#cameraSettingsEl.classList.add('hidden')
    this.#camera.stop()
  }

  getFrame (device) {
    return this.#camera.getExternalTexture(device)
  }

  requestFrame (cb) {
    return this.#camera.requestFrame(cb)
  }

  cancelFrame (handle) {
    this.#camera.cancelFrame(handle)
  }

  async #refreshCameraOptions () {
    const devices = await this.#camera.getDevices()
    const deviceOptions = devices
      .map(({ deviceId, label }) => new Option(label || 'Camera', deviceId))

    this.settings.setOptions('deviceId', deviceOptions)
  }
}
