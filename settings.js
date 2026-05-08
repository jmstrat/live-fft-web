export class SettingsManager {
  #values = {}
  #configs = {}
  #subscribers = {}
  #lastNotifiedValues = {}

  constructor (storage = window.localStorage) {
    this.storage = storage
  }

  addSetting (key, config) {
    this.#configs[key] = config

    const value = this.#initialValue(config)

    this.#values[key] = value

    if (config.el) {
      this.#bindElement(key, config)
    }

    setTimeout(() => this.#notify(key, value), 0)
  }

  get (key) {
    let value = this.#values[key]
    const config = this.#configs[key]
    if (config?.parse) {
      value = config.parse(value, config.el)
    }
    return value
  }

  #set (key, value, updateEl=true) {
    if (!(key in this.#configs)) {
      return
    }

    if (this.#values[key] === value) {
      this.#notify(key)
      return
    }

    const config = this.#configs[key]

    this.#values[key] = value

    if (config.storageKey) {
      this.storage.setItem(config.storageKey, value)
    }

    if (updateEl) {
      this.#updateElement(config, value)
    }
    this.#notify(key)
  }

  set (key, value) {
    return this.#set(key, value)
  }

  subscribe (key, fn) {
    if (!this.#subscribers[key]) {
      this.#subscribers[key] = []
    }

    this.#subscribers[key].push(fn)
  }

  removeSetting (key) {
    delete this.#values[key]
    delete this.#configs[key]
    delete this.#subscribers[key]
  }

  setOptions (key, options) {
    const config = this.#configs[key]
    if (config.el.tagName !== 'SELECT') {
      throw new Error('setOptions expects a <select> element')
    }

    config.el.replaceChildren(...options)
    this.#updateElement(config, this.get(key))
  }

  #notify (key) {
    const subs = this.#subscribers[key]

    if (!subs) {
      return
    }

    const value = this.get(key)
    const lastValue = this.#lastNotifiedValues[key]
    if (value === lastValue) {
      return
    }
    this.#lastNotifiedValues[key] = value

    for (const fn of subs) {
      fn(value)
    }
  }

  #bindElement (key, config) {
    const el = config.el
    const type = config.type || el.type || 'text'
    const event = config.event || 'change'

    const value = this.#values[key]

    if (type === 'checkbox') {
      el.checked = value
    } else {
      el.value = value
    }

    el.addEventListener(event, () => {
      const value = type === 'checkbox' ? el.checked : el.value
      this.#set(key, value, false)
    })
  }

  #updateElement (config, value) {
    if (!config.el) {
      return
    }

    const el = config.el

    const formatted = config.format ? config.format(value, el) : value

    const type = config.type || el.type
    if (type === 'checkbox') {
      el.checked = formatted
    } else {
      el.value = formatted
    }
  }

  #initialValue (config) {
    const saved = config.storageKey
      ? this.storage.getItem(config.storageKey)
      : null

    if (saved === null || saved === undefined) {
      return config.format ? config.format(config.default) : config.default
    }

    if (typeof config.default === 'boolean') {
      return saved === 'true'
    }

    if (typeof config.default === 'number') {
      return parseFloat(saved)
    }

    return saved
  }
}
