@group(0) @binding(0) var tex_fft: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params : Params;

const PI: f32 = acos(-1.0);

struct Params {
  frequency_coords: vec2f
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) freq_val: vec2f,
  @location(1) @interpolate(flat) freq_pos: vec2f
};

fn complex_mul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let uv = vec2f(f32((vertexIndex << 1) & 2), f32(vertexIndex & 2));
  let pos = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);

  let dims = textureDimensions(tex_fft);
  let coords = vec2u(params.frequency_coords * vec2f(dims));
  let shifted = (coords + dims / 2u) % dims;
  let frequency_value = normalize(textureLoad(tex_fft, shifted, 0).xy);

  return VertexOutput(pos, frequency_value, vec2f(shifted) / vec2f(dims));
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let phase = 2.0 * PI * dot(in.position.xy, in.freq_pos);
  let basis = vec2f(cos(phase), sin(phase));
  let spatial_v = complex_mul(basis, in.freq_val);
  let signal = spatial_v.x * 0.5 + 0.5;
  return vec4f(signal, signal, signal, 1.0);
}
