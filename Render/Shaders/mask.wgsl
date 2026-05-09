@group(0) @binding(0) var src : texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var dst: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var<uniform> params : Params;

struct Params {
  window_type: u32,
  inner_radius: f32,
  outer_radius: f32
};

const PI: f32 = acos(-1.0);
const FEATHER: f32 = 0.25;

// Window edge functions
//   input  t in [0,1]
//   output in [0,1]

fn edgeLinear(t: f32) -> f32 {
  return clamp(t, 0.0, 1.0);
}

fn edgeHamming(t: f32) -> f32 {
  let x = clamp(t, 0.0, 1.0);
  return (0.54 - 0.46 * cos(PI * x)) - 0.08;
}

fn edgeHann(t: f32) -> f32 {
  let x = clamp(t, 0.0, 1.0);
  return 0.5 - 0.5 * cos(PI * x);
}

fn edgeBlackman(t: f32) -> f32 {
  let x = clamp(t, 0.0, 1.0);
  return 0.42 - 0.5 * cos(PI * x) + 0.08 * cos(2.0 * PI * x);
}

fn edgeGaussian(t: f32) -> f32 {
  let x = clamp(t, 0.0, 1.0);

  let sigma = 1.0 / 6.0;
  let n = x - 0.5;

  let g = exp(-0.5 * (n * n) / (sigma * sigma));
  let g0 = exp(-0.5 * (0.5 * 0.5) / (sigma * sigma));

  return clamp((g - g0) / (1.0 - g0), 0.0, 1.0);
}

fn edgeTransition(r: f32, edge: f32, width: f32) -> f32 {
  let halfWidth = width * 0.5;
  let t = (r - (edge - halfWidth)) / width;

  switch (params.window_type) {
    case 1u: { return edgeHamming(t); }
    case 2u: { return edgeHann(t); }
    case 3u: { return edgeBlackman(t); }
    case 4u: { return edgeGaussian(t); }
    default: { return edgeLinear(t); }
  }
}

fn annulusMask(r: f32) -> f32 {
  let i = clamp(params.inner_radius, 0.0, 1.0);
  let o = clamp(params.outer_radius, i, 1.0);

  let innerWidth = min(FEATHER, i * 2.0);
  let outerWidth = min(FEATHER, (1.0 - o) * 2.0);

  let innerRamp = edgeTransition(r, i, innerWidth);
  let outerRamp = 1.0 - edgeTransition(r, o, outerWidth);

  return innerRamp * outerRamp;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(src);
  let coord = gid.xy;

  if (coord.x >= dims.x || coord.y >= dims.y) {
    return;
  }

  let shifted = (coord + dims / 2u) % dims;
  let complexVal = textureLoad(src, shifted).rg;

  let centre = vec2f(dims) * 0.5;
  let delta = (vec2f(coord) + 0.5) - centre;

  let maxRadius = length(centre);
  let r = length(delta) / maxRadius;

  let mask = annulusMask(r);
  textureStore(dst, shifted, vec4f(complexVal * mask, 0.0, 1.0));
}
