import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'

// Fixed-room textures already contain the source view transform. Only live PBR
// surfaces pass through the scene's Blender-generated HDR-to-display table.
export function studioDisplay(scene, encoded, fields) {
  // One ambient cube per draw. Bilinear interpolation follows the live mesh,
  // including drags between commits; six signed axes preserve light direction.
  const samples = new WeakMap()
  function irradiance(mesh) {
    let room = mesh
    while (room && !room.metadata?.gltf?.extras?.roomId) room = room.parent
    const field = fields[room?.metadata?.gltf?.extras?.roomId]
    if (!field) return null
    const center = mesh.getBoundingInfo().boundingBox.centerWorld
    const grid = (n, axis) =>
      Math.max(
        0,
        Math.min(
          field.size - 1,
          ((n - field.min[axis]) /
            Math.max(0.001, field.max[axis] - field.min[axis])) *
            (field.size - 1),
        ),
      )
    const x = grid(center.x, 0),
      z = grid(center.z, 1)
    let cached = samples.get(mesh)
    if (cached?.field === field && cached.x === x && cached.z === z)
      return cached.value
    const value = cached?.value ?? new Float32Array(18)
    value.fill(0)
    const left = Math.floor(x),
      top = Math.floor(z)
    for (let dz = 0; dz < 2; dz++)
      for (let dx = 0; dx < 2; dx++) {
        const weight =
          (dx ? x - left : 1 - x + left) * (dz ? z - top : 1 - z + top)
        const index =
          18 *
          (Math.min(top + dz, field.size - 1) * field.size +
            Math.min(left + dx, field.size - 1))
        for (let j = 0; j < 18; j++)
          value[j] += weight * field.samples[index + j]
      }
    samples.set(mesh, { field, x, z, value })
    return value
  }
  const lut = new Texture(
    'data:image/png;base64,' + encoded,
    scene,
    true,
    true,
    Texture.BILINEAR_SAMPLINGMODE,
  )
  lut.wrapU = lut.wrapV = Texture.CLAMP_ADDRESSMODE
  class BlenderDisplay extends MaterialPluginBase {
    constructor(material) {
      super(material, 'BlenderDisplay', 200, {}, true)
      this.registerForExtraEvents = true
      this._enable(true)
    }
    isReadyForSubMesh() {
      return lut.isReady()
    }
    getUniforms() {
      return { externalUniforms: ['studioIrradiance'] }
    }
    hardBindForSubMesh(_buffer, _scene, _engine, subMesh) {
      const values = irradiance(subMesh.getRenderingMesh())
      if (values) subMesh.effect.setArray3('studioIrradiance', values)
    }
    getSamplers(samplers) {
      samplers.push('studioDisplaySampler')
    }
    bindForSubMesh(_buffer, _scene, _engine, subMesh) {
      subMesh.effect.setTexture('studioDisplaySampler', lut)
    }
    getCustomCode(stage) {
      if (stage !== 'fragment') return null
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `
          uniform sampler2D studioDisplaySampler;
          uniform vec3 studioIrradiance[6];
          vec3 studioDisplayRGB(vec3 linearRGB) {
            vec3 uvw = clamp(log2(1.0 + 16.0 * max(linearRGB, vec3(0.0))) / 10.0, 0.0, 1.0) * 31.0;
            vec2 uv = vec2((32.0 * floor(uvw.b) + uvw.r + 0.5) / 1024.0, (uvw.g + 0.5) / 32.0);
            vec2 next = uv + vec2(step(floor(uvw.b), 30.0) / 32.0, 0.0);
            return mix(texture2D(studioDisplaySampler, uv).rgb, texture2D(studioDisplaySampler, next).rgb, fract(uvw.b));
          }`,
        CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
          vec3 weights = normalW * normalW;
          finalDiffuse += surfaceAlbedo * (
            weights.x * (normalW.x > 0.0 ? studioIrradiance[0] : studioIrradiance[1]) +
            weights.y * (normalW.y > 0.0 ? studioIrradiance[2] : studioIrradiance[3]) +
            weights.z * (normalW.z > 0.0 ? studioIrradiance[4] : studioIrradiance[5]));
        `,
        CUSTOM_FRAGMENT_BEFORE_FOG:
          'finalColor.rgb = toLinearSpace(studioDisplayRGB(finalColor.rgb));',
      }
    }
  }
  return (material) => new BlenderDisplay(material)
}
