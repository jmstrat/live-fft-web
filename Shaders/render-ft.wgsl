@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

override GREYSCALE: bool = false;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let uv = vec2f(f32((vertexIndex << 1) & 2), f32(vertexIndex & 2));
  let pos = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  return VertexOutput(pos, vec2f(uv.x, 1.0 - uv.y));
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let col = textureSample(tex, samp, in.uv);
  if (GREYSCALE) {
    return vec4f(col.r, col.r, col.r, 1.0);
  }
  return col;
}
