// This file implements the non-Fourier transform steps of the Periodic Plus Smooth Image Decomposition, based on:
// J Math Imaging Vis (2011) 39: 161–179
// DOI 10.1007/s10851-010-0227-1

// Steps in [square brackets] are not handled by this file
// [0. Greyscale Conversion -> I]
// 1. Compute Boundary Image from I -> V
// 2. [Forward FFT on V -> V-hat]
// 3. Poisson Filter on V-hat -> S-hat
// 4. [Inverse FFT on S-hat -> s.]
// 5. Decomposition I - s -> p

@group(0) @binding(0) var src: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var dst: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var original: texture_storage_2d<rg32float, read>;

const PI: f32 = acos(-1.0);

// This shader creates the "error" image, which captures intensity jumps
// at the boundaries.
@compute @workgroup_size(8, 8)
fn boundaryImage(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(src);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  var v = 0.0;
  // Boundary discontinuities
  if (id.x == 0u) {
    v += textureLoad(src, vec2u(dims.x - 1u, id.y)).r - textureLoad(src, id.xy).r;
  } else if (id.x == dims.x - 1u) {
    v += textureLoad(src, vec2u(0u, id.y)).r - textureLoad(src, id.xy).r;
  }

  if (id.y == 0u) {
    v += textureLoad(src, vec2u(id.x, dims.y - 1u)).r - textureLoad(src, id.xy).r;
  } else if (id.y == dims.y - 1u) {
    v += textureLoad(src, vec2u(id.x, 0u)).r - textureLoad(src, id.xy).r;
  }

  textureStore(dst, id.xy, vec4f(v, 0.0, 0.0, 1.0));
}

// This shader acts on the frequency-domain result of the boundary image.
// It divides by the eigenvalues of the discrete Laplacian.
@compute @workgroup_size(8, 8)
fn poisson(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(src);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  if (id.x == 0u && id.y == 0u) {
    textureStore(dst, id.xy, vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let sin_u = sin(PI * f32(id.x) / f32(dims.x));
  let sin_v = sin(PI * f32(id.y) / f32(dims.y));
  let denom = -4.0 * (sin_u * sin_u + sin_v * sin_v);

  var value = vec2f(0.0);

  if (abs(denom) > 1e-6) {
    value = textureLoad(src, id.xy).rg / denom;
  }

  textureStore(dst, id.xy, vec4f(value, 0.0, 1.0));
}

// Subtracts the spatial smooth component s (the IFFT of s-hat) from the original image
@compute @workgroup_size(8, 8)
fn decompose(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(original);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  let i = textureLoad(original, id.xy).r;
  let s = textureLoad(src, id.xy).r;

  textureStore(dst, id.xy, vec4f(i - s, 0.0, 0.0, 1.0));
}
