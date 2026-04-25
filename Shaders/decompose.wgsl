// Subtracts the spatial smooth component s (the IFFT of s-hat) from the original image
// to get the periodic component. Based on:
// J Math Imaging Vis (2011) 39: 161–179
// DOI 10.1007/s10851-010-0227-1

@group(0) @binding(0) var src: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var s_spatial: texture_storage_2d<rg32float, read>;
@group(0) @binding(2) var periodic: texture_storage_2d<rg32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(src);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }

  let i = textureLoad(src, id.xy).r;
  let s = textureLoad(s_spatial, id.xy).r;

  textureStore(periodic, id.xy, vec4f(i - s, 0.0, 0.0, 1.0));
}
