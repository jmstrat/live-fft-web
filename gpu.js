// This class handles uploading a source image to a GPU texture, then
// running FFT and integration shaders to render the output to the 2
// canvases provided.
// Note that `size` must be a power of RADIX
// e.g. for a radix of 4: 4 ^ 4 = 256 | 4 ^ 5 = 1024
// RADIX itself must be a power of 2, higher values are typically more
// efficient, but you quickly hit GPU storage limits.
// If you change RADIX, you must also change the RADIX const
// in Shaders/fft-stockham.wgsl
// Shader constants marked "override" are set by javascript and should not be
// changed

const RADIX = 2

export class FFTWebGPU {

  static InputDisplayMode = {
    raw: 'raw',
    processed: 'processed'
  }

  static InputConversionMode = {
    None: 0,
    HammingWindow: 1,
    HannWindow: 2,
    BlackmanWindow: 3,
    GaussianWindow: 4,

    PeriodicPlusSmooth: 99
  }

  static ColourMap = {
    None: 0,
    Viridis: 1,
    Plasma: 2,
    Magma: 3,
    Inferno: 4,
    Cividis: 5
  }

  #inputDisplayMode = 'raw'
  #periodicPlusSmooth = false

  async init (inputCanvas, ftCanvas, integrationCanvas, size) {
    this.size = size
    // This is just for the integration, we don't include the corners
    this.maxR = (size / 2) - 1
    this.integrationBins = integrationCanvas.width
    if (!navigator.gpu) {
      const err = new Error('WebGPU not supported')
      err.code = 'WEBGPU_MISSING'
      throw err
    }

    this.adapter = await navigator.gpu.requestAdapter()
    if (!this.adapter) {
      const err = new Error("No WebGPU adapter found")
      err.code = 'WEBGPU_ADAPTER_MISSING'
      throw err
    }

    const requiredFeatures = []

    if (this.adapter.features.has("float32-filterable")) {
      requiredFeatures.push("float32-filterable")
      this.canRenderFloat32 = true
    } else {
      this.canRenderFloat32 = false
    }

    try {
      this.device = await this.adapter.requestDevice({
        requiredLimits: {
          maxComputeWorkgroupSizeX: this.size / RADIX,
          maxComputeInvocationsPerWorkgroup: this.size / RADIX
        },
        requiredFeatures
      })
    } catch (err) {
      const wrapped = new Error('WebGPU limits unsupported', { cause: err })
      wrapped.code = 'LIMITS_UNSUPPORTED'
      throw wrapped
    }

    this.format = navigator.gpu.getPreferredCanvasFormat()

    this.ctxInput = inputCanvas.getContext('webgpu')
    this.ctxInput.configure({ device: this.device, format: this.format })

    this.ctxFFT = ftCanvas.getContext('webgpu')
    this.ctxFFT.configure({ device: this.device, format: this.format })

    this.ctxPlot = integrationCanvas.getContext('webgpu')
    this.ctxPlot.configure({ device: this.device, format: this.format })

    await this.compileShaders()
    this.makeResources()
    this.makePipelines()
  }

  setInputTextureConvertMethod (idx) {
    if (isNaN(idx) || idx < 0) {
      idx = 0
    }

    if (idx === FFTWebGPU.InputConversionMode.PeriodicPlusSmooth) {
      idx = 0
      this.#periodicPlusSmooth = true
    } else {
      this.#periodicPlusSmooth = false
    }

    const arr = new Uint32Array([idx])
    this.device.queue.writeBuffer(this.buffers.convertUniforms, 0, arr)
  }

  setInputTextureDisplayMode (mode) {
    if (mode === FFTWebGPU.InputDisplayMode.processed) {
      if (!this.canRenderFloat32) {
        console.error('Cannot render processed input due to lack of GPU hardware support')
        this.#inputDisplayMode = FFTWebGPU.InputDisplayMode.raw
      } else {
        this.#inputDisplayMode = FFTWebGPU.InputDisplayMode.processed
      }
    } else {
      this.#inputDisplayMode = FFTWebGPU.InputDisplayMode.raw
    }
  }

  setFlipX (bool) {
    const arr = new Uint32Array([ bool ? 1 : 0 ])
    this.device.queue.writeBuffer(this.buffers.convertUniforms, 4, arr)
  }

  setColourMap (idx) {
    if (isNaN(idx) || idx < 0 || idx > 5) {
      idx = 0
    }

    const arr = new Uint32Array([idx])
    this.device.queue.writeBuffer(this.buffers.magnitudeUniforms, 0, arr)
  }

