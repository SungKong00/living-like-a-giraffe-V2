"""Review renders of the figure: the same camera for every look."""

import math
from pathlib import Path

import bpy
from mathutils import Vector

VIEWS = {"front": 0, "three-quarter": 35, "side": 90, "back": 180}
FRAMES = {
    # name: (look-at height, distance, image size)
    "full": (1.76, 13.6, (620, 1160)),
    "head": (3.08, 4.2, (760, 760)),
    "torso": (1.35, 6.2, (760, 760)),
}


def stage():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"
    scene.view_settings.view_transform = "Standard"
    world = scene.world or bpy.data.worlds.new("Studio")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.40, 0.36, 0.33, 1)
    background.inputs["Strength"].default_value = 0.55
    props = bpy.data.collections.new("99 · Review stage")
    scene.collection.children.link(props)

    floor = bpy.data.meshes.new("Floor")
    s = 30
    floor.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new("Floor", floor)
    paper = bpy.data.materials.new("Backdrop paper")
    paper.use_nodes = True
    paper.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.40, 0.36, 0.33, 1)
    paper.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    floor.materials.append(paper)
    props.objects.link(ground)
    ground.is_shadow_catcher = True

    pivot = bpy.data.objects.new("Turntable", None)
    props.objects.link(pivot)
    for name, at, power, size in (
        ("Key", (-4.5, -7.0, 7.5), 1500, 5.0),
        ("Fill", (6.0, -5.0, 3.0), 420, 6.0),
        ("Rim", (2.5, 6.0, 6.0), 700, 3.0),
    ):
        light = bpy.data.lights.new(name, "AREA")
        light.energy, light.size = power, size
        lamp = bpy.data.objects.new(name, light)
        lamp.location = at
        lamp.rotation_euler = (Vector((0, 0, 1.8)) - Vector(at)).to_track_quat("-Z", "Y").to_euler()
        lamp.parent = pivot
        props.objects.link(lamp)
    camera = bpy.data.objects.new("Review camera", bpy.data.cameras.new("Review camera"))
    camera.data.lens = 110
    camera.parent = pivot
    props.objects.link(camera)
    scene.camera = camera
    return props, pivot, camera


def shoot(folder, prefix, views=("front", "three-quarter", "side", "back"), frame="full", samples=40):
    """Render the listed views to `<folder>/<prefix>-<view>.png`."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    props, pivot, camera = stage()
    scene.cycles.samples = samples
    height, distance, size = FRAMES[frame]
    scene.render.resolution_x, scene.render.resolution_y = size
    camera.location = (0, -distance, height + 0.25)
    camera.rotation_euler = (Vector((0, 0, height)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    written = []
    for view in views:
        # Turning the stage keeps the light on the face the camera sees.
        pivot.rotation_euler = (0, 0, math.radians(VIEWS[view]))
        scene.render.filepath = str(folder / f"{prefix}-{view}.png")
        bpy.ops.render.render(write_still=True)
        written.append(scene.render.filepath)
    for obj in list(props.objects):
        bpy.data.objects.remove(obj)
    bpy.data.collections.remove(props)
    return written
