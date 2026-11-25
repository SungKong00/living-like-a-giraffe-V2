"""Bake opaque surfaces in the disposable publication scene. Keep glass live."""

from pathlib import Path
from tempfile import TemporaryDirectory

import bmesh
import bpy
from model import parent_at, select, tagged, wrap_mesh_anchors
from surfaces import surface_kind


def keep_faces(obj, kinds, keep):
    mesh = obj.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        discard = [face for face in bm.faces if kinds[face.material_index] != keep]
        bmesh.ops.delete(bm, geom=discard, context="FACES")
        bm.to_mesh(mesh)
    finally:
        bm.free()
    for i in reversed(range(len(kinds))):
        if kinds[i] != keep:
            mesh.materials.pop(index=i)
    mesh.update()


def prepare_surfaces(scene):
    wrap_mesh_anchors(scene)
    receivers = set()
    policies = {}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    objects = {
        o for room in tagged(scene, "roomId").values() for o in room.children_recursive
    }
    for obj in sorted(objects, key=lambda o: o.name):
        if obj.type not in {"MESH", "FONT", "CURVE"} or obj.hide_render:
            continue
        slots = obj.evaluated_get(depsgraph).material_slots
        kinds = []
        for slot in slots:
            mat = slot.material
            if mat not in policies:
                policies[mat] = surface_kind(mat)
            kinds.append(policies[mat])
        if not kinds or set(kinds) == {"bake"}:
            receivers.add(obj)
            continue
        if set(kinds) == {"live"}:
            continue
        # Split evaluated faces, not slots on the original mesh. Modifiers may
        # produce geometry, and a joined room can contain all three policies.
        select([obj])
        bpy.ops.object.convert(target="MESH")
        obj = bpy.context.object
        obj.data = obj.data.copy()
        # Studio color overrides live on the object. Bind them to the private
        # mesh before compacting slots, so the kept faces retain their material.
        for slot in obj.material_slots:
            if slot.link == "OBJECT":
                material = slot.material
                slot.link = "DATA"
                slot.material = material
        used = {kinds[f.material_index] for f in obj.data.polygons}
        if not used - {"volume"}:
            keep_faces(obj, kinds, None)
            continue
        if {"live", "bake"} <= used:
            glass = obj.copy()
            glass.data = obj.data.copy()
            scene.collection.objects.link(glass)
            keep_faces(glass, kinds, "live")
        if "bake" in used:
            keep_faces(obj, kinds, "bake")
            receivers.add(obj)
        else:
            keep_faces(obj, kinds, "live")
    return receivers


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


def bake(scene, out, receivers, *, fixed_only=False):
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
    field = None
    if fixed_only:
        from light_field import capture
        from source_lights import sources
        lamps = [obj for obj in sources(scene).values() if not obj.hide_render]
        field = {"field": capture(scene, rooms)}
        for obj in lamps:
            obj.hide_render = True
        field["ambientField"] = capture(scene, rooms)
        for obj in lamps:
            obj.hide_render = False
    outputs = []
    groups = []
    for key, room in rooms.items():
        owners = [room, *[child for child in room.children if "itemId" in child]]
        for owner in ([room] if fixed_only else owners):
            children = [owner, *owner.children_recursive]
            if owner == room:
                editable = {
                    o for item in owners[1:] for o in [item, *item.children_recursive]
                }
                children = [o for o in children if o not in editable]
            meshes = [o for o in children if o in receivers]
            if meshes:
                groups.append((key, owner, meshes))
    # The parent creates this file only for jobs with a progress display.
    progress = out / "bake.percent"
    reporting = progress.is_file()
    total = len(groups) * (2 if fixed_only else 1)
    completed = 0

    def report():
        if reporting:
            with progress.open("r+b", buffering=0) as stream:
                stream.write(f"{100 * completed // total if total else 100:03d}".encode("ascii"))

    report()
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
        completed += 1
        report()
        albedo = None
        if fixed_only:
            albedo = bpy.data.images.new(key + " surface colour", resolution, resolution, alpha=False)
            for slot in mesh.material_slots:
                if slot.material:
                    slot.material.node_tree.nodes.active.image = albedo
            bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=2, uv_layer=uv_name)
            albedo.pack()
            completed += 1
            report()
        outputs.append((mesh, image, albedo, uv_name, owner.get("finish", "original")))
    # Preserve the original bounce lighting until every target has been baked.
    for mesh, image, albedo, uv_name, finish in outputs:
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
        if albedo:
            # Carry two textures on the same UVs in the private editor only.
            mat["studioReceiver"] = True
            surface = nodes.new("ShaderNodeBsdfPrincipled")
            raw = nodes.new("ShaderNodeTexImage")
            raw.image = albedo
            links.new(coords.outputs["UV"], raw.inputs["Vector"])
            links.new(raw.outputs["Color"], surface.inputs["Base Color"])
            links.new(tex.outputs["Color"], surface.inputs["Emission Color"])
            surface.inputs["Emission Strength"].default_value = 1
            links.new(surface.outputs[0], output.inputs["Surface"])
        mesh.data.materials.clear()
        mesh.data.materials.append(mat)
    return field
