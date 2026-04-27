@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var src_external: texture_external;

@group(0) @binding(2) var dst: texture_storage_2d<rg32float, write>;
@group(0) @binding(3) var<uniform> params : Params;

const PI: f32 = 3.14159265359;

struct Params {
  window_type: u32,
  flip_x: u32
};

fn hammingWindow(size: vec2f, pos: vec2f) -> f32 {
  let window_x = 0.54 - 0.46 * cos(2.0 * PI * pos.x / (size.x - 1.0));
  let window_y = 0.54 - 0.46 * cos(2.0 * PI * pos.y / (size.y - 1.0));
  return window_x * window_y;
}

fn hannWindow(size: vec2f, pos: vec2f) -> f32 {
  let window_x = 0.5 * (1.0 - cos(2.0 * PI * pos.x / (size.x - 1.0)));
  let window_y = 0.5 * (1.0 - cos(2.0 * PI * pos.y / (size.y - 1.0)));
  return window_x * window_y;
}

fn blackmanWindow(size: vec2f, pos: vec2f) -> f32 {
  let factor_x = 2.0 * PI * pos.x / (size.x - 1.0);
  let window_x = 0.42 - 0.5 * cos(factor_x) + 0.08 * cos(2.0 * factor_x);

  let factor_y = 2.0 * PI * pos.y / (size.y - 1.0);
  let window_y = 0.42 - 0.5 * cos(factor_y) + 0.08 * cos(2.0 * factor_y);

  return window_x * window_y;
}

fn gaussianWindow(size: vec2f, pos: vec2f) -> f32 {
  let sigma = (size - 1.0) / 6.0;

  let center = (size - 1.0) / 2.0;
  let n = pos - center;

  let window_x = exp(-0.5 * pow(n.x / sigma.x, 2.0));
  let window_y = exp(-0.5 * pow(n.y / sigma.y, 2.0));

  return window_x * window_y;
}

fn processPixel(colour: vec4f, coords: vec2u, dims: vec2u) {
  var out_coords = coords;
  var weight: f32;

  switch (params.window_type) {
    case 1u: { weight = hammingWindow(vec2f(dims), vec2f(coords)); }
    case 2u: { weight = hannWindow(vec2f(dims), vec2f(coords)); }
    case 3u: { weight = blackmanWindow(vec2f(dims), vec2f(coords)); }
    case 4u: { weight = gaussianWindow(vec2f(dims), vec2f(coords)); }
    default: { weight = 1.0; }
  }

  let gray = dot(colour.rgb, vec3f(0.299, 0.587, 0.114));
  let value = vec4f(gray * weight, 0.0, 0.0, 0.0);

  if (bool(params.flip_x)) {
    out_coords.x = (dims.x - 1u) - out_coords.x;
  }

  textureStore(dst, out_coords, value);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(src);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let colour = textureLoad(src, gid.xy, 0);
  processPixel(colour, gid.xy, dims);
}

@compute @workgroup_size(8, 8)
fn main_external(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dst_dims = vec2f(textureDimensions(dst));
  let src_dims = vec2f(textureDimensions(src_external));

  if (f32(gid.x) >= dst_dims.x || f32(gid.y) >= dst_dims.y) {
    return;
  }

  let crop_size = min(src_dims.x, src_dims.y);
  let offset = (src_dims - vec2f(crop_size)) / 2.0;
  let normalized_dst = vec2f(gid.xy) / dst_dims;
  let sampled_coords = offset + (normalized_dst * crop_size);
  let colour = textureLoad(src_external, vec2u(sampled_coords));

  processPixel(colour, gid.xy, vec2u(dst_dims));
}
