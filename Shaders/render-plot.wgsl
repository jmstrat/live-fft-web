@group(0) @binding(0) var<storage, read> profile : array<f32>;
@group(0) @binding(1) var<storage, read> global_max : u32;


const DC_SHIFT = 20.0;
const X_DECADES = 2;
const LOG_X = false;

const MAX_SCALE = 1000.0;

override SIZE: u32;

@vertex
fn vs_main(@builtin(vertex_index) idx : u32) -> @builtin(position) vec4f {
  if (idx <= u32(DC_SHIFT)) {
    return vec4f(0.0, 1.0, 999.0, 1.0);
  }

  let N = f32(SIZE);

  // [0...1]
  let x_norm = f32(idx) / (N - 1);
  var shift_clip = (DC_SHIFT / N) * 2.0;

  var source_pos: f32;
  if (LOG_X) {
    let log_scale = pow(10.0, X_DECADES * x_norm) / pow(10.0, X_DECADES);
    source_pos = log_scale * N;
    shift_clip /= log_scale;
  } else {
    source_pos = x_norm * N;
  }

  // Linear Interpolation
  let index_left = u32(floor(source_pos));
  let index_right = min(index_left + 1u, SIZE - 1u);
  let fract_part = source_pos - f32(index_left);

  let y_interp = mix(profile[index_left], profile[index_right], fract_part);

  // Map to clip space
  let x_clip = mix(-1.0 - shift_clip, 1.0, x_norm);

  let y_clip = (y_interp / (f32(global_max) / MAX_SCALE)) * 1.8 - 0.9;

  return vec4f(x_clip, y_clip, 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(1.0);
}
