import { Source } from '../source.js'
import { Generators } from './generators.js'

export class GeneratorSource extends Source {
  #settingsEl = document.getElementById('generator-section')
  #ctx
  #activeGenerator

  async init (size) {
    const canvas = new OffscreenCanvas(size, size)
    this.#ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false })
    Object.values(Generators).forEach(g => g.init(canvas, this.#ctx))

    this.settings.subscribe('currentPattern', (key) => {
      this.#activeGenerator = Generators[key]
      this.#activeGenerator?.markDirty?.()
    })

    this.settings.addSetting(
      'currentPattern',
      {
        el: document.getElementById('generator-select'),
        storageKey: 'generator',
        default: Object.keys(Generators)[0]
      }
    )

    this.settings.subscribe('lightDark', (val) => {
      const palette = val === 'light' ? { fg: 'black', bg: 'white' } : { fg: 'white', bg: 'black' }
      Object.values(Generators).forEach(g => g.setPalette(palette))
      this.#activeGenerator?.markDirty?.()
    })

    this.#refreshGeneratorOptions()
  }

  async activate () {
    this.#settingsEl.classList.remove('hidden')
    this.#activeGenerator?.markDirty?.()
  }

  deactivate () {
    this.#settingsEl.classList.add('hidden')
  }

  isDirty () {
    return this.#activeGenerator?.isDirty?.() ?? false
  }

  getFrame () {
    const generator = this.#activeGenerator
    generator?.draw?.()
    return generator.canvas
  }

  #refreshGeneratorOptions () {
    const patternOptions = Object.keys(Generators).map(name => new Option(name, name))

    this.settings.setOptions('currentPattern', patternOptions)
  }
}
