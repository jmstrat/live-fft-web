@group(0) @binding(0) var input_tex : texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var output_tex : texture_storage_2d<rg32float, write>;

const RADIX: u32 = 2u;
const PI: f32 = acos(-1.0);

 // N must be a power of RADIX
override N: u32 = 1024u;
override WORKGROUP_SIZE: u32 = N / RADIX; // MUST BE N / RADIX
override INVERSE: bool = false;

const log2Radix = firstTrailingBit(RADIX);

var<workgroup> ping : array<vec2f, N>;
var<workgroup> pong : array<vec2f, N>;

fn complex_mul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn main(
  @builtin(workgroup_id) wg_id: vec3u,
  @builtin(local_invocation_id) local_id: vec3u
) {
  let row: u32  = wg_id.y;
  let t: u32 = local_id.x;

  // Initial Load: Each thread loads RADIX elements
  for (var i = 0u; i < RADIX; i++) {
    let idx = t + i * WORKGROUP_SIZE;
    ping[idx] = textureLoad(input_tex, vec2u(idx, row)).rg;
  }

  workgroupBarrier();

  let stages = (31u - countLeadingZeros(u32(N))) / log2Radix;
  let inv_sign = f32(select(-1.0, 1.0, INVERSE));

  // Local storage for butterfly results
  var results: array<vec2f, RADIX>;

  for (var s = 0u; s < stages; s++) {
    let block_size = 1u << s;
    let is_even = (s % 2u == 0u);

    let index_in_block = t % block_size;
    let block_id       = t / block_size;
    let read_base      = block_id * block_size + index_in_block;

    for (var j = 0u; j < RADIX; j++) { // Output index of the butterfly
      var sum = vec2f(0.0);
      for (var i = 0u; i < RADIX; i++) { // Input index of the butterfly
        // Each thread gathers values 'N / RADIX' apart
        let read_idx = read_base + i * WORKGROUP_SIZE;
        let val = select(pong[read_idx], ping[read_idx], is_even);

        let fraction = (f32(i) * f32(j) / f32(RADIX)) + (f32(i) * f32(index_in_block) / f32(block_size * RADIX));
        let angle = inv_sign * 2.0 * PI * fraction;

        let twiddle = vec2f(cos(angle), sin(angle));
        sum += complex_mul(val, twiddle);
      }
      results[j] = sum;
    }

    workgroupBarrier();

    let write_base = block_id * (block_size * RADIX) + index_in_block;

    for (var i = 0u; i < RADIX; i++) {
      let write_idx = write_base + i * block_size;
      if (is_even) {
        pong[write_idx] = results[i];
      } else {
        ping[write_idx] = results[i];
      }
    }

    workgroupBarrier();
  }

  // Store Transposed
  let last_in_ping = stages % 2u == 0u;
  let norm = select(1.0, 1.0 / f32(N), INVERSE);

  for (var i = 0u; i < RADIX; i++) {
    let idx = t + i * WORKGROUP_SIZE;
    var val = select(pong[idx], ping[idx], last_in_ping);
    textureStore(output_tex, vec2u(row, idx), vec4f(val * norm, 0.0, 0.0));
  }
}
