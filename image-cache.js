export class ImageCache {
  #storage = new Map()
  #canvas
  #ctx
  #maxMemory
  #currentMemory = 0
  #fallback = null

  constructor (width, height, maxMemoryMB = 100) {
    this.width = width
    this.height = height
    this.#maxMemory = maxMemoryMB * 1024 * 1024
    this.#canvas = new OffscreenCanvas(width, height)
    this.#ctx = this.#canvas.getContext('2d')
  }

  async add (file) {
    const original = await createImageBitmap(file)

    this.#draw(original)

    const bitmap = this.#canvas.transferToImageBitmap()
    const size = this.width * this.height * 4
    original.close()

    this.#enforceMemoryLimit(size)

    this.#storage.set(file.name, { bitmap, size })
    this.#currentMemory += size
  }

  #draw (bitmap) {
    const canvasW = this.width
    const canvasH = this.height

    const imgRatio = bitmap.width / bitmap.height
    const canvasRatio = canvasW / canvasH

    let sx, sy, sw, sh

    if (imgRatio > canvasRatio) {
        sw = bitmap.height * canvasRatio
        sh = bitmap.height
        sx = (bitmap.width - sw) / 2
        sy = 0
    } else {
        sw = bitmap.width
        sh = bitmap.width / canvasRatio
        sx = 0
        sy = (bitmap.height - sh) / 2
    }

    this.#ctx.clearRect(0, 0, canvasW, canvasH)
    this.#ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvasW, canvasH)
  }

  get (name) {
    const item = this.#storage.get(name)
    if (!item) {
      return null
    }
    // Move to the front of the queue, so that if we need to delete images
    // to free up memory, images that were accessed less recently will be
    // deleted first
    this.#storage.delete(name)
    this.#storage.set(name, item)

    return item.bitmap
  }

  get black () {
    if (!this.#fallback) {
      this.#ctx.clearRect(0, 0, this.width, this.height)
      this.#fallback = this.#canvas.transferToImageBitmap()
    }
    return this.#fallback
  }

  delete (name) {
    const item = this.#storage.get(name)
    if (item) {
      item.bitmap.close()
      this.#currentMemory -= item.size
      this.#storage.delete(name)
    }
  }

  #enforceMemoryLimit (extraSize) {
    while (this.#currentMemory + extraSize > this.#maxMemory && this.#storage.size > 0) {
      const oldestKey = this.#storage.keys().next().value
      this.delete(oldestKey)
    }
  }

  get names () {
    return Array.from(this.#storage.keys())
  }

  get size () {
    return this.#storage.size
  }
}
