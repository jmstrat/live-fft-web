@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> summed : array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> count : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> profile : array<f32>;
@group(0) @binding(4) var<storage, read_write> global_max : atomic<u32>;

const FLOAT_PRECISION_SCALE = 10000.0;
const DC_RADIUS = 5;

@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = gid.x;
  if (r > arrayLength(&profile) - 1) {
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

  let mag_i = u32(val.x * FLOAT_PRECISION_SCALE);
  let r = u32(floor(val.y));

  if (r < DC_RADIUS || r > arrayLength(&profile) - 1) {
    return;
  }

  atomicAdd(&summed[r], mag_i);
  atomicAdd(&count[r], 1u);
}

@compute @workgroup_size(64)
fn norm(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = gid.x;
  if (r < DC_RADIUS || r > arrayLength(&profile) - 1) {
    return;
  }

  let s = atomicLoad(&summed[r]);
  let c = atomicLoad(&count[r]);

  if (c > 0u) {
    let avg_i = s / c;
    profile[r] = f32(avg_i);
    atomicMax(&global_max, avg_i);
  } else {
    profile[r] = 0.0;
  }
}
