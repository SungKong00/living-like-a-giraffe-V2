import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { strideFromSamples } from '../../shared/character-route.mjs'
import '@babylonjs/core/Animations/animatable.js'

// Turns clips into joint values on one character's nodes: a clip bound to
// its nodes for playing in place, and the blended samples a route writes
// itself. Body proportions and measuring a walk's stride belong here too.
// Nothing here knows whether a character is on screen or how many there are.

export { giraffeProportions } from '../giraffe-proportions.js'

const POSE = ['position', 'rotationQuaternion', 'scaling']
const STRIDE_SAMPLES = 48

/** The pose as exported: what a route blends with where a clip is silent. */
export function restPose(nodes) {
  const rest = new Map()
  for (const node of nodes)
    rest.set(node, {
      position: node.position.clone(),
      rotationQuaternion: (
        node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation)
      ).clone(),
      scaling: node.scaling.clone(),
    })
  return rest
}

/** A clip copied onto a character's nodes by name, for playing in place. */
export function clipGroup(scene, id, nodes, source) {
  const group = new AnimationGroup(source.name + ' · ' + id, scene)
  for (const { animation, target } of source.targetedAnimations) {
    const node = nodes.get(target.name)
    if (node) group.addTargetedAnimation(animation, node)
  }
  return group
}

/** A clip's tracks on a character's nodes and its length in seconds, or null. */
export function clipTracks(nodes, source) {
  const tracks = []
  let fps = 60
  for (const { animation, target } of source.targetedAnimations) {
    const node = nodes.get(target.name)
    if (!node || !POSE.includes(animation.targetProperty)) continue
    fps = animation.framePerSecond
    tracks.push({ node, prop: animation.targetProperty, animation })
  }
  const duration = (source.to - source.from) / fps
  return tracks.length && duration > 0
    ? { tracks, from: source.from, fps, duration }
    : null
}

/** Puts the nodes of these channels back to their rest pose. */
export function restChannels(channels) {
  for (const channel of channels) {
    channel.value.copyFrom(channel.rest)
    channel.node[channel.prop] = channel.value
  }
}

/**
 * One channel per node property that any of `clips` (name → clipTracks)
 * moves. Nodes that only the channels `before` moved go back to rest.
 */
export function blendChannels(clips, rest, before = []) {
  const channels = new Map()
  for (const [name, clip] of clips)
    for (const { node, prop, animation } of clip.tracks) {
      const id = node.uniqueId + prop
      if (!channels.has(id)) {
        const value = rest.get(node)[prop]
        channels.set(id, {
          node,
          prop,
          rest: value,
          value: value.clone(),
          by: new Map(),
        })
      }
      channels.get(id).by.set(name, animation)
    }
  restChannels(before.filter((c) => !channels.has(c.node.uniqueId + c.prop)))
  return [...channels.values()]
}

/** Writes the blend of one or two timetable layers onto the nodes. */
export function writePose({ clips, channels }, layers) {
  const frames = layers.map((layer) => {
    const clip = layer.clip && clips.get(layer.clip)
    if (!clip) return null
    const time = layer.loop
      ? ((layer.time % clip.duration) + clip.duration) % clip.duration
      : Math.min(Math.max(layer.time, 0), clip.duration)
    return { name: layer.clip, frame: clip.from + time * clip.fps }
  })
  const value = (channel, at) =>
    (at && channel.by.get(at.name)?.evaluate(at.frame)) ?? channel.rest
  for (const channel of channels) {
    const a = value(channel, frames[0])
    if (layers.length < 2) channel.value.copyFrom(a)
    else {
      const b = value(channel, frames[1])
      if (channel.prop === 'rotationQuaternion')
        Quaternion.SlerpToRef(a, b, layers[1].weight, channel.value)
      else Vector3.LerpToRef(a, b, layers[1].weight, channel.value)
    }
    // Assigned, not copied into: body proportions swap these objects.
    channel.node[channel.prop] = channel.value
  }
}

/** Ground one cycle of the walk covers, in the model's own units. */
export function measureStride(root, route, name, clip) {
  const joints = [...new Set(clip.tracks.map((t) => t.node))]
  const order = root.getDescendants(false)
  const samples = []
  for (let i = 0; i < STRIDE_SAMPLES; i++) {
    const time = (clip.duration * i) / STRIDE_SAMPLES
    writePose(route, [{ clip: name, time, weight: 1, loop: true }])
    root.computeWorldMatrix(true)
    for (const node of order) node.computeWorldMatrix(true)
    const inverse = root.getWorldMatrix().clone().invert()
    samples.push(
      joints.map((node) =>
        Vector3.TransformCoordinates(
          node.getAbsolutePosition(),
          inverse,
        ).asArray(),
      ),
    )
  }
  return strideFromSamples(samples)
}
