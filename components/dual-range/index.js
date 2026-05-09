// NOTE this is not supported on Safari
// https://bugs.webkit.org/show_bug.cgi?id=227967
// import styles from './styles.css' with { type: 'css' }
// So we fallback to fetch + manual stylesheet creation for now
const cssText = await fetch('components/dual-range/styles.css').then(res => res.text())
const styles = new CSSStyleSheet()
styles.replaceSync(cssText)

class DualRangeInput extends HTMLElement {
  #minInput
  #maxInput
  #precision = 3

  constructor () {
    super()
    if (this.shadowRoot) {
      this.shadowRoot.adoptedStyleSheets = [styles]
    }
  }

  static get observedAttributes () {
    return ['min', 'max', 'step', 'precision', 'value-min', 'value-max']
  }

  get value () {
    return [
      parseFloat(this.#minInput.value),
      parseFloat(this.#maxInput.value)
    ]
  }

  set value (val) {
    if (!Array.isArray(val)) {
      return
    }

    const [newMin, newMax] = val

    if (!isNaN(newMin)) {
      this.#minInput.value = newMin
    }

    if (!isNaN(newMax)) {
      this.#maxInput.value = newMax
    }

    this.update()
  }

  connectedCallback () {
    this.#minInput = this.shadowRoot.getElementById('min')
    this.#maxInput = this.shadowRoot.getElementById('max')
    this.#setupListeners()
    this.#syncAttributes()
    this.update()
  }

  #setupListeners () {
    const events = ['input', 'focus', 'mousedown', 'touchstart']

    events.forEach(event => {
      this.#minInput.addEventListener(event, this.#updateCeil)
      this.#maxInput.addEventListener(event, this.#updateFloor)
    })
  }

  #syncAttributes () {
    this.#minInput.min = this.getAttribute('min') || 0
    this.#maxInput.max = this.getAttribute('max') || 100
    this.#minInput.step = this.getAttribute('step') || 1
    this.#maxInput.step = this.getAttribute('step') || 1
    this.#minInput.value = this.getAttribute('value-min') || 0
    this.#maxInput.value = this.getAttribute('value-max') || 100
    this.#precision = parseInt(this.getAttribute('precision') || '3')
  }

  attributeChangedCallback (name, oldValue, newValue) {
    if (oldValue === newValue || !this.#minInput) {
      return
    }
    this.#syncAttributes()
    this.update()
  }

  #updateFloor = () => this.update('floor')
  #updateCeil = () => this.update('ceil')

  update (method = 'ceil') {
    const thumbWidthVar = 'var(--range-thumb-width, 16px)'

    const min = parseFloat(this.#minInput.min)
    const max = parseFloat(this.#maxInput.max)
    const step = parseFloat(this.#minInput.step) || 1
    const minValue = parseFloat(this.#minInput.value)
    const maxValue = parseFloat(this.#maxInput.value)

    const midValue = (maxValue - minValue) / 2
    const mid = minValue + Math[method](midValue / step) * step

    const range = max - min

    const leftWidth = (((mid - min) / range) * 100).toFixed(this.#precision)
    const rightWidth = (((max - mid) / range) * 100).toFixed(this.#precision)

    this.#minInput.style.flexBasis = `calc(${leftWidth}% + ${thumbWidthVar})`
    this.#maxInput.style.flexBasis = `calc(${rightWidth}% + ${thumbWidthVar})`

    this.#minInput.max = mid.toFixed(this.#precision)
    this.#maxInput.min = mid.toFixed(this.#precision)

    const minFill = (minValue - min) / (mid - min) || 0
    const maxFill = (maxValue - mid) / (max - mid) || 0

    const minFillPercentage = (minFill * 100).toFixed(this.#precision)
    const maxFillPercentage = (maxFill * 100).toFixed(this.#precision)

    const minFillThumb = (0.5 - minFill).toFixed(this.#precision)
    const maxFillThumb = (0.5 - maxFill).toFixed(this.#precision)

    this.#minInput.style.setProperty(
      '--range-gradient-position',
      `calc(${minFillPercentage}% + (${minFillThumb} * ${thumbWidthVar}))`
    )
    this.#maxInput.style.setProperty(
      '--range-gradient-position',
      `calc(${maxFillPercentage}% + (${maxFillThumb} * ${thumbWidthVar}))`
    )

    this.dispatchEvent(new CustomEvent('change', {
      detail: [minValue, maxValue]
    }))
  }
}

customElements.define('dual-range-input', DualRangeInput)
