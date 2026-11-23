"""Bake opaque surfaces in the disposable publication scene. Keep glass live."""

from tempfile import TemporaryDirectory
from pathlib import Path

import bpy
from model import select, tagged, parent_at


def render_meshes(objects, owner):
    if not objects:
        return None
    for obj in objects:
        if obj.data.users > 1:
            obj.data = obj.data.copy()
    select(objects)
    bpy.ops.object.convert(target="MESH", keep_original=False)
    if len(bpy.context.selected_objects) > 1:
        bpy.ops.object.join()
    mesh = bpy.context.object
    parent_at(mesh, owner)
    return mesh


def live_surface(material):
    if material is None or not material.use_nodes:
        return False
    for node in material.node_tree.nodes:
        if node.type in {"BSDF_GLASS", "BSDF_TRANSPARENT"}:
            return True
        if node.type == "BSDF_PRINCIPLED":
            transmission = node.inputs["Transmission Weight"]
            alpha = node.inputs["Alpha"]
            if (
                transmission.is_linked
                or transmission.default_value > 0
                or alpha.is_linked
                or alpha.default_value < 1
            ):
                return True
    return False


def display_texture(scene, linear_image, out):
    # glTF base colour/emission textures use sRGB. Preserve the scene's view,
    # look and exposure while targeting the web display on this disposable copy.
    if not linear_image.is_float:
        raise ValueError("장면 색 변환에는 부동소수점 베이크 이미지가 필요합니다.")
    settings = scene.render.image_settings
    scene.display_settings.display_device = "sRGB"
    settings.file_format = "PNG"
    settings.color_mode = "RGB"
    settings.color_depth = "8"
    settings.color_management = "FOLLOW_SCENE"
    with TemporaryDirectory(dir=out) as directory:
        filename = str(Path(directory) / "display.png")
        linear_image.save_render(filename, scene=scene)
        texture = bpy.data.images.load(filename, check_existing=False)
        texture.name = linear_image.name + " sRGB"
        texture.colorspace_settings.name = "sRGB"
        texture.pack()
        return texture


def bake(scene, out):
    rooms = tagged(scene, "roomId")
    visible = {
        obj for room in rooms.values() for obj in [room, *room.children_recursive]
    }
    for obj in scene.objects:
        if obj not in visible and obj.type == "MESH":
            obj.hide_render = True
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 6
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4
    outputs = []
    groups = []
    for key, room in rooms.items():
        owners = [room, *[child for child in room.children if "itemId" in child]]
        for owner in owners:
            children = [owner, *owner.children_recursive]
            if owner == room:
                editable = {
                    o for item in owners[1:] for o in [item, *item.children_recursive]
                }
                children = [o for o in children if o not in editable]
            meshes = [
                o
                for o in children
                if o.type in {"MESH", "FONT", "CURVE"}
                and not any(live_surface(slot.material) for slot in o.material_slots)
            ]
            if meshes:
                groups.append((key, owner, meshes))
    for key, owner, meshes in groups:
        mesh = render_meshes(meshes, owner if owner not in meshes else owner.parent)
        if not mesh:
            continue
        mesh.name = key + " display"
        # Work only on derived meshes. Isolate material bake targets per room.
        for slot in mesh.material_slots:
            if slot.material:
                slot.material = slot.material.copy()
        uv = mesh.data.uv_layers.new(name="BakedLight")
        uv_name = uv.name
        mesh.data.uv_layers.active = uv
        select([mesh])
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.uv.smart_project(island_margin=0.003)
        bpy.ops.object.mode_set(mode="OBJECT")
        resolution = 256 if "itemId" in owner else 1024
        image = bpy.data.images.new(
            "Light " + key, resolution, resolution, alpha=False, float_buffer=True
        )
        for slot in mesh.material_slots:
            if not slot.material:
                continue
            mat = slot.material
            mat.use_nodes = True
            tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
            tex.image = image
            mat.node_tree.nodes.active = tex
        bpy.ops.object.bake(
            type="COMBINED",
            pass_filter={"DIRECT", "INDIRECT", "DIFFUSE", "EMIT"},
            margin=2,
            uv_layer=uv_name,
        )
        outputs.append((mesh, image, uv_name, owner.get("finish", "original")))
    # Preserve the original bounce lighting until every target has been baked.
    for mesh, image, uv_name, finish in outputs:
        for name in list(mesh.data.uv_layers.keys()):
            if name != uv_name:
                mesh.data.uv_layers.remove(mesh.data.uv_layers[name])
        mesh.data.uv_layers[uv_name].active_render = True
        texture = display_texture(scene, image, out)
        mat = bpy.data.materials.new(mesh.name + " baked")
        mat["riragiBaked"] = True
        mat["riragiFinish"] = finish
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        nodes.clear()
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = texture
        coords = nodes.new("ShaderNodeUVMap")
        coords.uv_map = uv_name
        emit = nodes.new("ShaderNodeEmission")
        output = nodes.new("ShaderNodeOutputMaterial")
        links = mat.node_tree.links
        links.new(coords.outputs["UV"], tex.inputs["Vector"])
        links.new(tex.outputs["Color"], emit.inputs["Color"])
        links.new(emit.outputs[0], output.inputs["Surface"])
        mesh.data.materials.clear()
        mesh.data.materials.append(mat)
