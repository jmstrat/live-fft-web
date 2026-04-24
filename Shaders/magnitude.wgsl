@group(0) @binding(0) var src : texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var dst : texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var rgba : texture_storage_2d<rgba8unorm, write>;

@group(0) @binding(3) var<uniform> params : Params;

// Colour mapping
// 0=Greyscale
// 1=Viridis
// 2=Plasma
// 3=Magma
// 4=Inferno
// 5=Cividis
struct Params {
  palette_index: u32,
  magnitude_scale: f32
};

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

fn get_color(t: f32) -> vec4f {
    let x = clamp(t, 0.0, 1.0);
    var coeffs: array<vec3f, 7>;

    // Select palette
    switch (params.palette_index) {
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

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dims = textureDimensions(src);
  let coords = gid.xy;

  if (coords.x >= dims.x || coords.y >= dims.y) {
    return;
  }

  // Shift coordinates to move the DC (0,0) to centre.
  let shifted = (coords + dims / 2u) % dims;
  let complex_val = textureLoad(src, shifted).rg;

  let intensity = length(complex_val);
  let magnitude_log = log(1.0 + intensity) / log(10.0);

  let centre = vec2f(dims) / 2.0;
  let dist = distance(vec2f(coords), centre);

  // dst is used for the integration step
  textureStore(dst, coords, vec4f(magnitude_log, dist, 0.0, 0.0));

  // Normalise the log values to 0.0 - 1.0
  let normalized_val = clamp(magnitude_log * params.magnitude_scale, 0.0, 1.0);

  // rgba is directly rendered (with an optional colour map)
  textureStore(rgba, coords, get_color(normalized_val));
}
