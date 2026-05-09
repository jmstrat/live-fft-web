// RADIX determines how many pixels each shader invocation processes
// It must be a power of 2 and must match the constant defined in
// fft-stockham.wgsl
// In general, increasing RADIX improves performance, however, note
// that the image size must be a power of RADIX
// e.g. for a radix of 4: 4 ^ 4 = 256 | 4 ^ 5 = 1024

const RADIX = 2

const BIND_GROUP = Symbol()
class BindGroupCache {
  constructor (device) {
    this.device = device
    this.cache = new WeakMap()
  }

  get (pipeline, layoutIndex, ...resources) {
    let currentLevel = this.cache

    if (!currentLevel.has(pipeline)) {
      currentLevel.set(pipeline, new WeakMap())
    }
    currentLevel = currentLevel.get(pipeline)

    for (const res of resources) {
      // Passing null for a resource can increment the binding counter
      // The resource MUST always be null, this is not verified
      if (!res) {
        continue
      }

      if (!currentLevel.has(res)) {
        currentLevel.set(res, new WeakMap())
      }
      currentLevel = currentLevel.get(res)
    }

    let bindGroup = currentLevel.get(BIND_GROUP)

    if (!bindGroup) {
      bindGroup = this.make(pipeline, layoutIndex, ...resources)
      currentLevel.set(BIND_GROUP, bindGroup)
    }

    return bindGroup
  }

  make (pipeline, layoutIndex, ...resources) {
    const entries = []
    let i = 0
    for (const res of resources) {
      if (res) {
        entries.push({
          binding: i,
          resource: res
        })
      }
      i++
    }

    return this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(layoutIndex),
      entries
    })
  }
}

class Shader {
  static getRequiredLimits (size) {
    return {}
  }

  static getRequiredFeatures (size) {
    return []
  }

  static getOptionalFeatures (size) {
    return []
  }

  static filename = ""

  constructor (manager, size, config) {
    this.manager = manager
    this.size = size
    this.config = config
    this.bindGroupCache = new BindGroupCache(manager.device)
  }

  get device () {
    return this.manager.device
  }

  get format () {
    return this.manager.format
  }

  async fetchShaderModule () {
    const response = await fetch(`Render/Shaders/${this.constructor.filename}`)
    const code = await response.text()
    return this.compileShader(code)
  }

  compileShader (code) {
    return this.device.createShaderModule({ code })
  }

  async createComputePipeline (descriptor) {
    try {
      return await this.device.createComputePipelineAsync(descriptor)
    } catch (err) {
      console.error(
        `[${descriptor.label || 'unknown'} Compute Pipeline] Validation Error:`,
        err.message
      )
    }
  }

  async createRenderPipeline (descriptor) {
    try {
      return await this.device.createRenderPipelineAsync(descriptor)
    } catch (err) {
      console.error(
        `[${descriptor.label || 'unknown'} Render Pipeline] Validation Error:`,
        err.message
      )
    }
  }

  // Bind groups are created if necessary and cached
  getBindGroup (pipeline, ...resources) {
    return this.bindGroupCache.get(pipeline, 0, ...resources)
  }

  // Bind groups are always created fresh
  makeBindGroup (pipeline, ...resources) {
    return this.bindGroupCache.make(pipeline, 0, ...resources)
  }

  async init () {
    // Compile Shaders
    // Create pipelines
    // Make internal resources
    // etc.
  }

  run () {
    throw new Error('run() must be implemented!')
  }
}

export class ConvertShader extends Shader {
  static filename = 'convert.wgsl'

  static WindowFunctions = {
    None: 0,
    HammingWindow: 1,
    HannWindow: 2,
    BlackmanWindow: 3,
    GaussianWindow: 4
  }

