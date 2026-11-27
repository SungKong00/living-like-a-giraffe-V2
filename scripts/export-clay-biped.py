"""Export the standalone Riragi biped as a skinned studio GLB (Blender 4.2)."""

import os
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix


def reduce_surface(obj):
    # Simplify each editable part separately so small isolated features survive.
    mesh = obj.data
    mesh.calc_loop_triangles()
    triangles = len(mesh.loop_triangles)
    ratio = 0.24
    if obj.name.startswith(("Muzzle freckle", "Glint.")):
        ratio = 0.08
    if obj.name.startswith(("Mouth", "Upper lid", "Tail · cord")):
        ratio = 0.55
    decimate = obj.modifiers.new("Web surface", "DECIMATE")
    decimate.ratio = min(1.0, max(32 / triangles, ratio))
    # Keep the actual paint boundary, especially the ear wells and the cuffs.
    border_name = None
    if len(mesh.materials) > 1:
        adjacent = [set() for _ in mesh.vertices]
        for face in mesh.polygons:
            for index in face.vertices:
                adjacent[index].add(face.material_index)
        boundary = [i for i, slots in enumerate(adjacent) if len(slots) > 1]
        if boundary:
            border = obj.vertex_groups.new(name="Web material borders")
            border.add(boundary, 1.0, "REPLACE")
            border_name = border.name
            decimate.vertex_group = border_name
            decimate.invert_vertex_group = True
            decimate.vertex_group_factor = 1000
    # Collapse in bind space, before skinning. The skin itself stays editable.
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_move_to_index(modifier=decimate.name, index=0)
        bpy.ops.object.modifier_apply(modifier=decimate.name)
    if border_name:
        obj.vertex_groups.remove(obj.vertex_groups[border_name])
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=[face for face in bm.faces if len(face.verts) > 4])
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def slip_style(material):
    # Only batch plain pigmented slips with the same unmodified normal-map graph.
    nodes = material.node_tree.nodes if material and material.use_nodes else []
    if sorted(node.type for node in nodes) != ["BSDF_PRINCIPLED", "NORMAL_MAP", "OUTPUT_MATERIAL", "TEX_IMAGE"]:
        return None
    shader = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    normal = next(node for node in nodes if node.type == "NORMAL_MAP")
    tex = next(node for node in nodes if node.type == "TEX_IMAGE")
    links = {(link.from_node.type, link.from_socket.name, link.to_node.type, link.to_socket.name)
             for link in material.node_tree.links}
    if links != {("TEX_IMAGE", "Color", "NORMAL_MAP", "Color"),
                 ("NORMAL_MAP", "Normal", "BSDF_PRINCIPLED", "Normal"),
                 ("BSDF_PRINCIPLED", "BSDF", "OUTPUT_MATERIAL", "Surface")}:
        return None
    values = []
    for socket in shader.inputs:
        if socket.name != "Base Color" and hasattr(socket, "default_value"):
            value = socket.default_value
            values.append(tuple(value) if hasattr(value, "__len__") else value)
    return (tuple(values), normal.space, normal.uv_map, normal.inputs["Strength"].default_value,
            tex.image, tex.interpolation, tex.extension, tex.projection, material.use_backface_culling)


def combine_clay_colors(objects):
    batches = defaultdict(list)
    for material in dict.fromkeys(mat for obj in objects for mat in obj.data.materials):
        style = slip_style(material)
        if style:
            batches[style].append(material)
    replacements = {}
    colors = {}
    for materials in batches.values():
        if len(materials) < 2:
            continue
        clay = materials[0].copy()
        clay.name = "Pigmented clay"
        nodes = clay.node_tree.nodes
        tint = nodes.new("ShaderNodeVertexColor")
        tint.layer_name = "Clay slip"
        shader = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
        clay.node_tree.links.new(tint.outputs["Color"], shader.inputs["Base Color"])
        for material in materials:
            original = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
            colors[material] = original.inputs["Base Color"].default_value[:]
            replacements[material] = clay
    for obj in objects:
        mesh = obj.data
        materials = list(mesh.materials)
        if not any(material in colors for material in materials):
            continue
        layer = mesh.color_attributes.new(name="Clay slip", type="BYTE_COLOR", domain="CORNER")
        mesh.color_attributes.active_color = layer
        for face in mesh.polygons:
            material = materials[face.material_index]
            color = colors.get(material, (1, 1, 1, 1))
            for index in face.loop_indices:
                layer.data[index].color = color
        for index, material in enumerate(materials):
            if material in colors:
                mesh.materials[index] = replacements[material]


