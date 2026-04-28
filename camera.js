export class Camera {
  #size
  #stream = null
  #activeDeviceId = null
  #video
  #callbackHandle = null

  constructor (idealSize=512) {
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

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia(constraints)
        await this.#setStream(newStream)
        return this.#activeDeviceId
      } catch (err) {
        const isDeviceError = ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(err.name)

        if (constraints.video.deviceId && isDeviceError && attempt === 0) {
          console.error(`Camera ${constraints.video.deviceId.exact} not found`)
          delete constraints.video.deviceId
          continue
        }

        throw err
      }
    }
  }

  stop () {
    if (this.#stream) {
      this.#stream.getTracks().forEach(track => {
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
    this.#activeDeviceId = track.getSettings().deviceId
    await this.#video.play()
  }

  get isReady () {
    return this.#video.readyState >= 2
  }
}
