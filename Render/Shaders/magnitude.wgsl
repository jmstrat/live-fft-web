@group(0) @binding(0) var src : texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var dst : texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var magnitude_rgba : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var phase_rgba : texture_storage_2d<rgba8unorm, write>;

@group(0) @binding(4) var<uniform> params : Params;

// Colour mapping (magnitude)
// 0 = Greyscale
// 1 = Viridis
// 2 = Plasma
// 3 = Magma
// 4 = Inferno
// 5 = Cividis

// Colour mapping (phase)
// 0 = Greyscale
// 1 = Twilight
// 2 = Colorcet Phase 4
// 3 = Roma
// 4 = Rainbow

struct Params {
  magnitude_palette_index: u32,
  magnitude_scale: f32,
  calc_phase: u32,
  phase_palette_index: u32,
};

const PI: f32 = acos(-1.0);

// ---- Non Cyclic Colour Mapping ----

const VIRIDIS: array<vec3f, 7> = array<vec3f, 7>(
  vec3f(0.2777, 0.0054, 0.3341), vec3f(0.1051, 1.4046, 1.3846), vec3f(-0.3309, 0.2148, 0.0951),
  vec3f(-4.6342, -5.7991, -19.3324), vec3f(6.2283, 14.1799, 56.6906),
  vec3f(4.7764, -13.7451, -65.3530), vec3f(-5.4355, 4.6459, 26.3124)
);

const PLASMA: array<vec3f, 7> = array<vec3f, 7>(
  vec3f(0.0587, 0.0233, 0.5433), vec3f(2.1765, 0.2384, 0.7540), vec3f(-2.6895, -7.4559, 3.1108),
  vec3f(6.1303, 42.3462, -28.5189), vec3f(-11.1074, -82.6663, 60.1398),
  vec3f(10.0231, 71.4136, -54.0722), vec3f(-3.6587, -22.9315, 18.1919)
);

const MAGMA: array<vec3f, 7> = array<vec3f, 7>(
  vec3f(0.0014, 0.0004, 0.0048), vec3f(0.1415, 0.0998, 1.4503), vec3f(2.8400, -1.5404, -4.9546),
  vec3f(-10.100, 8.1565, 11.2335), vec3f(18.601, -16.356, -13.335),
  vec3f(-16.084, 14.184, 7.3686), vec3f(5.3113, -4.5348, -1.7745)
);

const INFERNO: array<vec3f, 7> = array<vec3f, 7>(
  vec3f(0.0001, 0.0001, 0.0013), vec3f(0.0903, 0.0454, 1.0505), vec3f(3.2005, -0.9103, -3.9502),
  vec3f(-12.450, 6.2505, 9.4506), vec3f(24.500, -14.450, -12.450),
  vec3f(-22.450, 13.450, 7.8504), vec3f(7.8501, -4.6502, -1.8503)
);

const CIVIDIS: array<vec3f, 7> = array<vec3f, 7>(
  vec3f(0.0031, 0.1352, 0.4497), vec3f(0.4079, 0.4447, 0.3804), vec3f(-1.0820, -0.1983, 0.1706),
  vec3f(3.4357, -0.0132, -0.6657), vec3f(-4.3013, 0.3015, 0.8122),
  vec3f(2.5574, -0.2227, -0.4285), vec3f(-0.5841, 0.0543, 0.0827)
);

fn get_mag_colour(t: f32) -> vec4f {
  let x = clamp(t, 0.0, 1.0);
  var coeffs: array<vec3f, 7>;

  // Select palette
  switch (params.magnitude_palette_index) {
    case 1u: { coeffs = VIRIDIS; }
    case 2u: { coeffs = PLASMA; }
    case 3u: { coeffs = MAGMA; }
    case 4u: { coeffs = INFERNO; }
    case 5u: { coeffs = CIVIDIS; }
    default: {
      return vec4f(vec3f(t), 1.0);
    }
  }

  let rgb = coeffs[0] + x *
    (coeffs[1] + x *
    (coeffs[2] + x *
    (coeffs[3] + x *
    (coeffs[4] + x *
    (coeffs[5] + x * coeffs[6])
    ))));

  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}

// ---- Cyclic colour mapping ----

