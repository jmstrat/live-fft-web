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

const RADIX = 4

export class FFTWebGPU {
  async init (inputCanvas, ftCanvas, integrationCanvas, size) {
    this.size = size
    // This is just for the integration, we don't include the corners
    this.maxR = (size / 2) - 1
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

    try {
      this.device = await this.adapter.requestDevice({
        requiredLimits: {
          maxComputeWorkgroupSizeX: this.size / RADIX,
          maxComputeInvocationsPerWorkgroup: this.size / RADIX
        }
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
      fft: [ createTexture('rg32float'), createTexture('rg32float') ],
      output: createTexture('rgba8unorm')
    }

    this.views = {
      input: this.textures.input.createView(),
      fft: this.textures.fft.map(x => x.createView()),
      output: this.textures.output.createView()
    }

    this.buffers = {
      sum: this.device.createBuffer({
        size: this.maxR * 4,
        usage: GPUBufferUsage.STORAGE
      }),
      count: this.device.createBuffer({
        size: this.maxR * 4,
        usage: GPUBufferUsage.STORAGE
      }),
      profile: this.device.createBuffer({
        size: this.maxR * 4,
        usage: GPUBufferUsage.STORAGE
      }),
      global_max: this.device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE
      })
    }
  }

  async compileShaders () {
    const convert = await (await fetch('Shaders/convert.wgsl')).text()
    const fft = await (await fetch('Shaders/fft-stockham.wgsl')).text()
    const magnitude = await (await fetch('Shaders/magnitude.wgsl')).text()
    const integration = await (await fetch('Shaders/integrate.wgsl')).text()
    const renderFT = await (await fetch('Shaders/render-ft.wgsl')).text()
    const renderPlot = await (await fetch('Shaders/render-plot.wgsl')).text()

    this.shaders = {
      convert: this.device.createShaderModule({ code: convert }),
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
      compute: { module: this.shaders.convert }
    })

    this.convertBindGroup = this.device.createBindGroup({
      layout: this.convertPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.input },
        { binding: 1, resource: this.views.fft[0] }
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

    this.fftBindGroupH = this.device.createBindGroup({
      layout: this.fftPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.fft[0] },
        { binding: 1, resource: this.views.fft[1] }
      ]
    })

    this.fftBindGroupV = this.device.createBindGroup({
      layout: this.fftPipeline.getBindGroupLayout(0),
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
        { binding: 2, resource: this.views.output }
      ]
    })

    // n.b. this.views.fft[1] is now magnitude, dist

    this.integrationClearPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.shaders.integration, entryPoint: 'clear'}
    })

    this.integrationPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.shaders.integration, entryPoint: 'sum'}
    })

    this.integrationNormPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.shaders.integration, entryPoint: 'norm'}
    })

    this.integrationClearBindGroup = this.device.createBindGroup({
      layout: this.integrationClearPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 1, resource: { buffer: this.buffers.sum } },
        { binding: 2, resource: { buffer: this.buffers.count } },
        { binding: 3, resource: { buffer: this.buffers.profile } },
        { binding: 4, resource: { buffer: this.buffers.global_max } }
      ]
    })

    this.integrationBindGroup = this.device.createBindGroup({
      layout: this.integrationPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.views.fft[1] },
        { binding: 1, resource: { buffer: this.buffers.sum } },
        { binding: 2, resource: { buffer: this.buffers.count } },
        { binding: 3, resource: { buffer: this.buffers.profile } }
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

    this.renderPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: this.shaders.render
      },
      fragment: {
        module: this.shaders.render,
        targets: [{ format: this.format }]
      }
    })

    const sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear"
    })

    this.renderInputBindGroup = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: this.views.input
        },
        {
          binding: 1,
          resource: sampler
        }
      ]
    })

    this.renderFFTBindGroup = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: this.views.output
        },
        {
          binding: 1,
          resource: sampler
        }
      ]
    })

    this.plotPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: this.shaders.plot
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
    // In principle we could use importExternalTexture for the live camera to
    // avoid a copy, but then we need to have different shaders for the camera
    // and canvas case as external textures are a different type (and don't
    // support textureLoad).
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture: this.textures.input },
      [this.size, this.size]
    )

    const encoder = this.device.createCommandEncoder()

    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.ctxInput.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store"
        }]
      })

      pass.setPipeline(this.renderPipeline)
      pass.setBindGroup(0, this.renderInputBindGroup)
      pass.draw(3)
      pass.end()
    }

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

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.fftPipeline)
      pass.setBindGroup(0, this.fftBindGroupH)
      pass.dispatchWorkgroups(1, this.size)
      pass.end()
    }

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.fftPipeline)
      pass.setBindGroup(0, this.fftBindGroupV)
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

      pass.setPipeline(this.renderPipeline)
      pass.setBindGroup(0, this.renderFFTBindGroup)
      pass.draw(3)
      pass.end()
    }

    {
      const pass = encoder.beginComputePass()
      pass.setPipeline(this.integrationClearPipeline)
      pass.setBindGroup(0, this.integrationClearBindGroup)
      pass.dispatchWorkgroups(
        Math.ceil(this.maxR / 64)
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
        Math.ceil(this.maxR / 64)
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
      pass.draw(this.maxR)
      pass.end()
    }

    this.device.queue.submit([encoder.finish()])
  }
}
