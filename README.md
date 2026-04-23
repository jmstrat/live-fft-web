# Live 2D Fourier Transform

Click [here](https://jmstrat.github.io/live-fft-web/) to open the web page in your browser.

This static web page generates a 2D Fourier transform of live images from a camera feed or simple example images.
The calculations are performed on the GPU using [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
which requires a recent [browser](https://caniuse.com/webgpu), GPU and operating system.

The idea is based on a tool used by [Brian Pauw](https://lookingatnothing.com/) to teach scattering and diffraction effects.
