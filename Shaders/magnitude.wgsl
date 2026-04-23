@group(0) @binding(0) var src : texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var dst : texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var rgba : texture_storage_2d<rgba8unorm, write>;

const MAGNITUDE_SCALE = 0.25;

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
  let normalized_val = clamp(magnitude_log * MAGNITUDE_SCALE, 0.0, 1.0);

  // rgba is directly rendered
  textureStore(rgba, coords, vec4f(vec3f(normalized_val), 1.0));
}