// Cyclic Palette Coefficients (0°, 90°, 180°, 270°)
const TWILIGHT: array<vec3f, 4> = array<vec3f, 4>(
  vec3f(0.886, 0.855, 0.886),
  vec3f(0.361, 0.384, 0.898),
  vec3f(0.200, 0.149, 0.149),
  vec3f(0.910, 0.812, 0.710)
);

const COLORCET_C2: array<vec3f, 4>  = array<vec3f, 4>(
  vec3f(0.949, 0.949, 0.949),
  vec3f(0.333, 0.733, 1.000),
  vec3f(1.000, 0.867, 0.333),
  vec3f(0.949, 0.949, 0.949)
);

const CRAMERI_ROMA: array<vec3f, 4> = array<vec3f, 4>(
  vec3f(0.494, 0.188, 0.451),
  vec3f(0.239, 0.322, 0.533),
  vec3f(0.255, 0.549, 0.380),
  vec3f(0.745, 0.553, 0.259)
);

fn eval_palette(t: f32, p: array<vec3f, 4>) -> vec4f {
    let scaled_t = t * 4.0;
    let idx = u32(floor(scaled_t)) % 4u;
    let next_idx = (idx + 1u) % 4u;
    let f = fract(scaled_t);
    let rgb = mix(p[idx], p[next_idx], f);
    return vec4f(rgb, 1.0);
}

fn hsv2rgb(h: f32) -> vec4f {
  let s = 0.8; let v = 0.9;
  let c = v * s;
  let x = c * (1.0 - abs((h * 6.0) % 2.0 - 1.0));
  let m = v - c;
  var rgb: vec3f;
  if (h < 1.0/6.0) { rgb = vec3f(c, x, 0.0); }
  else if (h < 2.0/6.0) { rgb = vec3f(x, c, 0.0); }
  else if (h < 3.0/6.0) { rgb = vec3f(0.0, c, x); }
  else if (h < 4.0/6.0) { rgb = vec3f(0.0, x, c); }
  else if (h < 5.0/6.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  return vec4f(rgb + m, 1.0);
}

fn get_phase_colour(t: f32) -> vec4f {
  let val = fract(t);

  switch params.phase_palette_index {
    case 1u: { return eval_palette(val, TWILIGHT); }
    case 2u: { return eval_palette(val, COLORCET_C2); }
    case 3u: { return eval_palette(val, CRAMERI_ROMA); }
    case 4u: { return hsv2rgb(val); }
    default: {
      let g = 0.5 - 0.5 * cos(2 * PI * val);
      return vec4f(g, g, g, 1.0);
    }
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(src);
  let coords = gid.xy;

  if (coords.x >= dims.x || coords.y >= dims.y) {
    return;
  }

  // Shift coordinates to move the DC (0,0) to centre.
  let shifted = (coords + dims / 2u) % dims;
  let complex_val = textureLoad(src, shifted).rg;

  let centre = vec2f(dims) / 2.0;
  let dist = distance(vec2f(coords), centre);

  // ---- Magnitude ----
  // dst is used for the integration step
  let intensity = length(complex_val);
  let magnitude_log = log(1.0 + intensity) / log(10.0);
  textureStore(dst, coords, vec4f(magnitude_log, dist, 0.0, 0.0));

  // rgba is directly rendered (with an optional colour map)
  let normalized_val = clamp(magnitude_log * params.magnitude_scale, 0.0, 1.0);
  textureStore(magnitude_rgba, coords, get_mag_colour(normalized_val));

  if (params.calc_phase != 1u) {
    return;
  }

  // ---- Phase ----
  // This is only for rendering, we do not integrate the phase
  let phase_val = atan2(complex_val.g, complex_val.r);
  let normalized_phase = (phase_val / PI) * 0.5 + 0.5;
  textureStore(phase_rgba, coords, get_phase_colour(normalized_phase));
}

@compute @workgroup_size(8, 8)
fn shiftAndColouriseReal(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(src);
  let coords = gid.xy;

  if (coords.x >= dims.x || coords.y >= dims.y) {
    return;
  }

  let shifted = (coords + dims / 2u) % dims;
  let val = textureLoad(src, shifted).r;
  let val_log = log(1.0 + val) / log(10.0);

  let normalized_val = clamp(val_log * params.magnitude_scale, 0.0, 1.0);
  textureStore(magnitude_rgba, coords, get_mag_colour(normalized_val));
}
