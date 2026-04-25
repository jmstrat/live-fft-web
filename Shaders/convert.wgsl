@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rg32float, write>;
@group(0) @binding(3) var<uniform> params : Params;

const PI: f32 = 3.14159265359;

struct Params {
  window_type: u32
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

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coords = gid.xy;
  let dims = textureDimensions(src);

  if (coords.x >= dims.x || coords.y >= dims.y) {
    return;
  }

  var weight: f32;
  switch (params.window_type) {
    case 1u: { weight = hammingWindow(vec2f(dims), vec2f(coords)); }
    case 2u: { weight = hannWindow(vec2f(dims), vec2f(coords)); }
    case 3u: { weight = blackmanWindow(vec2f(dims), vec2f(coords)); }
    case 4u: { weight = gaussianWindow(vec2f(dims), vec2f(coords)); }
    default: { weight = 1.0; }
  }

  let colour = textureLoad(src, coords, 0);
  let gray = dot(colour.rgb, vec3f(0.299, 0.587, 0.114));
  let value = vec4f(gray * weight, 0.0, 0.0, 0.0);

  textureStore(dst, coords, value);
}
