import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import { CLAY_PROTECT_KIND } from './clay-protect-loader.js'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'

import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { claySurfaceSettings } from '../shared/clay-motion.mjs'
import { screenWobble } from './legacy-wobble.js'
import reliefURL from './clay-relief.png?url'

// Static hatching uses the original tile. Animated dents use a volumetric field.
class ClayBoil extends MaterialPluginBase {
  constructor(material, motion, masks) {
    super(material, 'RiragiClayBoil', 210, {
      RIRAGI_CLAY_RELIEF: false,
      RIRAGI_CLAY_HATCH: false,
      RIRAGI_CLAY_PROTECT: false,
    })
    this.motion = motion
    this.masks = masks
    this.doNotSerialize = true
    this.registerForExtraEvents = true
    this._enable(true)
    this.markAllDefinesAsDirty()
  }
  getClassName() {
    return 'RiragiClayBoil'
  }
  prepareDefines(defines, _scene, mesh) {
    defines.RIRAGI_CLAY_HATCH = this.motion.hatch > 0
    defines.RIRAGI_CLAY_RELIEF =
      this.motion.surface > 0 || this.motion.hatch > 0
    // Vertices a character model marked keep their modelled surface.
    defines.RIRAGI_CLAY_PROTECT =
      defines.RIRAGI_CLAY_RELIEF &&
      !!mesh?.isVerticesDataPresent?.(CLAY_PROTECT_KIND)
  }
  getAttributes(attributes, _scene, mesh) {
    if (mesh?.isVerticesDataPresent?.(CLAY_PROTECT_KIND))
      attributes.push(CLAY_PROTECT_KIND)
  }
  isReadyForSubMesh() {
    return !this.motion.hatch || this.motion.tile.isReady()
  }
  getUniforms() {
    return { externalUniforms: ['clayBoil', 'clayRestSpace'] }
  }
  hardBindForSubMesh(_buffer, _scene, _engine, subMesh) {
    const restSpace = this.masks.get(subMesh.getRenderingMesh())
    const effect = subMesh.effect
    const { surface, hatch, phase, tile } = this.motion
    const strength = restSpace ? 0.55 : restSpace === null ? 1 : 0
    effect.setFloat4(
      'clayBoil',
      strength * surface,
      strength * hatch,
      phase,
      restSpace ? 1 : 0,
    )
    if (restSpace) effect.setMatrix('clayRestSpace', restSpace)
    if (hatch) effect.setTexture('claySlopes', tile)
  }
  getSamplers(samplers) {
    samplers.push('claySlopes')
  }
  getCustomCode(stage) {
    const enabled = (source) =>
      '\n#ifdef RIRAGI_CLAY_RELIEF\n' + source + '\n#endif\n'
    const varying = 'varying vec4 vClayPoint;'
    if (stage === 'vertex')
      return {
        CUSTOM_VERTEX_DEFINITIONS: enabled(
          varying + '\nuniform vec4 clayBoil;\nuniform mat4 clayRestSpace;',
        ),
        CUSTOM_VERTEX_UPDATE_WORLDPOS: enabled(`
        vec3 clayP = worldPos.xyz;
        #if NUM_BONE_INFLUENCERS > 0
          clayP = position;
        #endif
        vClayPoint = vec4(clayP, 1.0);
        if (clayBoil.w > 0.0) {
          vec3 rest = (clayRestSpace * vec4(position, 1.0)).xyz;
          vClayPoint = vec4(rest * 5.5, 1.0 - smoothstep(.66,.815,rest.y));
        }
      `),
      }
    const color =
      this._material.getClassName() === 'StandardMaterial'
        ? 'color'
        : 'finalColor'
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: enabled(
        varying +
          `
        uniform sampler2D claySlopes;
        uniform vec4 clayBoil;

        // Analytic gradient of smooth 3D value noise. Rounded patches cross
        // UV seams and cover differently oriented walls without parallel bands.
        float clayHash(vec3 p) {
          p = fract(p * vec3(.1031,.11369,.13787));
          p += dot(p, p.yxz + 19.19);
          return fract((p.x+p.y)*p.z);
        }
        vec3 pressGradient(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          vec3 u = f*f*(3.0-2.0*f);
          float a = clayHash(i), b = clayHash(i+vec3(1,0,0));
          float c = clayHash(i+vec3(0,1,0)), d = clayHash(i+vec3(1,1,0));
          float e = clayHash(i+vec3(0,0,1)), g = clayHash(i+vec3(1,0,1));
          float h = clayHash(i+vec3(0,1,1)), j = clayHash(i+vec3(1,1,1));
          return 6.0*f*(1.0-f)*vec3(
            mix(mix(b-a,d-c,u.y),mix(g-e,j-h,u.y),u.z),
            mix(mix(c-a,d-b,u.x),mix(h-e,j-g,u.x),u.z),
            mix(mix(e-a,g-b,u.x),mix(h-c,j-d,u.x),u.y));
        }
      `,
      ),
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: enabled(`
        float clayShade = 1.0;
        if (max(clayBoil.x, clayBoil.y) > 0.0) {
          vec3 p = vClayPoint.xyz;
          vec3 gradient = vec3(0.0);
          #ifdef RIRAGI_CLAY_HATCH
          if (clayBoil.y > 0.0) {
            vec2 uv = vec2(dot(p,vec3(.46,.09,.35)),dot(p,vec3(-.20,.52,.26)));
            vec4 tile = texture2D(claySlopes, uv);
            vec2 slope = (tile.rg + tile.ba - 1.0) * clayBoil.y;
            gradient = slope.x * vec3(.79,.15,.60) + slope.y * vec3(-.32,.85,.42);
          }
          #endif
          if (clayBoil.x > 0.0) {
            float t = clayBoil.z;
            vec3 drift = sin(vec3(t, t*1.5, t*2.5) + p.zxy*1.7);
            vec3 dents = pressGradient(p*2.7 + .52*drift);
            vec3 ridges = pressGradient(p*6.1 - .63*drift + vec3(8.4,3.1,2.2));
            gradient += clayBoil.x * (.90*dents + .32*ridges);
          }
          gradient *= vClayPoint.w;
          vec3 tangent = gradient - normalW * dot(normalW, gradient);
          normalW = normalize(normalW - .48 * tangent);
          // Baked rooms have the light in their colour map. Give their relief
          // a light/dark pair even where live lights do not reach the material.
          clayShade += .30 * dot(tangent, vec3(-.48,.76,-.43));
        }
      `),
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: enabled(color + '.rgb *= clayShade;'),
    }
  }
}