def export_motion(scene, rig, name, output):
    action = bpy.data.actions.get(name)
    if action is None:
        raise ValueError(f"액션을 찾을 수 없습니다: {name}")
    # The exporter otherwise merges actions or NLA strips on this skeleton.
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    for other in list(bpy.data.actions):
        if other != action:
            bpy.data.actions.remove(other)
    rig.animation_data.action = action
    scene.frame_start, scene.frame_end = map(int, action.frame_range)
    scene.frame_set(scene.frame_start)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=str(output.resolve()), use_selection=True,
        export_armature_object_remove=True, export_animation_mode="ACTIONS",
        export_frame_step=action.get("studioFrameStep", 1), export_frame_range=True,
        export_rest_position_armature=True, export_extras=False,
    )


def export(source, output, motion=None):
    if output.suffix.lower() != ".glb":
        raise ValueError("출력 파일 이름은 .glb로 끝나야 합니다.")
    bpy.ops.wm.open_mainfile(filepath=str(source.resolve()), use_scripts=False, load_ui=False)
    scene = bpy.context.scene
    rig = scene.objects["Riragi.Rig"]
    objects = [obj for obj in scene.objects if obj.type == "MESH" and obj.find_armature() == rig]
    body = scene.objects["Giraffe.Body"]
    # The studio applies the ratios after sampling the motion, once per character.
    ratios = {'["' + name + '"]' for name in ("body", "neck", "head", "legs", "ears", "muzzle")}
    for curve in list(rig.animation_data.drivers):
        if any(target.data_path in ratios for var in curve.driver.variables for target in var.targets):
            rig.driver_remove(curve.data_path, curve.array_index)
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    if motion is not None:
        export_motion(scene, rig, motion, output)
        return
    rig.animation_data.action = None
    # Standalone library clips are uploaded separately from the model.
    for action in list(bpy.data.actions):
        if action.get("studioStandalone"):
            bpy.data.actions.remove(action)
    scene.frame_set(1)
    for obj in objects:
        reduce_surface(obj)
    combine_clay_colors(objects)
    bpy.ops.object.select_all(action="DESELECT")
    pieces = [obj for obj in objects if obj != body]
    for obj in pieces:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    bpy.context.object.name = "Giraffe.Claywork"
    rig.animation_data.action = bpy.data.actions["두 발 걷기"]
    with tempfile.TemporaryDirectory(dir=output.resolve().parent) as tmp:
        for name in ("Hand-painted giraffe slip", "Hand-rubbed face slip"):
            image = bpy.data.images.get(name)
            if image is None:
                continue
            if max(image.size) > 512:
                scale = 512 / max(image.size)
                image.scale(*(max(1, round(n * scale)) for n in image.size))
            image.file_format = "JPEG"
            image.filepath_raw = str(Path(tmp) / (name + ".jpg"))
            image.save()
            image.reload()
            image.pack()
        bpy.ops.export_scene.gltf(
            filepath=str(Path(tmp) / "character.glb"),
            export_format="GLB",
            export_armature_object_remove=True,
            export_skins=True,
            export_extras=True,
            export_attributes=True,
            export_animations=True,
            export_animation_mode="ACTIONS",
            export_rest_position_armature=True,
            export_tangents=True,
            export_jpeg_quality=92,
        )
        os.replace(Path(tmp) / "character.glb", output)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--motion", help="이름이 일치하는 액션만 모션 GLB로 내보냅니다.")
    opts = parser.parse_args(args)
    export(opts.source, opts.output, opts.motion)
    sys.stdout.flush()
    os._exit(0)
