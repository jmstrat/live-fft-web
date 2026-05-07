export class Camera extends EventTarget {
  static events = {
    error: 'error'
  }

  static errorCodes = {
    PermissionDenied: 'CAMERA_DENIED',
    PermissionRevoked: 'CAMERA_REVOKED',
    Disconnected: 'CAMERA_DISCONNECTED',
    Stopped: 'CAMERA_STOPPED',
    Generic: 'CAMERA_ERROR'
  }

  #size
  #stream = null
  #activeDeviceId = null
  #video
  #callbackHandle = null

  constructor (idealSize=512) {
    super()
    this.#size = idealSize

    this.#video = document.createElement('video')
    this.#video.autoplay = true
    this.#video.muted = true
    this.#video.playsInline = true
  }

  async getDevices () {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
    .filter(({ kind }) => kind === 'videoinput')
  }

  async #deviceExists (deviceID) {
    const devices = await this.getDevices()
    return devices.some(d => d.deviceId === deviceID)
  }

  async start (deviceId = null) {
    if (deviceId && deviceId === this.#activeDeviceId) {
      return this.#activeDeviceId
    }

    const constraints = {
      video: {
        width: { ideal: this.#size },
        height: { ideal: this.#size },
        aspectRatio: { exact: 1 },
        resizeMode: 'crop-and-scale',
        ...(deviceId && { deviceId: { exact: deviceId } })
      }
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia(constraints)
      await this.#setStream(newStream)
      return this.#activeDeviceId
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        const wrapped = new Error('Camera permission denied', { cause: err })
        wrapped.code = Camera.errorCodes.PermissionDenied
        throw wrapped
      }

      if (deviceId) {
        const maybeErr = await this.#getCameraError(deviceId)
        if (maybeErr) {
          throw maybeErr
        }
      }

      if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(err.name)) {
        const wrapped = new Error('Camera unsupported', { cause: err })
        wrapped.code = Camera.errorCodes.Generic
        throw wrapped
      }

      throw err
    }
  }

  stop () {
    if (this.#stream) {
      this.#stream.getTracks().forEach(track => {
        track.removeEventListener('ended', this.#handleTrackEnded)
        track.stop()
      })
      this.#video.srcObject = null
      this.#stream = null
      this.#video.load()
    }
    this.#activeDeviceId = null
  }

  async getImageBitmap () {
    if (!this.isReady) {
      return null
    }

    const v = this.#video
    const size = Math.min(v.videoWidth, v.videoHeight)
    const sx = (v.videoWidth - size) / 2
    const sy = (v.videoHeight - size) / 2

    return await createImageBitmap(v, sx, sy, size, size, {
      resizeWidth: this.#size,
      resizeHeight: this.#size,
      resizeQuality: 'medium',
      premultiplyAlpha: 'none'
    })
  }

  getExternalTexture (device) {
    if (!this.isReady) {
      return null
    }

    return device.importExternalTexture({
      source: this.#video
    })
  }

  requestFrame (callback) {
    if ('requestVideoFrameCallback' in this.#video) {
      this.#callbackHandle = this.#video.requestVideoFrameCallback((now, metadata) => {
        callback(now, metadata)
      })
    } else {
      this.#callbackHandle = requestAnimationFrame(callback)
    }
  }

  cancelFrame () {
    if (this.#callbackHandle) {
      if ('cancelVideoFrameCallback' in this.#video) {
        this.#video.cancelVideoFrameCallback(this.#callbackHandle)
      } else {
        cancelAnimationFrame(this.#callbackHandle)
      }
      this.#callbackHandle = null
    }
  }

  async #setStream (stream) {
    this.stop()
    this.#stream = stream
    this.#video.srcObject = stream

    const track = stream.getVideoTracks()[0]
    track.addEventListener('ended', this.#handleTrackEnded)

    this.#activeDeviceId = track.getSettings().deviceId
    await this.#video.play()
  }

  async #getCameraError (deviceID) {
    this.stop()
    let deviceExists

    try {
      const { state } = await navigator.permissions.query({ name: 'camera' })
      if (state === 'denied') {
        const err = new Error('Camera permission was revoked')
        err.code = Camera.errorCodes.PermissionRevoked
        return err
      } else {
        deviceExists = await this.#deviceExists(deviceID)
      }
    } catch (e) {
      console.error(e)
      deviceExists = await this.#deviceExists(deviceID)
    }

    if (!deviceExists) {
      const err = new Error('Camera hardware was disconnected')
      err.code = Camera.errorCodes.Disconnected
      return err
    }
  }

  #handleTrackEnded = async () => {
    let err = await this.#getCameraError(this.#activeDeviceId)

    if (!err) {
      err = new Error('Camera stopped unexpectedly')
      err.code = Camera.errorCodes.Stopped
    }

    this.dispatchEvent(new CustomEvent(Camera.events.error, { detail: err }))
  }

  get isReady () {
    return this.#video.readyState >= 2
  }
}
