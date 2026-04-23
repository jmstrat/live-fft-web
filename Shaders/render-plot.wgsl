@group(0) @binding(0) var<storage, read> profile : array<f32>;
@group(0) @binding(1) var<storage, read> global_max : u32;


const X_DECADES = 2;
const DC_RADIUS = 5;
const LOG_X = false;

@vertex
fn vs_main(@builtin(vertex_index) idx : u32) -> @builtin(position) vec4f {
  let N = arrayLength(&profile);
  let i = idx + DC_RADIUS;

  if (i >= N) {
    return vec4f(-1.0);
  }

  var x = f32(i) / f32(N - 1u);   // [0,1]

  if (LOG_X) {
    x = 1 / pow(10, X_DECADES) * pow(10, X_DECADES*x);
  }

  let y = profile[i];

  // map to clip space
  let x_clip = x * 2.0 - 1.0;
  let y_clip = (y / f32(global_max)) * 1.8 - 0.9;

  return vec4f(x_clip, y_clip, 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(1.0);
}
