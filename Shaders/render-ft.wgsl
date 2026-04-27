@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var tex_external: texture_external;
@group(0) @binding(2) var samp: sampler;

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

fn processColour(col: vec4f) -> vec4f {
  if (GREYSCALE) {
    return vec4f(vec3f(col.r), 1.0);
  }
  return col;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4f {
  let col = textureSample(tex, samp, in.uv);
  return processColour(col);
}

@fragment
fn fs_external(in: VertexOutput) -> @location(0) vec4f {
  let col = textureSampleBaseClampToEdge(tex_external, samp, in.uv);
  return processColour(col);
}