  async init () {
    const module = await this.fetchShaderModule()
    this.convertPipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main'
      }
    })

    this.convertExternalPipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main_external'
      }
    })

    this.uniformBuffer = this.device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
    this.uniformResource = { buffer: this.uniformBuffer }
  }

  run (encoder, input, output) {
    let pipeline, bindGroup

    if (input instanceof GPUExternalTexture) {
      pipeline = this.convertExternalPipeline
      bindGroup = this.makeBindGroup(
        pipeline,
        null,
        input,
        output,
        this.uniformResource
      )
    } else {
      pipeline = this.convertPipeline
      bindGroup = this.getBindGroup(
        pipeline,
        input,
        null,
        output,
        this.uniformResource
      )
    }
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(
      Math.ceil(this.size / 8),
      Math.ceil(this.size / 8)
    )
    pass.end()
  }

  setWindow (idx) {
    if (isNaN(idx) || idx < 0) {
      idx = 0
    }

    const arr = new Uint32Array([idx])
    this.device.queue.writeBuffer(this.uniformBuffer, 0, arr)
  }

  setFlipX (bool) {
    const arr = new Uint32Array([ bool ? 1 : 0 ])
    this.device.queue.writeBuffer(this.uniformBuffer, 4, arr)
  }
}

export class PeriodicPlusSmoothShader extends Shader {
  static filename = 'periodic-plus-smooth.wgsl'
  async init () {
    const module = await this.fetchShaderModule()

    this.boundaryImagePipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'boundaryImage' }
    })

    this.poissonPipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'poisson' }
    })

    this.decomposePipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'decompose' }
    })
  }

  run (encoder, input, ping, pong) {
    const fft = this.manager.getShaderInstance(FFTShader)

    // Compute Boundary Image from I -> V
    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.boundaryImagePipeline)
      pass.setBindGroup(0, this.getBindGroup(
        this.boundaryImagePipeline,
        input, // I
        ping // V
      ))
      pass.dispatchWorkgroups(
        Math.ceil(this.size / 8),
        Math.ceil(this.size / 8)
      )
      pass.end()
    }

    // FFT(V) -> V-hat
    fft.run(encoder, ping, pong)

    // Poisson Filter on V-hat -> s-hat
    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.poissonPipeline)
      pass.setBindGroup(0, this.getBindGroup(
        this.poissonPipeline,
        ping, // V-hat
        pong // s-hat
      ))
      pass.dispatchWorkgroups(
        Math.ceil(this.size / 8),
        Math.ceil(this.size / 8)
      )
      pass.end()
    }

    // s-hat -> s
    fft.runInverse(encoder, pong, ping)

    // p = I - s
    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.decomposePipeline)
      pass.setBindGroup(0, this.getBindGroup(
        this.decomposePipeline,
        pong, // s
        ping, // p
        input, // I
      ))
      pass.dispatchWorkgroups(
        Math.ceil(this.size / 8),
        Math.ceil(this.size / 8)
      )
      pass.end()
    }
  }
}

export class FFTShader extends Shader {
  static filename = 'fft-stockham.wgsl'

  static getRequiredLimits (size) {
    return {
      maxComputeWorkgroupSizeX: size / RADIX,
      maxComputeInvocationsPerWorkgroup: size / RADIX
    }
  }

  async init () {
    const module = await this.fetchShaderModule()
    this.fftPipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: {
        module,
        constants: {
          N: this.size,
          WORKGROUP_SIZE: this.size / RADIX
        }
      }
    })

    this.invFftPipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: {
        module,
        constants: {
          N: this.size,
          WORKGROUP_SIZE: this.size / RADIX,
          INVERSE: true
        }
      }
    })
  }

  #run (pipeline, encoder, ping, pong) {
    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, this.getBindGroup(
        pipeline,
        ping,
        pong
      ))
      pass.dispatchWorkgroups(1, this.size)
      pass.end()
    }

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, this.getBindGroup(
        pipeline,
        pong,
        ping
      ))
      pass.dispatchWorkgroups(1, this.size)
      pass.end()
    }
  }

  run (encoder, ping, pong) {
    this.#run(this.fftPipeline, encoder, ping, pong)
  }

  runInverse (encoder, ping, pong) {
    this.#run(this.invFftPipeline, encoder, ping, pong)
  }
}

export class MaskShader extends Shader {
  static filename = 'mask.wgsl'

  static WindowFunctions = {
    None: 0,
    HammingWindow: 1,
    HannWindow: 2,
    BlackmanWindow: 3,
    GaussianWindow: 4
  }

