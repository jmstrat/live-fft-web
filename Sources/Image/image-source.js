import { Source } from '../source.js'
import { DragAndDropManager } from './drag-and-drop.js'
import { ImageCache } from './cache.js'

const MISSING = Symbol()

export class ImageSource extends Source {
  #settingsEl = document.getElementById('image-section')
  #overlays = {
    noImages: document.getElementById('no-images-overlay'),
    drop: document.getElementById('drop-overlay')
  }

  #activeImage
  #lastDrawnImage = null

  #cache
  #drag = new DragAndDropManager()

  async init (size) {
    this.#cache = new ImageCache(size, size)

    this.settings.subscribe('currentImage', (key) => {
      this.#activeImage = key
    })

    this.settings.addSetting(
      'currentImage',
      {
        el: document.getElementById('image-select'),
        default: ""
      }
    )

    this.#refreshImageOptions()

    this.#drag.addEventListener(DragAndDropManager.events.stateChange, this.#onDrag)
    this.#drag.addEventListener(DragAndDropManager.events.files, this.#onDrop)
  }

  async activate () {
    this.#settingsEl.classList.remove('hidden')
    this.#warnIfNoImages()
  }

  deactivate () {
    this.#settingsEl.classList.add('hidden')
    this.#overlays.noImages.classList.add('hidden')
  }

  isDirty () {
    return this.#activeImage !== this.#lastDrawnImage
  }

  getFrame () {
    let id = this.#activeImage
    let source = this.#cache.get(id)
    if (!source) {
      this.#activeImage = MISSING
      source = this.#cache.black
      id = MISSING
    }

    this.#lastDrawnImage = id
    return source
  }

  #refreshImageOptions () {
    const placeholder = new Option("Drag & Drop to add images to this list", "")
    placeholder.disabled = true
    const separator = new Option("\u2500".repeat(10))
    separator.disabled = true

    const names = this.#cache.names
    const imageOptions = names.map(name => new Option(name, name))

    this.settings.setOptions('currentImage', [placeholder, separator, ...imageOptions])

    if (names.length > 0) {
      const value = names.at(-1)
      this.settings.set('currentImage', value)
    } else {
      this.settings.set('currentImage', "")
    }
  }

  #warnIfNoImages () {
    const size = this.#cache.size
    if (size < 1) {
      this.#overlays.noImages.classList.remove('hidden')
      return
    }

    this.#overlays.noImages.classList.add('hidden')
  }

  #onDrag = ({ detail: { active, isMultiple } }) => {
    const o = this.#overlays
    if (active) {
      o.drop.classList.remove('hidden')
      o.noImages.classList.add('hidden')

      if (isMultiple) {
        o.drop.classList.add('contains-plural')
      } else {
        o.drop.classList.remove('contains-plural')
      }
    } else {
      o.drop.classList.add('hidden')
      this.#warnIfNoImages()
    }
  }

  #onDrop = async ({ detail: { files }}) => {
    await Promise.all(files.map(file => this.#cache.add(file)))
    this.#refreshImageOptions()
    this.forceActivate()
    this.#warnIfNoImages()
  }
}

