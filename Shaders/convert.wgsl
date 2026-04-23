@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rg32float, write>;

const PI: f32 = 3.14159265359;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coords = gid.xy;
  let dims = textureDimensions(src);

  if (coords.x >= dims.x || coords.y >= dims.y) {
    return;
  }

  // Hamming Window
  let size = vec2f(dims);
  let pos = vec2f(coords);
  let window_x = 0.54 - 0.46 * cos(2.0 * PI * pos.x / (size.x - 1.0));
  let window_y = 0.54 - 0.46 * cos(2.0 * PI * pos.y / (size.y - 1.0));
  let weight = window_x * window_y;

  let colour = textureLoad(src, coords, 0);
  let gray = dot(colour.rgb, vec3f(0.299, 0.587, 0.114));
  let value = vec4f(gray * weight, 0.0, 0.0, 0.0);

  textureStore(dst, coords, value);
}
