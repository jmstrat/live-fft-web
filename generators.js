// This file provides the procedurally generated "Example Images"

const oscillators = {
  sin: () => Math.sin(Date.now() * 0.0005)
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

class Lattice extends Generator {
  render () {
    const { spacingFactor, radiusFactor, type = 'hex', margin } = this.config
    const spacing = this.width * spacingFactor
    const radius = this.width * radiusFactor
    const isHex = type === 'hex'
    const vSpacing = isHex ? spacing * (Math.sqrt(3) / 2) : spacing

    const xmin = spacing * margin
    const xmax = this.width - spacing * margin

    const ymin = spacing * margin
    const ymax = this.height - vSpacing * margin

    this.ctx.fillStyle = this.palette.fg
    for (let y = ymin, row = 0; y <= ymax; y += vSpacing, row++) {
      const offset = (row % 2) * (spacing / 2)

      for (let x = xmin + offset; x <= xmax; x += spacing) {
        this.ctx.beginPath()
        this.ctx.arc(x, y, radius, 0, Math.PI * 2)
        this.ctx.fill()
      }
    }
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
  'Lattice': new Lattice({
    spacingFactor: 1 / 16,
    radiusFactor: 1 / 128,
    margin: 1,
    type: 'hex'
  }),
  'Big Lattice': new Lattice({
    spacingFactor: 1 / 32,
    radiusFactor: 1 / 256,
    margin: 0,
    type: 'square'
  })
}

export function init (width, height) {
  const sharedCanvas = new OffscreenCanvas(width, height)
  const ctx = sharedCanvas.getContext('2d', { willReadFrequently: true })
  Object.values(Generators).forEach(g => g.init(sharedCanvas, ctx))
}