  setMagnitudeScale (x) {
    if (isNaN(x)) {
      x = 0.25
    } else if (x <= 0) {
      x = 0.01
    }

    const arr = new Float32Array([x])
    this.device.queue.writeBuffer(this.buffers.magnitudeUniforms, 4, arr)
  }

  makeResources () {
    const createTexture = (
      format,
      usage=GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.TEXTURE_BINDING
    ) => this.device.createTexture({ size: [this.size, this.size], format, usage })

    this.textures = {
      input: createTexture(
        this.format,
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT
      ),
      // Complex plane storage (R: Real, G: Imaginary)
      fft: [ createTexture(
        'rg32float',
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
      ), createTexture('rg32float') ],
      greyscaleCopy: createTexture(
        'rg32float',
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      ),
      output: createTexture('rgba8unorm')
    }

    this.views = {
      input: this.textures.input.createView(),
      fft: this.textures.fft.map(x => x.createView()),
      greyscaleCopy: this.textures.greyscaleCopy.createView(),
      output: this.textures.output.createView()
    }

    this.buffers = {
      sum: this.device.createBuffer({
        size: this.integrationBins * 4,
        usage: GPUBufferUsage.STORAGE
      }),
      count: this.device.createBuffer({
        size: this.integrationBins * 4,
        usage: GPUBufferUsage.STORAGE
      }),
      profile: this.device.createBuffer({
        size: this.integrationBins * 4,
        usage: GPUBufferUsage.STORAGE
      }),
      global_max: this.device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE
      }),
      convertUniforms: this.device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      }),
      magnitudeUniforms: this.device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })
    }
  }

  async compileShaders () {
    const convert = await (await fetch('Shaders/convert.wgsl')).text()
    const boundaryImage = await (await fetch('Shaders/boundary-image.wgsl')).text()
    const poisson = await (await fetch('Shaders/poisson.wgsl')).text()
    const decompose = await (await fetch('Shaders/decompose.wgsl')).text()
    const fft = await (await fetch('Shaders/fft-stockham.wgsl')).text()
    const magnitude = await (await fetch('Shaders/magnitude.wgsl')).text()
    const integration = await (await fetch('Shaders/integrate.wgsl')).text()
    const renderFT = await (await fetch('Shaders/render-ft.wgsl')).text()
    const renderPlot = await (await fetch('Shaders/render-plot.wgsl')).text()

    this.shaders = {
      convert: this.device.createShaderModule({ code: convert }),
      boundaryImage: this.device.createShaderModule({ code: boundaryImage }),
      poisson: this.device.createShaderModule({ code: poisson }),
      decompose: this.device.createShaderModule({ code: decompose }),
      fft: this.device.createShaderModule({ code: fft }),
      magnitude: this.device.createShaderModule({ code: magnitude }),
      integration: this.device.createShaderModule({ code: integration }),

      render: this.device.createShaderModule({ code: renderFT }),
      plot: this.device.createShaderModule({ code: renderPlot })
    }
  }

  makePipelines () {
    this.convertPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.shaders.convert,
        entryPoint: 'main'
      }
    })

    this.convertExternalPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.shaders.convert,
        entryPoint: 'main_external'
      }
    })

    this.convertBindGroup = this.device.createBindGroup({
      layout: this.convertPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.input },
        { binding: 2, resource: this.views.fft[0] },
        { binding: 3, resource: { buffer: this.buffers.convertUniforms } }
      ]
    })

    const ConvertExternalBingGroupLayout = this.convertExternalPipeline.getBindGroupLayout(0)
    this.makeConvertExternalBingGroup = (externalTexture) => {
      return this.device.createBindGroup({
        layout: ConvertExternalBingGroupLayout,
        entries: [
          { binding: 1, resource: externalTexture },
          { binding: 2, resource: this.views.fft[0] },
          { binding: 3, resource: { buffer: this.buffers.convertUniforms } }
        ]
      })
    }

    this.boundaryImagePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.shaders.boundaryImage }
    })

    this.boundaryImageBindGroup = this.device.createBindGroup({
      layout: this.boundaryImagePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.greyscaleCopy },
        { binding: 1, resource: this.views.fft[0] }
      ]
    })

    this.poissonPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.shaders.poisson }
    })

    this.poissonBindGroup = this.device.createBindGroup({
      layout: this.poissonPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.fft[0] },
        { binding: 1, resource: this.views.fft[1] }
      ]
    })

    this.decomposePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.shaders.decompose }
    })

    this.decomposeBindGroup = this.device.createBindGroup({
      layout: this.decomposePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.greyscaleCopy },
        { binding: 1, resource: this.views.fft[1] },
        { binding: 2, resource: this.views.fft[0] }
      ]
    })

    this.fftPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.shaders.fft,
        constants: {
          N: this.size,
          WORKGROUP_SIZE: this.size / RADIX
        }
      }
    })

    this.invFftPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.shaders.fft,
        constants: {
          N: this.size,
          WORKGROUP_SIZE: this.size / RADIX,
          INVERSE: true
        }
      }
    })

    this.fftBindGroups = new Array(2)
    this.fftBindGroups[0] = this.device.createBindGroup({
      layout: this.fftPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.fft[0] },
        { binding: 1, resource: this.views.fft[1] }
      ]
    })

    this.fftBindGroups[1] = this.device.createBindGroup({
      layout: this.fftPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.fft[1] },
        { binding: 1, resource: this.views.fft[0] }
      ]
    })

    this.invFftBindGroups = new Array(2)
    this.invFftBindGroups[0] = this.device.createBindGroup({
      layout: this.invFftPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.fft[0] },
        { binding: 1, resource: this.views.fft[1] }
      ]
    })

    this.invFftBindGroups[1] = this.device.createBindGroup({
      layout: this.invFftPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.fft[1] },
        { binding: 1, resource: this.views.fft[0] }
      ]
    })

    this.magnitudePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.shaders.magnitude }
    })

    this.magnitudeBindGroup = this.device.createBindGroup({
      layout: this.magnitudePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.fft[0] },
        { binding: 1, resource: this.views.fft[1] },
        { binding: 2, resource: this.views.output },
        { binding: 3, resource: { buffer: this.buffers.magnitudeUniforms } }
      ]
    })

    // n.b. this.views.fft[1] is now magnitude, dist

    this.integrationClearPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.shaders.integration,
        entryPoint: 'clear',
        constants: {
          NUM_BINS: this.integrationBins
        }
      }
    })

    this.integrationPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.shaders.integration,
        entryPoint: 'sum',
        constants: {
          NUM_BINS: this.integrationBins,
          MAX_RADIUS: this.maxR
        }
      }
    })

    this.integrationNormPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.shaders.integration,
        entryPoint: 'norm',
        constants: {
          NUM_BINS: this.integrationBins
        }
      }
    })

    this.integrationClearBindGroup = this.device.createBindGroup({
      layout: this.integrationClearPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 1, resource: { buffer: this.buffers.sum } },
        { binding: 2, resource: { buffer: this.buffers.count } },
        { binding: 4, resource: { buffer: this.buffers.global_max } }
      ]
    })

    this.integrationBindGroup = this.device.createBindGroup({
      layout: this.integrationPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.fft[1] },
        { binding: 1, resource: { buffer: this.buffers.sum } },
        { binding: 2, resource: { buffer: this.buffers.count } }
      ]
    })

    this.integrationNormBindGroup = this.device.createBindGroup({
      layout: this.integrationNormPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 1, resource: { buffer: this.buffers.sum } },
        { binding: 2, resource: { buffer: this.buffers.count } },
        { binding: 3, resource: { buffer: this.buffers.profile } },
        { binding: 4, resource: { buffer: this.buffers.global_max } }
      ]
    })

    const sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear"
    })

    const makeRenderPipeline = (constants, view) => {
      const pipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: this.shaders.render
        },
        fragment: {
          module: this.shaders.render,
          targets: [{ format: this.format }],
          constants
        }
      })

      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: view
          },
          {
            binding: 1,
            resource: sampler
          }
        ]
      })
      return { pipeline, bindGroup }
    }

    this.renderPipelines = {
      [FFTWebGPU.InputDisplayMode.raw]: makeRenderPipeline({ GREYSCALE: false }, this.views.input),
      [FFTWebGPU.InputDisplayMode.processed]: makeRenderPipeline({ GREYSCALE: true }, this.views.fft[0]),
      output: makeRenderPipeline({ GREYSCALE: false }, this.views.output),
    }

    this.plotPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: this.shaders.plot,
        constants: {
          SIZE: this.integrationBins
        }
      },
      fragment: {
        module: this.shaders.plot,
        targets: [{ format: this.format }]
      },
      primitive: { topology: "line-strip" }
    })

    this.plotBindGroup = this.device.createBindGroup({
      layout: this.plotPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.profile } },
        { binding: 1, resource: { buffer: this.buffers.global_max } }
      ]
    })
  }

  render (source) {

    const encoder = this.device.createCommandEncoder()

    if (source instanceof GPUExternalTexture) {
      {
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.convertExternalPipeline)
        pass.setBindGroup(0, this.makeConvertExternalBingGroup(source))
        pass.dispatchWorkgroups(
          Math.ceil(this.size / 8),
          Math.ceil(this.size / 8)
        )
        pass.end()
      }
    } else {
      this.device.queue.copyExternalImageToTexture(
        { source },
        { texture: this.textures.input },
        [this.size, this.size]
      )

      {
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.convertPipeline)
        pass.setBindGroup(0, this.convertBindGroup)
        pass.dispatchWorkgroups(
          Math.ceil(this.size / 8),
          Math.ceil(this.size / 8)
        )
        pass.end()
      }
    }

    if (this.#periodicPlusSmooth) {
      // Backup the greyscale image (I)
      encoder.copyTextureToTexture(
        { texture: this.textures.fft[0] },
        { texture: this.textures.greyscaleCopy },
        [this.size, this.size]
      )

      // Compute Boundary Image from I -> V
      {
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.boundaryImagePipeline)
        pass.setBindGroup(0, this.boundaryImageBindGroup)
        pass.dispatchWorkgroups(
          Math.ceil(this.size / 8),
          Math.ceil(this.size / 8)
        )
        pass.end()
      }

      // FFT(V) -> V-hat
      {
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.fftPipeline)
        pass.setBindGroup(0, this.fftBindGroups[0])
        pass.dispatchWorkgroups(1, this.size)
        pass.end()
      }

      {
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.fftPipeline)
        pass.setBindGroup(0, this.fftBindGroups[1])
        pass.dispatchWorkgroups(1, this.size)
        pass.end()
      }

      // Poisson Filter on V-hat -> S-hat
      {
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.poissonPipeline)
        pass.setBindGroup(0, this.poissonBindGroup)
        pass.dispatchWorkgroups(
          Math.ceil(this.size / 8),
          Math.ceil(this.size / 8)
        )
        pass.end()
      }

      // InvFFT(S-hat) -> s
      {
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.invFftPipeline)
        pass.setBindGroup(0, this.invFftBindGroups[1])
        pass.dispatchWorkgroups(1, this.size)
        pass.end()
      }

      {
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.invFftPipeline)
        pass.setBindGroup(0, this.invFftBindGroups[0])
        pass.dispatchWorkgroups(1, this.size)
        pass.end()
      }

      // I - s
      {
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.decomposePipeline)
        pass.setBindGroup(0, this.decomposeBindGroup)
        pass.dispatchWorkgroups(
          Math.ceil(this.size / 8),
          Math.ceil(this.size / 8)
        )
        pass.end()
      }
    }

    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.ctxInput.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store"
        }]
      })

      const { pipeline, bindGroup } = this.renderPipelines[this.#inputDisplayMode]

      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(3)
      pass.end()
    }

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.fftPipeline)
      pass.setBindGroup(0, this.fftBindGroups[0])
      pass.dispatchWorkgroups(1, this.size)
      pass.end()
    }

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.fftPipeline)
      pass.setBindGroup(0, this.fftBindGroups[1])
      pass.dispatchWorkgroups(1, this.size)
      pass.end()
    }

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.magnitudePipeline)
      pass.setBindGroup(0, this.magnitudeBindGroup)
      pass.dispatchWorkgroups(
        Math.ceil(this.size / 8),
        Math.ceil(this.size / 8)
      )
      pass.end()
    }

    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.ctxFFT.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store"
        }]
      })

      const { pipeline, bindGroup } = this.renderPipelines.output

      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(3)
      pass.end()
    }

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.integrationClearPipeline)
      pass.setBindGroup(0, this.integrationClearBindGroup)
      pass.dispatchWorkgroups(
        Math.ceil(this.integrationBins / 64)
      )
      pass.end()
    }

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.integrationPipeline)
      pass.setBindGroup(0, this.integrationBindGroup)
      pass.dispatchWorkgroups(
        Math.ceil(this.size / 8),
        Math.ceil(this.size / 8)
      )
      pass.end()
    }

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.integrationNormPipeline)
      pass.setBindGroup(0, this.integrationNormBindGroup)
      pass.dispatchWorkgroups(
        Math.ceil(this.integrationBins / 64)
      )
      pass.end()
    }

    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.ctxPlot.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store"
        }]
      })

      pass.setPipeline(this.plotPipeline)
      pass.setBindGroup(0, this.plotBindGroup)
      pass.draw(this.integrationBins)
      pass.end()
    }

    this.device.queue.submit([encoder.finish()])
  }
}
