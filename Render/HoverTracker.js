class GlobalPopoverStackManager {
  // { HTMLElement, zIndex }
  // Note that the map must be iterable, so it cannot be a weakmap
  static #openRegistry = new Map()

  static registerOpen (element, zIndex = 0) {
    const registry = this.#openRegistry

    if (registry.get(element) !== zIndex) {
      registry.set(element, zIndex)
      this.#resortStack()
    }
  }

  static registerClose (element) {
    this.#openRegistry.delete(element)
  }

  static #resortStack () {
    if (this.#openRegistry.size <= 1) {
      return
    }

    const sorted = Array.from(this.#openRegistry.entries())
      .sort((a, b) => a[1] - b[1])

    // Top layer elements are stacked by the browser
    // in the order they are displayed
    for (const [ el ] of sorted) {
      if (el.matches(':popover-open')) {
        el.hidePopover()
        el.showPopover()
      }
    }
  }
}

export class HoverTracker {
  #targets
  #hover
  #mouseX = 0
  #mouseY = 0
  #offset
  #isHovering = false
  #callback
  #active = false
  #applyTransform
  #zIndex

  constructor (
    mainEls,
    hoverEl,
    {
      callback,
      offset = { x: 0, y: 0 },
      active = true,
      zIndex = 0
    }
  ) {
    this.#targets = Array.isArray(mainEls) ? mainEls : [ mainEls ]

    this.#hover = hoverEl
    this.#offset = offset
    this.#callback = callback
    this.#zIndex = zIndex

    this.#applyTransform = (
      hoverEl.attributeStyleMap && window.CSSTranslate
    ) ? this.#applyTypedTransform : this.#applyStringTransform

    this.active = active
  }

  #addListeners () {
    for (const target of this.#targets) {
      target.addEventListener('mousemove', this.#handleMove)
      target.addEventListener('mouseenter', this.#handleEnter)
      target.addEventListener('mouseleave', this.#handleLeave)
    }

    this.#active = true
  }

  #removeListeners () {
    for (const target of this.#targets) {
      target.removeEventListener('mousemove', this.#handleMove)
      target.removeEventListener('mouseenter', this.#handleEnter)
      target.removeEventListener('mouseleave', this.#handleLeave)
    }
    this.#active = false
  }

  set active (bool) {
    if (this.#active && !bool) {
      this.#removeListeners()
    } else if (!this.#active && bool) {
      this.#addListeners()
    }
  }

  #emitCoords (e, currentTarget) {
    const rect = currentTarget.getBoundingClientRect()
    const horizontalPercent = (e.clientX - rect.left) / rect.width
    const verticalPercent = (e.clientY - rect.top) / rect.height

    const x = Math.floor(horizontalPercent * currentTarget.width)
    const y = Math.floor(verticalPercent * currentTarget.height)
    this.#callback?.(true, x, y, currentTarget)
  }

  #handleMove = (e) => {
    this.#emitCoords(e, e.currentTarget)
    this.#mouseX = e.pageX
    this.#mouseY = e.pageY
  }

  #handleEnter = (e) => {
    this.#isHovering = true
    this.#hover.showPopover()
    GlobalPopoverStackManager.registerOpen(this.#hover, this.#zIndex)

    this.#emitCoords(e, e.currentTarget)
    requestAnimationFrame(this.#updateHoverTransform)
  }

  #handleLeave = () => {
    this.#isHovering = false
    this.#hover.hidePopover()
    GlobalPopoverStackManager.registerClose(this.#hover)
    this.#callback?.(false)
  }

  #applyTypedTransform (x, y) {
    this.#hover.attributeStyleMap.set(
      'transform',
      new CSSTransformValue([
        new CSSTranslate(CSS.px(x), CSS.px(y))
      ])
    )
  }

  #applyStringTransform (x, y) {
    this.#hover.style.transform = `translate(${x}px, ${y}px)`
  }

  #updateHoverTransform = () => {
    if (!this.#isHovering) {
      return
    }
    const offset = this.#offset
    const offsetX = offset?.x ?? 0
    const offsetY = offset?.y ?? 0

    this.#applyTransform(this.#mouseX + offsetX, this.#mouseY + offsetY)

    requestAnimationFrame(this.#updateHoverTransform)
  }
}
