// This file provides the procedurally generated "Example Images"
// Each image is simply a function that takes a canvas 2D context and
// draws to it once per frame. They can be animated or static.

const FG = 'white'
const BG = 'black'

const TIME_SCALE = 0.0005
const PULSE_AMPLITUDE = 0.9

const CIRCLE_SIZE_F = 0.05

const RECTANGLE_SIZE_F = [0.05, 0.25]
const HEX_SIZE_F = 0.25
const LATTICE_SIZE_F = 1/16
const LATTICE_R_F = 1/8

let STATE = null

// Some of these are static, in principle we could pause the GPU pipeline
// when a static image is selected

export const Generators = {
  Circle: (ctx) => {
    const time = Date.now() * TIME_SCALE

    ctx.fillStyle = FG
    ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2)

    const r = ctx.canvas.width * CIRCLE_SIZE_F

    const radius = r + Math.sin(time) * (r * PULSE_AMPLITUDE)

    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.fill()

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  },
  Rectangle: (ctx) => {
    const time = Date.now() * TIME_SCALE

    ctx.fillStyle = FG
    ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2)
    ctx.rotate(Math.sin(time) * Math.PI / 2)

    ctx.beginPath()
    ctx.rect(
      -ctx.canvas.width * RECTANGLE_SIZE_F[0] / 2,
      -ctx.canvas.height * RECTANGLE_SIZE_F[1] / 2,
      ctx.canvas.width * RECTANGLE_SIZE_F[0],
      ctx.canvas.height * RECTANGLE_SIZE_F[1]
    )
    ctx.fill()

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  },
  Hexagon: (ctx) => {
    const time = Date.now() * TIME_SCALE
    const size = ctx.canvas.width * HEX_SIZE_F / 2

    ctx.fillStyle = FG
    ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2)
    ctx.rotate(Math.sin(time) * Math.PI / 2)

    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i
      const x = size * Math.cos(angle)
      const y = size * Math.sin(angle)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  },
  'Monodisperse Circles': (ctx) => {
    if (!(STATE instanceof Liquid && STATE.id === 'monodisperse')) {
      STATE = new Liquid({
        count: 400,
        width: ctx.canvas.width,
        height: ctx.canvas.height
      })
      STATE.id = 'monodisperse'
    }
    STATE.draw(ctx)
  },
  'Polydisperse Circles': (ctx) => {
    if (!(STATE instanceof Liquid && STATE.id === 'polydisperse')) {
      STATE = new Liquid({
        count: 400,
        width: ctx.canvas.width,
        height: ctx.canvas.height,
        polydispersity: 0.5
      })
      STATE.id = 'polydisperse'
    }
    STATE.draw(ctx)
  },
  'Polydisperse Ellipses': (ctx) => {
    if (!(STATE instanceof Liquid && STATE.id === 'ellipse')) {
      STATE = new Liquid({
        count: 200,
        width: ctx.canvas.width,
        height: ctx.canvas.height,
        polydispersity: 0.5,
        eccentricity: { min: 1.5, max: 3.5 },
        angleVariance: 0.02,
        emptyFactor: 5
      })
      STATE.id = 'ellipse'
    }
    STATE.draw(ctx)
  },

  'Lattice': (ctx) => {
    const spacing = ctx.canvas.width * LATTICE_SIZE_F
    const radius = spacing * LATTICE_R_F
    const vSpacing = spacing * (Math.sqrt(3) / 2)

    ctx.fillStyle = FG

    const xmax = ctx.canvas.width - spacing
    const ymax = ctx.canvas.height - vSpacing

    for (let y = spacing, row = 0; y <= ymax; y += vSpacing, row++) {
      const offset = (row % 2) * (spacing / 2)

      for (let x = spacing - offset; x <= xmax; x += spacing) {
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  },
  'Big Lattice': (ctx) => {
    const spacing = ctx.canvas.width * LATTICE_SIZE_F / 8
    const radius = spacing * LATTICE_R_F
    const vSpacing = spacing * (Math.sqrt(3) / 2)

    ctx.fillStyle = FG

    const xmax = ctx.canvas.width - spacing
    const ymax = ctx.canvas.height - vSpacing

    for (let y = spacing, row = 0; y <= ymax; y += vSpacing, row++) {
      const offset = (row % 2) * (spacing / 2)

      for (let x = spacing - offset; x <= xmax; x += spacing) {
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

export function clearCanvas (ctx) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
}

class Liquid {
  constructor ({
    count,
    width,
    height,
    polydispersity = 0,
    eccentricity = { min: 1, max: 1},
    angleVariance = 0,
    emptyFactor = 1.75
  }) {
    this.count = count
    this.width = width
    this.height = height
    this.radius = Math.sqrt((width * height) / (count * emptyFactor * Math.PI))
    this.repulsion = 0.2
    this.jitter = 0.003 * width

    this.polydispersity = polydispersity
    this.eccentricity = eccentricity
    this.angleVariance = angleVariance
    this.particles = this.init()
  }

  init () {
    return Array.from({ length: this.count },
      () => this.makeParticle()
    )
  }

  makeParticle () {
    const r = this.radius + this.radius * (Math.random() - 0.5) * this.polydispersity

    const factor = this.eccentricity.min + Math.random() * (this.eccentricity.max - this.eccentricity.min)

    return {
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      rx: r * factor,
      ry: r / factor,
      r: r, // Collision radius
      angle: 2 * Math.PI * (Math.random() - 0.5) * this.angleVariance
    }
  }

  draw (ctx) {
    const { width, height } = ctx.canvas
    ctx.fillStyle = FG

    for (let i = 0; i < this.particles.length; i++) {
      let p1 = this.particles[i]

      p1.x += (Math.random() - 0.5) * this.jitter
      p1.y += (Math.random() - 0.5) * this.jitter

      for (let j = i + 1; j < this.particles.length; j++) {
        let p2 = this.particles[j]
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
      p1.x = Math.max(maxR, Math.min(width - maxR, p1.x))
      p1.y = Math.max(maxR, Math.min(height - maxR, p1.y))

      this.drawParticle(ctx, p1)
    }
  }

  drawParticle (ctx, p) {
    ctx.beginPath()
    ctx.ellipse(p.x, p.y, p.rx, p.ry, p.angle, 0, Math.PI * 2)
    ctx.fill()
  }
}
