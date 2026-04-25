// This shader acts on the frequency-domain result of the boundary image.
// It divides by the eigenvalues of the discrete Laplacian. Based on:
// J Math Imaging Vis (2011) 39: 161–179
// DOI 10.1007/s10851-010-0227-1

@group(0) @binding(0) var v_hat: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var s_hat: texture_storage_2d<rg32float, write>;

const PI: f32 = 3.14159265359;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(v_hat);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  let v_hat = textureLoad(v_hat, id.xy).rg;

  let cos_u = cos(2.0 * PI * f32(id.x) / f32(dims.x));
  let cos_v = cos(2.0 * PI * f32(id.y) / f32(dims.y));
  let denom = 2.0 * cos_u + 2.0 * cos_v - 4.0;

  var value = vec2f(0.0);

  // DC component (0,0) is zeroed to satisfy mean(s)=0
  if (abs(denom) > 1e-6) {
    value = v_hat / denom;
  }

  textureStore(s_hat, id.xy, vec4f(value, 0.0, 1.0));
}
