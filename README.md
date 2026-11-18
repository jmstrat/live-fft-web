# Live 2D Fourier Transform

Click [here](https://jmstrat.github.io/live-fft-web/) to open the web page in your browser.

This static web page generates a 2D Fourier transform of live images from a camera feed or simple example images.
The calculations are performed on the GPU using [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
which requires a recent [browser](https://caniuse.com/webgpu), GPU and operating system.

The idea is based on a tool used by [Brian Pauw](https://lookingatnothing.com/) to teach scattering and diffraction effects.

## Development

This project is written using pure vanilla web technologies. No dependencies, no build tools, as a fun look into the current state of vanilla web dev. You can serve the root directory with any static web server and simply load the index file to run the application.
