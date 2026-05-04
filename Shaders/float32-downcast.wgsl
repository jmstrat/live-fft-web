@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(src);

  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  let value = textureLoad(src, id.xy, 0);
  textureStore(dst, id.xy, value);
}
