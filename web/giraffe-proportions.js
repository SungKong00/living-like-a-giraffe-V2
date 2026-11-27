import { giraffeDimensions } from '../shared/giraffe-proportions.mjs'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js'

// glTF animation writes local TRS on the nodes linked to the skin. Restore
// the sampled pose before the next animation tick, then apply the proportions
// to the new sample, so authored clips and rigid socket children follow it.
const limbChains = (pair) =>
  ['L', 'R'].map((side) =>
    ['Upper', 'Lower', 'Hoof'].map((joint) => pair + '.' + joint + '.' + side),
  )
const neck = ['Neck.02', 'Neck.03', 'Head']
export function giraffeProportions(scene, nodes) {
  const biped = nodes.has('Arm.Upper.L') && nodes.has('Arm.Upper.R')
  const legs = biped ? limbChains('Hind') : ['Fore', 'Hind'].flatMap(limbChains)
  const required = ['Pelvis', 'Neck.01', 'Tail.01', ...neck, ...legs.flat()]
  if (!required.every((name) => nodes.has(name))) return null
  const pelvis = nodes.get('Pelvis')
  const restHipHeight = pelvis.position.y
  const rig = pelvis.parent?.computeWorldMatrix(true) ?? Matrix.Identity()
  const worldToRig = Matrix.Invert(rig)
  const rigPosition = (name) =>
    Vector3.TransformCoordinates(
      nodes.get(name).computeWorldMatrix(true).getTranslation(),
      worldToRig,
    )
  const hips = legs.map(([upper]) => rigPosition(upper))
  const center = hips
    .reduce((sum, p) => sum.addInPlace(p), Vector3.Zero())
    .scale(1 / hips.length)
  const pivotOffset = center.subtract(pelvis.position)
  const rigUp = Vector3.TransformNormal(Vector3.Up(), rig)
  const legUp = legs.map(([upper]) => {
    const parent =
      nodes.get(upper).parent?.computeWorldMatrix(true) ?? Matrix.Identity()
    return Vector3.TransformNormal(rigUp, Matrix.Invert(parent))
  })
  const spans = legs.map(([, , hoof], i) => hips[i].y - rigPosition(hoof).y)
  if (spans.some((v) => v <= 0.001)) return null
  const legSpan = spans.reduce((a, b) => a + b, 0) / spans.length
  const zero = Vector3.Zero()

  let edits = [],
    observers,
    previous = ''
  function channel(
    name,
    prop,
    factor,
    offset = zero,
    axialFactor = factor,
    stride = null,
  ) {
    if (factor === 1 && axialFactor === 1 && offset.equals(zero) && !stride)
      return
    const node = nodes.get(name)
    if (!node) return
    edits.push({
      node,
      prop,
      sampled: node[prop],
      shaped: node[prop].clone(),
      factor,
      axialFactor,
      offset,
      stride,
    })
  }
  function apply() {
    // Read the animated hip before applying the torso and leg offsets.
    const hipTravel = pelvis.position.y - restHipHeight
    for (const edit of edits) {
      const { node, prop, shaped, factor, offset, stride } = edit
      if (node[prop] !== shaped) edit.sampled = node[prop]
      edit.sampled.scaleToRef(factor, shaped)
      shaped.y = edit.sampled.y * edit.axialFactor
      shaped.addInPlace(offset)
      if (stride) stride.scaleAndAddToRef(hipTravel, shaped)
      node[prop] = shaped
    }
  }
  function restore() {
    for (const { node, prop, sampled, shaped } of edits)
      if (node[prop] === shaped) node[prop] = sampled
  }
  function detach() {
    if (!observers) return
    scene.onBeforeAnimationsObservable.remove(observers[0])
    scene.onAfterAnimationsObservable.remove(observers[1])
    observers = null
    restore()
  }
  return {
    dimensions: Object.keys(giraffeDimensions).filter((key) =>
      (giraffeDimensions[key].joints ?? []).every((joint) => nodes.has(joint)),
    ),
    set({
      neck: length = 1,
      head = 1,
      legs: leg = 1,
      body = 1,
      ears = 1,
      muzzle = 1,
    } = {}) {
      const key = [length, head, leg, body, ears, muzzle].join('/')
      if (previous === key) return
      previous = key
      detach()
      edits = []
      const lift = (leg - 1) * legSpan
      // Scale the torso around the stance center so it stays over the supporting feet.
      const torsoOffset = pivotOffset.scale(1 - body)
      torsoOffset.y += lift
      channel('Pelvis', 'position', 1, torsoOffset)
      channel('Pelvis', 'scaling', body)
      channel('Tail.01', 'scaling', 1 / body)
      if (biped) {
        // The arm's local Y runs from shoulder to elbow. Only its cross-section
        // follows part of the torso change. Placement scale multiplies both.
        const armWidth = 1 + (body - 1) * 0.35
        for (const side of ['L', 'R'])
          channel('Arm.Upper.' + side, 'scaling', armWidth / body, zero, 1 / body)
      }
      // Neck joints inherit the torso's radius. Compensate joint spacing so
      // the centerline and the head still follow their independent controls.
      for (const name of neck) channel(name, 'position', length / body)
      channel('Socket.Neck', 'position', length, zero, length / body)
      channel('Head', 'scaling', head / body)
      for (const side of ['L', 'R']) channel('Ear.' + side, 'scaling', ears)
      channel('Muzzle', 'scaling', 1, zero, muzzle)
      legs.forEach(([upper, lower, hoof], i) => {
        // Move the attachment with the body in plan, keeping its rest height.
        const offset = legUp[i].scale((1 / body - 1) * (hips[i].y - center.y))
        // Keep the support foot planted as the hips rise and fall during a biped walk.
        const stride =
          biped && leg !== 1 ? legUp[i].scale((leg - 1) / body) : null
        channel(upper, 'position', 1, offset, 1, stride)
        channel(upper, 'scaling', 1 / body)
        const scale = 1 + lift / spans[i]
        for (const name of [lower, hoof]) channel(name, 'position', scale)
      })
      if (edits.length) {
        apply()
        observers = [
          scene.onBeforeAnimationsObservable.add(restore),
          scene.onAfterAnimationsObservable.add(apply),
        ]
      }
    },
    dispose: detach,
  }
}
