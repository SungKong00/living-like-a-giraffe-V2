import { registerGLTFExtension } from '@babylonjs/loaders/glTF/2.0/glTFLoaderExtensionRegistry.js'
import '@babylonjs/loaders/glTF/2.0/index.js'

// Character models mark the parts clay must not press (eyes, mouth, fittings)
// with a float vertex attribute `_CLAY_PROTECT` (0–1). Blender exports it
// from a `clay_protect` vertex group through scripts/clay-protect-attribute.py.
// Babylon's glTF loader skips custom attributes, so this loader extension
// reads it into the vertex kind below, where the clay layer and the clay
// motion shader find it.

export const CLAY_PROTECT_KIND = 'clayProtect'
const attribute = '_CLAY_PROTECT'
const name = 'riragi_clay_protect'

registerGLTFExtension(name, false, (loader) => ({
  name,
  enabled: true,
  dispose() {},
  _loadVertexDataAsync(context, primitive, babylonMesh) {
    const index = primitive.attributes?.[attribute]
    if (index === undefined) return null
    const accessor = loader.gltf.accessors[index]
    return Promise.all([
      loader._loadVertexDataAsync(context, primitive, babylonMesh),
      loader._loadFloatAccessorAsync('/accessors/' + index, accessor),
    ]).then(([geometry, data]) => {
      geometry.setVerticesData(CLAY_PROTECT_KIND, data, false, 1)
      return geometry
    })
  },
}))