  async init () {
    const module = await this.fetchShaderModule()
    this.pipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: { module }
    })

    this.uniformBuffer = this.device.createBuffer({
      size: 12,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
    this.uniformResource = { buffer: this.uniformBuffer }
  }

  run (encoder, input, output) {
    const pipeline = this.pipeline
    const bindGroup = this.getBindGroup(
      pipeline,
      input,
      output,
      this.uniformResource
    )

    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(
      Math.ceil(this.size / 8),
      Math.ceil(this.size / 8)
    )
    pass.end()
  }

  setWindow (idx) {
    if (isNaN(idx) || idx < 0) {
      idx = 0
    }

    const arr = new Uint32Array([idx])
    this.device.queue.writeBuffer(this.uniformBuffer, 0, arr)
  }

  setRadii (min, max) {
    const arr = new Float32Array([ min, max ])
    this.device.queue.writeBuffer(this.uniformBuffer, 4, arr)
  }
}

export class MagnitudeShader extends Shader {
  static filename = 'magnitude.wgsl'

  static MagnitudeColourMap = {
    None: 0,
    Viridis: 1,
    Plasma: 2,
    Magma: 3,
    Inferno: 4,
    Cividis: 5
  }

  static PhaseColourMap = {
    None: 0,
    Twilight: 1,
    'Colorcet Phase 4': 2,
    Roma: 3,
    Rainbow: 4
  }

  async init () {
    const module = await this.fetchShaderModule()
    this.pipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: { module }
    })

    this.uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
    this.uniformResource = { buffer: this.uniformBuffer }
  }

  run (encoder, input, output, mag_rgba, phase_rgba) {
    const pass = encoder.beginComputePass()
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.getBindGroup(
      this.pipeline,
      input,
      output,
      mag_rgba,
      phase_rgba,
      this.uniformResource
    ))
    pass.dispatchWorkgroups(
      Math.ceil(this.size / 8),
      Math.ceil(this.size / 8)
    )
    pass.end()
  }

  setMagnitudeColourMap (idx) {
    if (isNaN(idx) || idx < 0 || idx > 5) {
      idx = 0
    }

    const arr = new Uint32Array([idx])
    this.device.queue.writeBuffer(this.uniformBuffer, 0, arr)
  }

  setPhaseColourMap (idx) {
    if (isNaN(idx) || idx < 0 || idx > 4) {
      idx = 0
    }

    const arr = new Uint32Array([idx])
    this.device.queue.writeBuffer(this.uniformBuffer, 12, arr)
  }

  setMagnitudeScale (x) {
    if (isNaN(x)) {
      x = 0.25
    } else if (x <= 0) {
      x = 0.01
    }

    const arr = new Float32Array([x])
    this.device.queue.writeBuffer(this.uniformBuffer, 4, arr)
  }

  setCalcPhase (bool) {
    const arr = new Uint32Array([ bool ? 1 : 0 ])
    this.device.queue.writeBuffer(this.uniformBuffer, 8, arr)
  }
}

export class IntegrationShader extends Shader {
  static filename = 'integrate.wgsl'

  async init () {
    const module = await this.fetchShaderModule()

    this.clearPipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'clear',
        constants: {
          NUM_BINS: this.config.integrationBins
        }
      }
    })

    this.integrationPipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'sum',
        constants: {
          NUM_BINS: this.config.integrationBins,
          MAX_RADIUS: this.config.maxIntegrationRadius
        }
      }
    })

    this.normPipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'norm',
        constants: {
          NUM_BINS: this.config.integrationBins
        }
      }
    })

    this.buffers = {
      sum: this.device.createBuffer({
        size: this.config.integrationBins * 4,
        usage: GPUBufferUsage.STORAGE
      }),
      count: this.device.createBuffer({
        size: this.config.integrationBins * 4,
        usage: GPUBufferUsage.STORAGE
      }),
      profile: this.device.createBuffer({
        size: this.config.integrationBins * 4,
        usage: GPUBufferUsage.STORAGE
      }),
      global_max: this.device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE
      })
    }

    this.resources = {}
    for (const [key, buffer] of Object.entries(this.buffers)) {
      this.resources[key] = { buffer }
    }
  }

  get profile () {
    return this.resources.profile
  }

  get global_max () {
    return this.resources.global_max
  }

  run (encoder, input) {
    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.clearPipeline)
      pass.setBindGroup(0, this.getBindGroup(
        this.clearPipeline,
        null,
        this.resources.sum,
        this.resources.count,
        null,
        this.resources.global_max
      ))
      pass.dispatchWorkgroups(
        Math.ceil(this.config.integrationBins / 64)
      )
      pass.end()
    }

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.integrationPipeline)
      pass.setBindGroup(0, this.getBindGroup(
        this.integrationPipeline,
        input,
        this.resources.sum,
        this.resources.count
      ))
      pass.dispatchWorkgroups(
        Math.ceil(this.size / 8),
        Math.ceil(this.size / 8)
      )
      pass.end()
    }

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.normPipeline)
      pass.setBindGroup(0, this.getBindGroup(
        this.normPipeline,
        null,
        this.resources.sum,
        this.resources.count,
        this.resources.profile,
        this.resources.global_max
      ))
      pass.dispatchWorkgroups(
        Math.ceil(this.config.integrationBins / 64)
      )
      pass.end()
    }
  }
}


