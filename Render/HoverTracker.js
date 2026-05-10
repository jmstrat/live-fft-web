export class HoverTracker {
  #main
  #hover
  #mouseX = 0
  #mouseY = 0
  #isHovering = false
  #callback
  #active = false
  #applyTransform

  constructor (mainEl, hoverEl, callback) {
    this.#main = mainEl
    this.#hover = hoverEl
    this.#callback = callback

    this.#applyTransform = (
      hoverEl.attributeStyleMap && window.CSSTranslate
    ) ? this.#applyTypedTransform : this.#applyStringTransform
  }

  #addListeners () {
    this.#main.addEventListener('mousemove', this.#handleMove)
    this.#main.addEventListener('mouseenter', this.#handleEnter)
    this.#main.addEventListener('mouseleave', this.#handleLeave)
    this.#active = true
  }

  #removeListeners () {
    this.#main.removeEventListener('mousemove', this.#handleMove)
    this.#main.removeEventListener('mouseenter', this.#handleEnter)
    this.#main.removeEventListener('mouseleave', this.#handleLeave)
    this.#active = false
  }

  set active (bool) {
    if (this.#active && !bool) {
      this.#removeListeners()
    } else if (!this.#active && bool) {
      this.#addListeners()
    }
  }

  #emitCoords (e) {
    const rect = this.#main.getBoundingClientRect()
    const horizontalPercent = (e.clientX - rect.left) / rect.width
    const verticalPercent = (e.clientY - rect.top) / rect.height

    const x = Math.floor(horizontalPercent * this.#main.width)
    const y = Math.floor(verticalPercent * this.#main.height)
    this.#callback?.(true, x, y)
  }

  #handleMove = (e) => {
    this.#emitCoords(e)
    this.#mouseX = e.pageX
    this.#mouseY = e.pageY
  }

  #handleEnter = (e) => {
    this.#isHovering = true
    this.#hover.showPopover()
    this.#emitCoords(e)
    requestAnimationFrame(this.#updateHoverTransform)
  }

  #handleLeave = () => {
    this.#isHovering = false
    this.#hover.hidePopover()
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
    this.#hover.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  #updateHoverTransform = () => {
    if (!this.#isHovering) {
      return
    }

    this.#applyTransform(this.#mouseX, this.#mouseY)

    requestAnimationFrame(this.#updateHoverTransform)
  }
}
