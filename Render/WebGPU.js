import {
  ConvertShader,
  PeriodicPlusSmoothShader,
  FFTShader,
  MagnitudeShader,
  IntegrationShader,

  Float32Downcast,

  RenderTextureShader,
  RenderProfileShader
} from './Shaders/index.js'

export class FFTWebGPU {

  static errorCodes = {
    Unavailable: 'WEBGPU_MISSING',
    AdapterMissing: 'WEBGPU_ADAPTER_MISSING',
    LimitsUnsupported: 'LIMITS_UNSUPPORTED'
  }

  static InputDisplayMode = {
    raw: 'raw',
    processed: 'processed'
  }

  static InputConversionMode = {
    ...ConvertShader.WindowFunctions,
    PeriodicPlusSmooth: Symbol()
  }


  static MagnitudeColourMap = MagnitudeShader.MagnitudeColourMap
  static PhaseColourMap = MagnitudeShader.PhaseColourMap

  static shaders = [
    ConvertShader,
    PeriodicPlusSmoothShader,
    FFTShader,
    MagnitudeShader,
    IntegrationShader,
    Float32Downcast,
    RenderTextureShader,
    RenderProfileShader
  ]
  #shaders = new Map()

  #inputDisplayMode = 'raw'
  #periodicPlusSmooth = false
  #renderPhase = false

  // canvases should be { input, magnitude, phase, integration }
  async init (canvases, size) {
    this.size = size

    // Static configuration (never changes)
    const config = {
      maxIntegrationRadius: (size / 2) - 1,
      integrationBins: canvases.integration.width
    }

    await this.#getDevice()
    this.format = navigator.gpu.getPreferredCanvasFormat()

    for (const shader of FFTWebGPU.shaders) {
      const instance = new shader(this, size, config)
      await instance.init()
      this.#shaders.set(shader, instance)
    }

    const canvasContexts = {}
    for (const [id, canvas] of Object.entries(canvases)) {
      const context = canvas.getContext('webgpu')
      canvasContexts[id] = context
      context.configure({ device: this.device, format: this.format })
    }
    this.canvases = canvasContexts
    this.#makeTextures()
  }

  async #getDevice () {
    if (!navigator.gpu) {
      const err = new Error('WebGPU not supported')
      err.code = FFTWebGPU.errorCodes.Unavailable
      throw err
    }

    this.adapter = await navigator.gpu.requestAdapter()
    if (!this.adapter) {
      const err = new Error("No WebGPU adapter found")
      err.code = FFTWebGPU.errorCodes.AdapterMissing
      throw err
    }

    const featuresAndLimits = this.#getDeviceRequirements()
    for (const feature of featuresAndLimits.optionalFeatures) {
      if (!this.adapter.features.has(feature)) {
        console.warn('GPU does not support', feature)
        featuresAndLimits.optionalFeatures.delete(feature)
      }
    }

