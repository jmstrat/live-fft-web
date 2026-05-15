@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var tex_external: texture_external;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> params: Params;

// For the crop entry points
struct Params {
  centre: vec2i
}

override GREYSCALE: bool = false;

override TARGET_CENTRE: i32 = 3; // In source pixels
override TARGET_ZOOM: f32 = 3;

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
  let col = textureLoad(tex, vec2i(in.position.xy), 0);
  return processColour(col);
}

@fragment
fn fs_external(in: VertexOutput) -> @location(0) vec4f {
  let col = textureSampleBaseClampToEdge(tex_external, samp, in.uv);
  return processColour(col);
}

fn get_crop_coords (xy: vec2f) -> vec2u {
  let offset = vec2i(floor(xy / TARGET_ZOOM));
  let offset_from_center = offset - TARGET_CENTRE;
  return vec2u(params.centre + offset_from_center);
}

@fragment
fn fs_crop(in: VertexOutput) -> @location(0) vec4f {
  let source_pixel = get_crop_coords(in.position.xy - 0.5);

  let tex_size = textureDimensions(tex);
  if (any(source_pixel < vec2u(0)) || any(source_pixel >= tex_size)) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }

  let col = textureLoad(tex, source_pixel, 0);
  return processColour(col);
}

@fragment
fn fs_external_crop(in: VertexOutput) -> @location(0) vec4f {
  let source_pixel = get_crop_coords(in.position.xy - 0.5);

  let tex_size = textureDimensions(tex_external);
  if (any(source_pixel < vec2u(0)) || any(source_pixel >= tex_size)) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }

  let source_uv = (vec2f(source_pixel) + 0.5) / vec2f(tex_size);

  let col = textureSampleBaseClampToEdge(tex_external, samp, source_uv);
  return processColour(col);
}
