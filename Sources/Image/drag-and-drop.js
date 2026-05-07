// emits:
// 'statechange': { active: bool, [isMultiple: bool] }
// 'files': { files: [] }
// error: { message }
export class DragAndDropManager extends EventTarget {
  static events = {
    error: 'error',
    files: 'files',
    stateChange: 'statechange'
  }

  #options

  constructor ({
    accept = ['image/*'],
    multiple = true,
    validate = null // function (file) -> bool
  } = {}) {
    super()

    this.#options = { accept, multiple, validate }

    this.#attachListeners()
  }

  destroy () {
    window.removeEventListener('dragover', this.#onDragOver)
    window.removeEventListener('dragleave', this.#onDragLeave)
    window.removeEventListener('drop', this.#onDrop)
  }

  #attachListeners () {
    window.addEventListener('dragover', this.#onDragOver)
    window.addEventListener('dragleave', this.#onDragLeave)
    window.addEventListener('drop', this.#onDrop)
  }

  #matchesAccept (file) {
    if (this.#options.validate) {
      return this.#options.validate(file)
    }

    return this.#options.accept.some(type => {
      if (type.endsWith('/*')) {
        return file.type.startsWith(type.replace('*', ''))
      }
      return file.type === type
    })
  }

  #extractValidFiles (fileList) {
    const files = Array.from(fileList).filter(f => this.#matchesAccept(f))
    return this.#options.multiple ? files : files.slice(0, 1)
  }

  #onDragOver = (e) => {
    e.preventDefault()

    const dt = e.dataTransfer
    const types = Array.from(dt.types || [])
    const isFileDrag = types.includes('Files')

    let validCount = 0

    if (dt.items && dt.items.length > 0) {
      for (const item of dt.items) {
        if (item.kind === 'file') {
          const fakeFile = { type: item.type }
          if (this.#matchesAccept(fakeFile)) {
            validCount++
            if (!this.#options.multiple && validCount > 1) break
          }
        }
      }
    } else if (isFileDrag) {
      // Safari fallback
      // Safari doesn't populate items on dragover
      validCount = 2
    }

    const hasValid = validCount > 0
    const isMultiple = validCount > 1

    if (hasValid) {
      dt.dropEffect = 'copy'
      this.#emitState({ active: true, isMultiple })
    } else {
      dt.dropEffect = 'none'
      this.#emitState({ active: false })
    }
  }

  #onDragLeave = () => {
    this.#emitState({ active: false })
  }

  #onDrop = async (e) => {
    e.preventDefault()

    const files = this.#extractValidFiles(e.dataTransfer.files)

    this.#emitState({ active: false })

    if (files.length === 0) {
      this.dispatchEvent(new CustomEvent(DragAndDropManager.events.error, {
        detail: { message: 'No valid files dropped' }
      }))
      return
    }

    this.dispatchEvent(new CustomEvent(DragAndDropManager.events.files, {
      detail: { files }
    }))
  }

  #emitState (state) {
    this.dispatchEvent(new CustomEvent(DragAndDropManager.events.stateChange, {
      detail: state
    }))
  }
}
