import { routeAt, routeTimeline } from '../shared/character-route.mjs'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder'
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
// The path and its marks appear the moment a character is selected, on a
// scene that draws only when asked. Register their shaders up front so the
// first frame does not ask the site root for them.
import '@babylonjs/core/Shaders/color.vertex'
import '@babylonjs/core/Shaders/color.fragment'
import '@babylonjs/core/Shaders/default.vertex'
import '@babylonjs/core/Shaders/default.fragment'

const lineColor = Color3.FromHexString('#8fcf3a')
const MARK = 0.55
const ARC_STEPS = 8

// The selected character's route in the editing scene: the path it walks,
// corners rounded as it will round them, and a numbered mark on the floor at
// each point (filled where it stops). The marks turn so their numbers read
// upright from the camera. Only `pointAt` can pick them, so they are neither
// selected like furniture nor in the way of a floor click.
export function routeGuide(world) {
  const { scene, rooms, camera } = world
  const root = new TransformNode('경로 안내', scene)
  root.setEnabled(false)
  // Marks stay out of the room's own rotation so they can face the camera.
  const floor = new TransformNode('경로 지점', scene)
  floor.setEnabled(false)
  let offsets = []
  const facing = scene.onBeforeRenderObservable.add(() => {
    if (!marks.length || !floor.isEnabled()) return
    // The top of a number points away from the camera along the floor.
    const yaw = Math.atan2(Math.cos(camera.alpha), Math.sin(camera.alpha))
    for (const mark of marks) mark.rotation.y = yaw
  })
  scene.onDisposeObservable.addOnce(() =>
    scene.onBeforeRenderObservable.remove(facing),
  )
  const materials = new Map()
  let line = null
  let marks = []
  let key = ''

  function material(number, stop) {
    const id = number + (stop ? ' 멈춤' : '')
    if (materials.has(id)) return materials.get(id)
    const size = 128
    const texture = new DynamicTexture('경로 지점 ' + id, size, scene, true)
    const ctx = texture.getContext()
    ctx.clearRect(0, 0, size, size)
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2)
    ctx.fillStyle = stop ? '#3f7a12' : '#ffffff'
    ctx.fill()
    ctx.lineWidth = 8
    ctx.strokeStyle = stop ? '#ffffff' : '#3f7a12'
    ctx.stroke()
    ctx.fillStyle = stop ? '#ffffff' : '#1f2a14'
    ctx.font = '700 64px Pretendard, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(number), size / 2, size / 2 + 4)
    texture.hasAlpha = true
    texture.update()
    const made = Object.assign(new StandardMaterial('경로 지점 ' + id, scene), {
      diffuseTexture: texture,
      emissiveColor: Color3.White(),
      disableLighting: true,
      useAlphaFromDiffuseTexture: true,
      backFaceCulling: false,
    })
    materials.set(id, made)
    return made
  }
  function clear() {
    line?.dispose()
    for (const mark of marks) mark.dispose()
    line = null
    marks = []
  }
  // The path as the character walks it, sampled along its rounded corners.
  function path(route, scale) {
    const timeline = routeTimeline(
      { ...route, speed: 1 },
      { radius: 0.6 * scale },
    )
    const points = []
    const add = (x, z) => {
      const last = points.at(-1)
      if (!last || Math.hypot(last.x - x, last.z - z) > 1e-4)
        points.push(new Vector3(x, 0, z))
    }
    for (const s of timeline.segments) {
      if (s.kind !== 'line' && s.kind !== 'arc') continue
      const steps = s.kind === 'arc' ? ARC_STEPS : 1
      for (let i = 0; i <= steps; i++) {
        const at = routeAt(timeline, s.start + (s.duration * i) / steps)
        add(at.x, at.z)
      }
    }
    return points
  }
  function place(room, position) {
    const node = rooms.get(room) ?? null
    root.parent = node
    root.position.set(position[0], position[1] + 0.05, position[2])
    const matrix = node?.computeWorldMatrix(true)
    marks.forEach((mark, i) => {
      const at = new Vector3(
        position[0] + offsets[i][0],
        position[1] + 0.06,
        position[2] + offsets[i][1],
      )
      mark.position.copyFrom(
        matrix ? Vector3.TransformCoordinates(at, matrix) : at,
      )
    })
    world.wake()
  }
  return Object.freeze({
    /** Shows character `c`'s route; null or a character without one hides it. */
    show(c) {
      if (!c?.route) {
        if (key) world.wake()
        root.setEnabled(false)
        floor.setEnabled(false)
        key = ''
        clear()
        return
      }
      root.setEnabled(true)
      floor.setEnabled(true)
      const next = JSON.stringify([c.route.points, c.route.mode, c.scale])
      if (next === key) return place(c.room, c.position)
      key = next
      clear()
      const points = path(c.route, c.scale)
      if (points.length > 1) {
        line = CreateLines('경로', { points }, scene)
        line.color = lineColor
        line.isPickable = false
        line.renderingGroupId = 1
        line.parent = root
      }
      offsets = c.route.points.map((p) => p.at)
      marks = c.route.points.map((p, i) => {
        const mark = CreateDisc(
          '경로 지점 ' + (i + 1),
          { radius: MARK * Math.max(1, c.scale) },
          scene,
        )
        mark.rotation.x = -Math.PI / 2
        mark.material = material(i + 1, !!p.stop)
        mark.isPickable = false
        mark.parent = floor
        return mark
      })
      place(c.room, c.position)
    },
    /** Follows a character that is being dragged, before the edit is kept. */
    moveTo: place,
    /** The route point whose mark is under the pointer, or -1. */
    pointAt(x, y) {
      if (!floor.isEnabled() || !marks.length) return -1
      const hit = scene.pick(x, y, (mesh) => marks.includes(mesh))
      return hit?.pickedMesh ? marks.indexOf(hit.pickedMesh) : -1
    },
    /**
     * True when every point of `route` lies over room `room`'s floor with
     * the character at `position` there.
     */
    fits(route, room, position) {
      const node = rooms.get(room)
      const bounds = world.roomBounds.get(room)
      if (!node || !bounds) return false
      const matrix = node.computeWorldMatrix(true)
      const { min, max } = bounds
      return route.points.every((p) => {
        const at = Vector3.TransformCoordinates(
          new Vector3(
            position[0] + p.at[0],
            position[1],
            position[2] + p.at[1],
          ),
          matrix,
        )
        return (
          at.x >= min.x - 0.01 &&
          at.x <= max.x + 0.01 &&
          at.z >= min.z - 0.01 &&
          at.z <= max.z + 0.01
        )
      })
    },
  })
}
