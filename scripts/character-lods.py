"""Build reduced levels of a character model (Blender 4.2 as a Python module).

Reads a rigged GLB, joins its body meshes into one mesh per level, removes
triangles, bakes the colours of the original onto a single image and writes
the levels alone, bound to the armature, to another GLB. The caller
(scripts/character-lods.mjs) binds them to the model's own skin.

Wearables (names starting with `Wear.` or a `wearable` property) keep their
original mesh: they are left out of the join and of the bake.

    .venv/bin/python scripts/character-lods.py model.glb levels.glb
"""

import os
import re
import sys
from pathlib import Path

import bpy

# Level, share of the original's triangles, side of the baked image in pixels.
LEVELS = ((1, 0.2, 512), (2, 0.04, 256))


def is_level(obj):
    return bool(re.match(r"LOD[12]\.", obj.name)) or "lod" in obj


def is_wearable(obj):
    return obj.name.startswith("Wear.") or "wearable" in obj


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def only(objects, active):
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active


def baked_material(name, image):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = nodes["Principled BSDF"]
    shader.inputs["Roughness"].default_value = 0.8
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    # The bake writes into the selected image node of the active object.
    nodes.active = texture
    return material


def build(level, share, size, parts, primary, height, skin):
    copies = []
    for part in parts:
        copy = part.copy()
        copy.data = part.data.copy()
        bpy.context.collection.objects.link(copy)
        copies.append(copy)
    first = copies[parts.index(primary)]
    only(copies, first)
    bpy.ops.object.join()
    lod = bpy.context.view_layer.objects.active
    lod.name = f"LOD{level}.{primary.name}"
    lod.data.name = lod.name
    for key in list(lod.keys()):
        del lod[key]

    # A GLB splits vertices along seams. Left apart, removing triangles
    # would open cracks there, so the copies are welded first.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=height * 1e-5)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()

    # Fewer triangles first, so the armature keeps deforming the result.
    decimate = lod.modifiers.new("Reduce", "DECIMATE")
    decimate.ratio = share
    only([lod], lod)
    bpy.ops.object.modifier_move_to_index(modifier=decimate.name, index=0)
    bpy.ops.object.modifier_apply(modifier=decimate.name)

    # One image for the whole level: unwrap it afresh and bake the colours of
    # the original surface nearest to each point.
    while lod.data.uv_layers:
        lod.data.uv_layers.remove(lod.data.uv_layers[0])
    lod.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.4, island_margin=0.03)
    bpy.ops.object.mode_set(mode="OBJECT")
    image = bpy.data.images.new(lod.name, size, size, alpha=False)
    # Texels no ray reaches keep the body's colour instead of black, which
    # would show as dark cracks along the seams.
    image.generated_color = (*skin, 1.0)
    lod.data.materials.clear()
    lod.data.materials.append(baked_material(lod.name, image))
    only([*parts, lod], lod)
    bpy.ops.object.bake(
        type="DIFFUSE",
        pass_filter={"COLOR"},
        use_selected_to_active=True,
        # The fewer triangles, the further the level strays from the surface.
        cage_extrusion=height * (0.012 + 0.0015 / share),
        max_ray_distance=0,
        margin=size // 16,
        margin_type="EXTEND",
        use_clear=False,
    )
    image.pack()

    lod["lod"] = level
    lod["lodOf"] = primary.name
    covers = [part.name for part in parts if part is not primary]
    if covers:
        lod["lodCovers"] = ", ".join(covers)
    return lod


def main(source, output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    scene = bpy.context.scene
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    for obj in [obj for obj in meshes if is_level(obj)]:
        bpy.data.objects.remove(obj)
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    armature = next(obj for obj in scene.objects if obj.type == "ARMATURE")
    skinned = lambda obj: any(m.type == "ARMATURE" for m in obj.modifiers)
    parts = [obj for obj in meshes if skinned(obj) and not is_wearable(obj)]
    if not parts:
        raise SystemExit("스킨에 묶인 몸 메시가 없습니다.")
    # The levels stand in for the largest part and cover the others.
    primary = max(parts, key=triangles)
    total = sum(triangles(part) for part in parts)
    height = max((obj.matrix_world @ v.co).z for obj in parts for v in obj.data.vertices)

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 8
    # Bake and export in the bind pose, hiding what is not the body.
    armature.data.pose_position = "REST"
    for obj in meshes:
        obj.hide_render = obj not in parts
    # The colour most of the body has: the base colour of its largest part.
    shader = primary.data.materials[0].node_tree.nodes.get("Principled BSDF")
    skin = tuple(shader.inputs["Base Color"].default_value)[:3] if shader else (0.8, 0.6, 0.4)
    levels = [
        build(level, share, size, parts, primary, height, skin)
        for level, share, size in LEVELS
    ]
    for lod in levels:
        print(f"{lod.name}: {triangles(lod)} of {total} triangles")

    for obj in meshes:
        bpy.data.objects.remove(obj)
    only([armature, *levels], armature)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_extras=True,
        export_animations=False,
        export_tangents=False,
        export_image_format="JPEG",
        export_jpeg_quality=88,
        export_rest_position_armature=True,
    )


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    if len(arguments) != 2:
        raise SystemExit(__doc__)
    main(Path(arguments[0]).resolve(), Path(arguments[1]).resolve())
    # Blender as a module crashes while Python shuts down; the file is written.
    sys.stdout.flush()
    os._exit(0)