export class Float32Downcast extends Shader {
  static filename = 'float32-downcast.wgsl'

  active = true

  static getOptionalFeatures (size) {
    return [ "float32-filterable" ]
  }

  async init () {
    // Downcast is not required on modern GPUs
    if (this.device.features.has("float32-filterable")) {
      this.run = function noop () {}
      this.active = false
      return
    }

    const module = await this.fetchShaderModule()
    this.pipeline = await this.createComputePipeline({
      layout: 'auto',
      compute: { module }
    })
  }

  run (encoder, input, output) {
    const pipeline = this.pipeline
    const bindGroup = this.getBindGroup(pipeline, input, output)

    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(
      Math.ceil(this.size / 8),
      Math.ceil(this.size / 8)
    )
    pass.end()
  }
}


export class RenderTextureShader extends Shader {
  static filename = 'render-ft.wgsl'

  async init () {
    const module = await this.fetchShaderModule()
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear"
    })

    const makePipeline = async (entryPoint, GREYSCALE) =>
      await this.createRenderPipeline({
        layout: 'auto',
        vertex: { module },
        fragment: {
          module,
          targets: [{ format: this.format }],
          entryPoint,
          constants: { GREYSCALE }
        }
      })

    this.colourPipelines = {
      default: await makePipeline('fs', false),
      external: await makePipeline('fs_external', false)
    }

    this.greyscalePipelines = {
      default: await makePipeline('fs', true),
      external: await makePipeline('fs_external', true)
    }
  }

  #run (pipelines, encoder, input, output) {
    let pipeline, bindGroup
    if (input instanceof GPUExternalTexture) {
      pipeline = pipelines.external
      bindGroup = this.makeBindGroup(
        pipelines.external,
        null,
        input,
        this.sampler
      )
    } else {
      pipeline = pipelines.default
      bindGroup = this.getBindGroup(
        pipelines.default,
        input,
        null,
        this.sampler
      )
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: output,
        loadOp: "clear",
        storeOp: "store"
      }]
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()
  }

  run (encoder, input, output) {
    this.#run(this.colourPipelines, encoder, input, output)
  }

  runGreyscale (encoder, input, output) {
    this.#run(this.greyscalePipelines, encoder, input, output)
  }
}

export class RenderProfileShader extends Shader {
  static filename = 'render-plot.wgsl'

  #backgroundCol = [ 0, 0, 0, 1 ]

  async init () {
    const module = await this.fetchShaderModule()

    this.pipeline = await this.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        constants: {
          SIZE: this.config.integrationBins
        }
      },
      fragment: {
        module,
        targets: [{ format: this.format }]
      },
      primitive: { topology: "line-strip" }
    })

    this.uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
    this.uniformResource = { buffer: this.uniformBuffer }
  }

  run (encoder, profile, yMax, output) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: output,
        loadOp: "clear",
        storeOp: "store",
          clearValue: this.#backgroundCol
      }]
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.getBindGroup(
      this.pipeline,
      profile,
      yMax,
      this.uniformResource
    ))
    pass.draw(this.config.integrationBins)
    pass.end()
  }

  setPalette ({ bg, fg }) {
    this.#backgroundCol = bg
    const arr = new Float32Array(fg)
    this.device.queue.writeBuffer(this.uniformBuffer, 0, arr)
  }
}
