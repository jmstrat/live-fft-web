import { Camera } from "./Sources/Camera/adapter.js"
import { FFTWebGPU } from "./Render/WebGPU.js"

const elements = {
  overlay: document.getElementById('error-overlay'),
  title: document.getElementById('error-title'),
  message: document.getElementById('error-message'),
  code: document.getElementById('error-code')
}

export function showError (err) {
  console.error(err)
  let title = "Application Error"
  let message = "An unexpected error occurred."
  let code
  let modal = true

  switch (err.code || err.name) {
    case FFTWebGPU.errorCodes.Unavailable:
      title = "Browser Update Required"
      message = "Your browser doesn't support WebGPU. Try updating to a newer version."
      break
    case FFTWebGPU.errorCodes.AdapterMissing:
      title = "Graphics Card Issue"
      message = "We couldn't find a compatible graphics card. Make sure your drivers are up to date."
      break
    case FFTWebGPU.errorCodes.LimitsUnsupported:
      title = "Hardware Unsupported"
      message = "Your GPU may not be powerful enough to run at this resolution."
      break
    case Camera.errorCodes.PermissionDenied:
    case Camera.errorCodes.PermissionRevoked:
      title = 'Camera Permission Denied'
      message = "If you wish to use the live camera input, you must enable the camera permission in your browser and OS settings. You can use the other input modes without granting camera permission."
      modal = false
      break
    case Camera.errorCodes.Generic:
      title = 'Camera Error'
      message = 'The camera could not be started, please try another camera or a different input mode.'
      code = err.message
      modal = false
      break
    case Camera.errorCodes.Stopped:
      title = 'Camera Error'
      message = "The camera unexpectedly stopped."
      modal = false
      break
    case Camera.errorCodes.Disconnected:
      title = 'Camera Disconnected'
      message = "The selected camera is no-longer available. Please reconnect the device or choose an alternative camera or input mode."
      modal = false
      break
    default:
      message = `${message}\n${err.message || err.name}.`
      code = err.code
  }
  _showError(title, message, code, modal)
}

function _showError (title, message, code = "", modal=true) {
  elements.title.textContent = title
  elements.message.textContent = message

  if (code) {
    elements.code.textContent = code
    elements.code.classList.remove('hidden')
  } else {
    elements.code.classList.add('hidden')
  }

  elements.overlay.classList.toggle('modal', modal)
  elements.overlay.classList.remove('hidden')
}

export function hideError () {
  elements.overlay.classList.add('hidden')
}
