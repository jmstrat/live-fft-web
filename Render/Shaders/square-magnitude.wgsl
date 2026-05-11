@group(0) @binding(0) var src : texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var dst : texture_storage_2d<rg32float, write>;

@compute @workgroup_size(8, 8)
fn magSquare(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(src);
  let coords = gid.xy;

  if (coords.x >= dims.x || coords.y >= dims.y) {
    return;
  }

  let complex_val = textureLoad(src, coords).rg;
  let intensity = length(complex_val);

  textureStore(dst, coords, vec4f(pow(intensity, 2), 0.0, 0.0, 0.0));
}
