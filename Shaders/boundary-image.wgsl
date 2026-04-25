// This shader creates the "error" image, which captures intensity jumps
// at the boundaries. Based on:
// J Math Imaging Vis (2011) 39: 161–179
// DOI 10.1007/s10851-010-0227-1

// This is the first step in the Periodic Plus Smooth Image Decomposition:
// [0. Greyscale Conversion -> I]
// 1. Compute Boundary Image from I -> V
// 2. Forward FFT on V -> V-hat
// 3. Poisson Filter on V-hat -> S-hat
// 4. Inverse FFT on S-hat -> s.
// 5. Decomposition I - s -> p

@group(0) @binding(0) var src: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var dst: texture_storage_2d<rg32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
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
