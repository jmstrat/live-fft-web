import styles from './styles.css' with { type: 'css' }

class ThemeSelector extends HTMLElement {
  #query = window.matchMedia('(prefers-color-scheme: dark)')

  static get observedAttributes () {
    return ['value']
  }

  constructor () {
    super()
    if (this.shadowRoot) {
      this.shadowRoot.adoptedStyleSheets = [ styles ]
    }
  }

  get value () {
    const checked = this.shadowRoot.querySelector('input[type="radio"]:checked')
    return checked?.value || this.getAttribute('value') || 'auto'
  }

  set value (val) {
    this.setAttribute('value', val)
  }

  get resolvedValue () {
    let theme = this.value
    if (theme === 'auto') {
      theme = this.#query.matches ? 'dark' : 'light'
    }
    return theme
  }

  connectedCallback () {
    if (this.hasAttribute('value')) {
      this.#setInputValue(this.getAttribute('value'))
    }

    this.shadowRoot.addEventListener('change', (e) => {
      e.stopPropagation()
      this.#handleUpdate()
      this.#setInputValue(this.value)

      if (!e.target.matches(':focus-visible')) {
        e.target.blur()
      }
    })

    this.#query.addEventListener('change', () => {
      if (this.value === 'auto') {
        this.#handleUpdate()
      }
    })
  }

  attributeChangedCallback (name, oldVal, newVal) {
    if (name === 'value' && oldVal !== newVal) {
      this.#setInputValue(newVal)
      this.#handleUpdate()
    }
  }

  #setInputValue (val) {
    const inputs = this.shadowRoot.querySelectorAll('input')

    for (const input of inputs) {
      const wrapper = input.parentElement
      const isTarget = input.value === val

      input.checked = isTarget

      if (!wrapper) {
        continue
      }

      if (isTarget) {
        wrapper.setAttribute('part', 'btn active')
      } else {
        wrapper.setAttribute('part', 'btn inactive')
      }
    }
  }

  #handleUpdate () {
    let theme = this.value
    if (theme === 'auto') {
      theme = this.#query.matches ? 'dark' : 'light'
    }

    this.dispatchEvent(new CustomEvent('change', {
      detail: { theme: this.resolvedValue },
      bubbles: true,
      composed: true
    }))
  }
}

customElements.define('theme-selector', ThemeSelector)
