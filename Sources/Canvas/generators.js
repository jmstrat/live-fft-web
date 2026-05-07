// This file provides the procedurally generated "Example Images"

const oscillators = {
  linear: () => Math.abs(((Date.now() * 0.0005 / Math.PI) % 2) - 1),
  sin: () => Math.sin(Date.now() * 0.0005),
  normSin: () => Math.sin(Date.now() * 0.0005) * 0.5 + 0.5,
  normSaw: () => (Date.now() * 0.0005 / Math.PI) % 1
}

const DEFAULT_PALETTE = {
  fg: 'white',
  bg: 'black'
}

class Generator {
  #canvas
  #ctx
  #dirty = true
  #config
  #palette

  constructor (config = {}, palette = DEFAULT_PALETTE) {
    this.#config = config
    this.#palette = palette
  }

  init (canvas, ctx) {
    this.#canvas = canvas
    this.#ctx = ctx
  }

  draw () {
    this.clear()
    this.#dirty = false
    this.render()
  }

  render () {
    // Override in subclasses
  }

  get config () { return this.#config }
  get palette () { return this.#palette }
  get canvas () { return this.#canvas }
  get ctx () { return this.#ctx }
  get width () { return this.#canvas.width }
  get height () { return this.#canvas.height }

  isDirty () {
    return this.#dirty
  }

  markDirty () {
    this.#dirty = true
  }

  setPalette (palette) {
    this.#palette = palette
    this.markDirty()
  }

  resolveColour (col) {
    const tempCtx = new OffscreenCanvas(1, 1).getContext('2d')
    tempCtx.fillStyle = col
    tempCtx.fillRect(0, 0, 1, 1)
    return tempCtx.getImageData(0, 0, 1, 1).data
  }

  clear () {
    this.ctx.fillStyle = this.palette.bg
    this.ctx.fillRect(0, 0, this.width, this.height)
  }

  resetTransform () {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  getDelta () {
    const key = this.config.oscillator
    return key ? oscillators[key]() : 0
  }
}

class Circle extends Generator {
  render () {
    const { sizeFactor, pulseAmplitude } = this.config
    const r = this.width * sizeFactor
    const radius = r + this.getDelta() * (r * pulseAmplitude)

    this.ctx.fillStyle = this.palette.fg
    this.ctx.translate(this.width / 2, this.height / 2)
    this.ctx.beginPath()
    this.ctx.arc(0, 0, radius, 0, Math.PI * 2)
    this.ctx.fill()
    this.resetTransform()
    this.markDirty()
  }
}

class Rectangle extends Generator {
  render () {
    const { sizeFactors } = this.config
    this.ctx.fillStyle = this.palette.fg
    this.ctx.translate(this.width / 2, this.height / 2)
    this.ctx.rotate(this.getDelta() * Math.PI / 2)

    this.ctx.beginPath()
    this.ctx.rect(
      -this.width * sizeFactors[0] / 2,
      -this.height * sizeFactors[1] / 2,
      this.width * sizeFactors[0],
      this.height * sizeFactors[1]
    )
    this.ctx.fill()
    this.resetTransform()
    this.markDirty()
  }
}

class Hexagon extends Generator {
  render () {
    const { sizeFactor } = this.config
    const size = this.width * sizeFactor / 2
    this.ctx.fillStyle = this.palette.fg
    this.ctx.translate(this.width / 2, this.height / 2)
    this.ctx.rotate(this.getDelta() * Math.PI / 2)

    this.ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i
      this.ctx.lineTo(size * Math.cos(angle), size * Math.sin(angle))
    }
    this.ctx.closePath()
    this.ctx.fill()
    this.resetTransform()
    this.markDirty()
  }
}

class Liquid extends Generator {
  #particles = null

  init (...args) {
    super.init(...args)
    const {
      count,
      polydispersity = 0,
      eccentricity = { min: 1, max: 1 },
      angleVariance = 0,
      emptyFactor = 1.75
    } = this.config

    const radius = Math.sqrt((this.width * this.height) / (count * emptyFactor * Math.PI))
    this.jitter = 0.003 * this.width
    this.repulsion = 0.2

    this.#particles = Array.from({ length: count }, () => {
      const r = radius + radius * (Math.random() - 0.5) * polydispersity
      const factor = eccentricity.min + Math.random() * (eccentricity.max - eccentricity.min)
      return {
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        rx: r * factor,
        ry: r / factor,
        r: r,
        angle: 2 * Math.PI * (Math.random() - 0.5) * angleVariance
      }
    })
  }

  render () {
    this.ctx.fillStyle = this.palette.fg
    const particles = this.#particles

    for (let i = 0; i < particles.length; i++) {
      let p1 = particles[i]
      p1.x += (Math.random() - 0.5) * this.jitter
      p1.y += (Math.random() - 0.5) * this.jitter

      for (let j = i + 1; j < particles.length; j++) {
        let p2 = particles[j]
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const minDist = p1.r + p2.r

        if (dist < minDist) {
          const overlap = minDist - dist
          const nx = dx / (dist || 1)
          const ny = dy / (dist || 1)
          const moveX = nx * overlap * this.repulsion
          const moveY = ny * overlap * this.repulsion
          p1.x -= moveX
          p1.y -= moveY
          p2.x += moveX
          p2.y += moveY
        }
      }

      const maxR = Math.max(p1.rx, p1.ry)
      p1.x = Math.max(maxR, Math.min(this.width - maxR, p1.x))
      p1.y = Math.max(maxR, Math.min(this.height - maxR, p1.y))

      this.ctx.beginPath()
      this.ctx.ellipse(p1.x, p1.y, p1.rx, p1.ry, p1.angle, 0, Math.PI * 2)
      this.ctx.fill()
    }
    this.markDirty()
  }
}

class Circles extends Generator {
  stamp

  get radius () {
    return this.width * this.config.radiusFactor
  }

  // Firefox seems to have asymmetric anti-aliasing
  // This interferes with periodic + smooth decomposition to generate unexpected
  // artefacts, to avoid this we manually draw a symmetric antialiased circle
  // and place that circle at each lattice point rather than simply drawing an arc
  createSymmetricCircle () {
    const size = Math.ceil(this.radius * 2)
    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext('2d')
    const imgData = ctx.createImageData(size, size)
    const data = imgData.data

    const centre = (size - 1) / 2

    const [r, g, b] = this.resolveColour(this.palette.fg)

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dist = Math.sqrt((x - centre) ** 2 + (y - centre) ** 2)

        // Manual Anti-Aliasing (1-pixel ramp)
        const alpha = Math.max(0, Math.min(1, this.radius + 0.5 - dist))
        const i = (y * size + x) * 4
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
        data[i + 3] = Math.round(alpha * 255)
      }
    }
    ctx.putImageData(imgData, 0, 0)
    return canvas
  }

  init (...args) {
    super.init(...args)
    this.stamp = this.createSymmetricCircle()
  }

  setPalette (...args) {
    super.setPalette(...args)
    this.stamp = this.createSymmetricCircle()
  }

  render () {
    const y = Math.round(this.height / 2  - this.radius)
    const x = this.width / 2 - this.radius

    const minGap = this.config.minGapFactor * this.width + this.radius * 2
    const maxGap = this.config.maxGapFactor * this.width + this.radius * 2
    const gap = minGap + (maxGap - minGap) * this.getDelta()

    const stamp = this.stamp

    const n = this.config.n

    const totalWidth = (n - 1) * gap
    const startX = x - totalWidth / 2

    for (let i = 0; i < n; i++) {
      const posX = startX + (i * gap)
      this.ctx.drawImage(stamp, Math.round(posX), y)
    }

    this.markDirty()
  }
}

class MovingCircle extends Circles {
  render () {
    let y = this.height / 2 - this.radius
    let x = this.width / 2 - this.radius
    const stamp = this.stamp

    const t = this.getDelta()

    const orbitRadius = this.config.orbitFactor * this.width
    const angle = t * Math.PI * 2

    x += Math.cos(angle) * orbitRadius
    y += Math.sin(angle) * orbitRadius


    this.ctx.drawImage(stamp, Math.round(x), Math.round(y))

    this.markDirty()
  }
}

class Lattice extends Circles {
  #stamp

  get spacing () {
    return this.width * this.config.spacingFactor
  }

  get vSpacing () {
    // In principle this should be multiplied by (Math.sqrt(3) / 2)
    // if type === 'hex'
    // but we don't do this to avoid drawing at fractional pixel coords
    return this.spacing
  }

  #createSymmetricStamp () {
    const spacing = this.spacing
    const vSpacing = this.vSpacing

    const isHex = this.config.type === 'hex'

    // Create a canvas that represents one repeating unit of the lattice
    const tileWidth = spacing
    const tileHeight = isHex ? vSpacing * 2 : vSpacing
    const canvas = new OffscreenCanvas(tileWidth, tileHeight)
    const ctx = canvas.getContext('2d')

    const stamp = this.createSymmetricCircle()

    if (isHex) {
      ctx.drawImage(stamp, 0, 0)
      ctx.drawImage(stamp, (spacing / 2), vSpacing)
    } else {
      ctx.drawImage(stamp, 0, 0)
    }

    return this.ctx.createPattern(canvas, 'repeat')
  }

  init (...args) {
    super.init(...args)
    this.#stamp = this.#createSymmetricStamp()
  }

  setPalette (...args) {
    super.setPalette(...args)
    this.#stamp = this.#createSymmetricStamp()
  }

  render () {
    const { margin } = this.config

    const r = this.radius
    const cols = Math.floor(this.width / this.spacing + 1 - margin * 2)
    const rows = Math.floor(this.height / this.vSpacing + 1 - margin * 2)

    const gridW = Math.ceil((cols - 1) * this.spacing)
    const gridH = Math.ceil((rows - 1) * this.vSpacing)

    const xMargin = (this.width - gridW) / 2
    const yMargin = (this.height - gridH) / 2

    const w = gridW + r * 2
    const h = gridH + r * 2

    const stamp = this.#stamp

    this.ctx.save()
    this.ctx.translate(xMargin - r, yMargin - r)
    this.ctx.fillStyle = stamp
    this.ctx.fillRect(0, 0, w, h)
    this.ctx.restore()
  }
}

export const Generators = {
  Circle: new Circle({
    sizeFactor: 0.05,
    pulseAmplitude: 0.9,
    oscillator: 'sin'
  }),
  Rectangle: new Rectangle({
    sizeFactors: [0.05, 0.25],
    oscillator: 'sin'
  }),
  Hexagon: new Hexagon({
    sizeFactor: 0.25,
    oscillator: 'sin'
  }),
  'Monodisperse Circles': new Liquid({ count: 400 }),
  'Polydisperse Circles': new Liquid({ count: 400, polydispersity: 0.5 }),
  'Polydisperse Ellipses': new Liquid({
    count: 200,
    polydispersity: 0.5,
    eccentricity: { min: 1.5, max: 3.5 },
    angleVariance: 0.02,
    emptyFactor: 5
  }),
  Orbit: new MovingCircle({
    radiusFactor: 1 / 32,
    orbitFactor: 1 / 32,
    oscillator: 'normSaw'
  }),
  'Two Circles': new Circles({
    n: 2,
    radiusFactor: 1 / 128,
    minGapFactor: 0,
    maxGapFactor: 1 / 8,
    oscillator: 'linear'
  }),
  'Lattice': new Lattice({
    spacingFactor: 1 / 16,
    radiusFactor: 1 / 128,
    margin: 1,
    type: 'hex'
  }),
  'Big Square Lattice': new Lattice({
    spacingFactor: 1 / 32,
    radiusFactor: 1 / 256,
    margin: 0,
    type: 'square'
  }),
  'Big Hex Lattice': new Lattice({
    spacingFactor: 1 / 32,
    radiusFactor: 1 / 256,
    margin: 0,
    type: 'hex'
  })
}
