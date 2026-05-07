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
    case 'WEBGPU_MISSING':
      title = "Browser Update Required"
      message = "Your browser doesn't support WebGPU. Try updating to a newer version."
      break
    case 'WEBGPU_ADAPTER_MISSING':
      title = "Graphics Card Issue"
      message = "We couldn't find a compatible graphics card. Make sure your drivers are up to date."
      break
    case 'LIMITS_UNSUPPORTED':
      title = "Hardware Unsupported"
      message = "Your GPU may not be powerful enough to run at this resolution."
      break
    case 'OverconstrainedError':
      title = "Camera Error"
      message = "Unable to capture images from your camera at the required resolution."
      modal = false
      break
    case 'CAMERA_DENIED':
    case 'CAMERA_REVOKED':
      title = 'Camera Permission Denied'
      message = "If you wish to use the live camera input, you must enable the camera permission in your browser and OS settings. You can use the other input modes without granting camera permission."
      modal = false
      break
    case 'CAMERA_ERROR':
      title = 'Camera Error'
      message = 'The camera could not be started, please try another camera or a different input mode.'
      code = err.message
      modal = false
      break
    case 'CAMERA_STOPPED':
      title = 'Camera Error'
      message = "The camera unexpectedly stopped."
      modal = false
      break
    case 'CAMERA_DISCONNECTED':
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