    try {
      this.device = await this.adapter.requestDevice({
        requiredLimits: featuresAndLimits.requiredLimits,
        requiredFeatures: featuresAndLimits.requiredFeatures.union(featuresAndLimits.optionalFeatures)
      })
    } catch (err) {
      const wrapped = new Error('WebGPU limits unsupported', { cause: err })
      wrapped.code = FFTWebGPU.errorCodes.LimitsUnsupported
      throw wrapped
    }
  }

  #getDeviceRequirements () {
    const mergedFeatures = new Set()
    const mergedOptionalFeatures = new Set()
    const mergedLimits = {}

    for (const shader of FFTWebGPU.shaders) {
      const requiredFeatures = shader.getRequiredFeatures(this.size)
      const optionalFeatures = shader.getOptionalFeatures(this.size)
      const requiredLimits = shader.getRequiredLimits(this.size)

      requiredFeatures.forEach(mergedFeatures.add, mergedFeatures)
      optionalFeatures.forEach(mergedOptionalFeatures.add, mergedOptionalFeatures)

      for (const [key, value] of Object.entries(requiredLimits)) {
        if (mergedLimits[key] === undefined) {
          mergedLimits[key] = value
          continue
        }

        const isMinConstraint = key.startsWith('min') || key.includes('Alignment')

        if (isMinConstraint) {
          mergedLimits[key] = Math.min(mergedLimits[key], value)
        } else {
          mergedLimits[key] = Math.max(mergedLimits[key], value)
        }
      }
    }

    return {
      requiredFeatures: mergedFeatures,
      optionalFeatures: mergedOptionalFeatures,
      requiredLimits: mergedLimits
    }
  }

  #createTexture (format, usage) {
    return this.device.createTexture({
      size: [ this.size, this.size, 1 ],
      format,
      usage
    })
  }

  #makeTextures () {
    this.textures = {
      input: this.#createTexture(
        this.format,
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
      ),

      // (R: Real, G: Imaginary)
      fft: [
        this.#createTexture(
          'rg32float',
          GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
        ),
        this.#createTexture(
          'rg32float',
          GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
        )
      ],
      greyscaleCopy: this.#createTexture(
        'rg32float',
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      ),
      outputMagnitude: this.#createTexture(
        'rgba8unorm',
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      ),
      outputPhase: this.#createTexture(
        'rgba8unorm',
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      )
    }

    this.views = {
      input: this.textures.input.createView(),
      fft: this.textures.fft.map(x => x.createView()),
      greyscaleCopy: this.textures.greyscaleCopy.createView(),
      outputMagnitude: this.textures.outputMagnitude.createView(),
      outputPhase: this.textures.outputPhase.createView()
    }
  }

  getShaderInstance (cls) {
    return this.#shaders.get(cls)
  }

  render (source) {
    const encoder = this.device.createCommandEncoder()
    const shaders = this.#shaders

    if (!(source instanceof GPUExternalTexture)) {
      this.device.queue.copyExternalImageToTexture(
        { source },
        { texture: this.textures.input },
        [this.size, this.size]
      )
      source = this.views.input
    }

    shaders.get(ConvertShader).run(
      encoder,
      source,
      this.views.fft[0]
    )

    if (this.#periodicPlusSmooth) {
      // Backup the greyscale image (I)
      encoder.copyTextureToTexture(
        { texture: this.textures.fft[0] },
        { texture: this.textures.greyscaleCopy },
        [this.size, this.size]
      )

      shaders.get(PeriodicPlusSmoothShader).run(
        encoder,
        this.views.greyscaleCopy,
        ...this.views.fft
      )
    }

    // With or without periodic plus smooth, the
    // processed image is stored in this.textures.fft[0]

    if (this.#inputDisplayMode === FFTWebGPU.InputDisplayMode.raw) {
      shaders.get(RenderTextureShader).run(
        encoder,
        source,
        this.canvases.input.getCurrentTexture().createView()
      )
    } else {
      const downcast = shaders.get(Float32Downcast)
      let processedTexture = this.views.fft[0]
      if (downcast.active) {
        // Downcast the processed float32 texture to an 8-bit texture
        // Only necessary on older GPUs
        downcast.run(encoder, this.views.fft[0], this.views.outputPhase)
        processedTexture = this.views.outputPhase
      }

      shaders.get(RenderTextureShader).runGreyscale(
        encoder,
        processedTexture,
        this.canvases.input.getCurrentTexture().createView()
      )
    }

    shaders.get(FFTShader).run(encoder, ...this.views.fft)

    shaders.get(MagnitudeShader).run(
      encoder,
      this.views.fft[0],
      this.views.fft[1],
      this.views.outputMagnitude,
      this.views.outputPhase
    )

    shaders.get(RenderTextureShader).run(
      encoder,
      this.views.outputMagnitude,
      this.canvases.magnitude.getCurrentTexture().createView()
    )

    if (this.#renderPhase) {
      shaders.get(RenderTextureShader).run(
        encoder,
        this.views.outputPhase,
        this.canvases.phase.getCurrentTexture().createView()
      )
    }

    shaders.get(IntegrationShader).run(encoder, this.views.fft[1])

    shaders.get(RenderProfileShader).run(
      encoder,
      shaders.get(IntegrationShader).profile,
      shaders.get(IntegrationShader).global_max,
      this.canvases.integration.getCurrentTexture().createView()
    )

    this.device.queue.submit([encoder.finish()])
  }


  // Settings
  setInputTextureConvertMethod (idx) {
    if (idx === FFTWebGPU.InputConversionMode.PeriodicPlusSmooth) {
      idx = FFTWebGPU.InputConversionMode.None
      this.#periodicPlusSmooth = true
    } else {
      this.#periodicPlusSmooth = false
    }
    this.#shaders.get(ConvertShader).setWindow(idx)
  }

  setInputTextureDisplayMode (mode) {
    this.#inputDisplayMode = mode
  }

  setFlipX (bool) {
    this.#shaders.get(ConvertShader).setFlipX(bool)
  }

  setRenderPhase (bool) {
    this.#renderPhase = bool
    this.#shaders.get(MagnitudeShader).setCalcPhase(bool)
  }

  setMagnitudeColourMap (idx) {
    this.#shaders.get(MagnitudeShader).setMagnitudeColourMap(idx)
  }

  setPhaseColourMap (idx) {
    this.#shaders.get(MagnitudeShader).setPhaseColourMap(idx)
  }

  setMagnitudeScale (x) {
    this.#shaders.get(MagnitudeShader).setMagnitudeScale(x)
  }

  setIntegrationPalette (pal) {
    this.#shaders.get(RenderProfileShader).setPalette(pal)
  }
}