export function clayMotion(scene, camera) {
  const clock = {
    surface: 0,
    hatch: 0,
    screen: 0,
    frame: 0,
    phase: 0,
    tile: null,
  }
  const masks = new WeakMap()
  const materials = new WeakSet()
  let tick = -1
  let installed = false
  let screenPass = null

  function attach(material) {
    if (!material || materials.has(material)) return
    materials.add(material)
    if (material.subMaterials) material.subMaterials.forEach(attach)
    else new ClayBoil(material, clock, masks)
  }
  function watchMaterial(mesh) {
    attach(mesh.material)
    mesh.onMaterialChangedObservable.add(() => attach(mesh.material))
  }
  function include(mesh, restSpace = null) {
    mesh = mesh.sourceMesh ?? mesh
    if (!mesh.getTotalVertices() || masks.has(mesh)) return
    masks.set(mesh, restSpace)
    if (installed) watchMaterial(mesh)
  }

  return {
    include,
    get surfaceFrame() {
      return clock.surface ? clock.frame : -1
    },
    // Called at import/spawn before the rig plays or its placement changes.
    // Each part can have its own local axes, including bone-parented wearables.
    includeGiraffe(meshes) {
      if (!meshes.length) return
      const min = new Vector3(Infinity, Infinity, Infinity)
      const max = min.scale(-1)
      for (const mesh of meshes) {
        mesh.computeWorldMatrix(true)
        const box = mesh.getBoundingInfo().boundingBox
        min.minimizeInPlace(box.minimumWorld)
        max.maximizeInPlace(box.maximumWorld)
      }
      const height = max.y - min.y
      if (height <= 0) return
      const toRest = Matrix.Translation(-min.x, -min.y, -min.z).multiply(
        Matrix.Scaling(1 / height, 1 / height, 1 / height),
      )
      for (const mesh of meshes) {
        include(mesh, mesh.getWorldMatrix().multiply(toRest))
      }
    },
    set(settings) {
      const value = claySurfaceSettings(settings)
      const hadHatch = clock.hatch > 0
      const wasActive = !!(clock.surface || clock.hatch)
      const amount = value.enabled ? value.strength / 100 : 0
      clock.surface = value.style === 'surface' ? amount : 0
      clock.screen = value.style === 'screen' ? amount : 0
      clock.hatch = (value.hatch ?? 0) / 100
      if (clock.screen && !screenPass) screenPass = screenWobble(camera, clock)
      if (!clock.screen && screenPass) {
        screenPass.dispose(camera)
        screenPass = null
      }
      if (!amount) tick = -1
      if (clock.hatch && !clock.tile) {
        clock.tile = new Texture(
          reliefURL,
          scene,
          false,
          false,
          Texture.TRILINEAR_SAMPLINGMODE,
        )
        clock.tile.gammaSpace = false
      }
      const active = !!(clock.surface || clock.hatch)
      if (active && !installed) {
        installed = true
        for (const mesh of scene.meshes)
          if (masks.has(mesh)) watchMaterial(mesh)
      } else if (wasActive !== active || hadHatch !== clock.hatch > 0) {
        for (const material of scene.materials)
          material.pluginManager
            ?.getPlugin('RiragiClayBoil')
            ?.markAllDefinesAsDirty()
      }
    },
    advance(now) {
      if (!clock.surface && !clock.screen) return false
      const next = Math.floor(now / 200)
      if (next === tick) return false
      tick = next
      clock.frame = next % 4096
      clock.phase = (next % 64) * (Math.PI / 16)
      return true
    },
  }
}
