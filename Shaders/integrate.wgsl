@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> summed : array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> count : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> profile : array<f32>;
@group(0) @binding(4) var<storage, read_write> global_max : atomic<u32>;

const FLOAT_PRECISION_SCALE = 1000.0;
const DC_RADIUS = 5;

override NUM_BINS: u32;
override MAX_RADIUS: f32;

@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = gid.x;
  if (r >= NUM_BINS) {
    return;
  }

  atomicStore(&summed[r], 0);
  atomicStore(&count[r], 0);
  if (r == 0u) {
    atomicStore(&global_max, 0u);
  }
}

@compute @workgroup_size(8, 8)
fn sum(@builtin(global_invocation_id) gid: vec3<u32>) {
  let val = textureLoad(src, gid.xy, 0).xy;
  let radius = val.y;

  if (radius < f32(DC_RADIUS) || radius > MAX_RADIUS) {
    return;
  }

  let bin_f = (radius / MAX_RADIUS) * f32(NUM_BINS - 1u);
  let r_low = u32(floor(bin_f));
  let r_high = r_low + 1u;
  let weight_high = bin_f - f32(r_low);
  let weight_low = 1.0 - weight_high;

  if (r_low < NUM_BINS) {
    atomicAdd(&summed[r_low], u32(val.x * weight_low * FLOAT_PRECISION_SCALE));
    atomicAdd(&count[r_low], u32(weight_low * FLOAT_PRECISION_SCALE));
  }

  if (r_high < NUM_BINS) {
    atomicAdd(&summed[r_high], u32(val.x * weight_high * FLOAT_PRECISION_SCALE));
    atomicAdd(&count[r_high], u32(weight_high * FLOAT_PRECISION_SCALE));
  }
}

@compute @workgroup_size(64)
fn norm(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = gid.x;
  if (r >= NUM_BINS) {
    return;
  }

  let s = f32(atomicLoad(&summed[r]));
  let c = f32(atomicLoad(&count[r]));

  if (c > 0.0) {
    let avg = s / c;
    profile[r] = avg;
    atomicMax(&global_max, u32(avg * FLOAT_PRECISION_SCALE));
  } else {
    profile[r] = 0.0;
  }
}
