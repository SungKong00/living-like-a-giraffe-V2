"""Bake opaque surfaces in the disposable publication scene. Keep glass live."""
import bpy
from model import select, tagged, parent_at


def render_meshes(objects, owner):
    if not objects:
        return None
    select(objects)
    bpy.ops.object.convert(target='MESH',keep_original=False)
    if len(bpy.context.selected_objects)>1:
        bpy.ops.object.join()
    mesh = bpy.context.object
    parent_at(mesh,owner)
    return mesh


def bake(scene,out):
    rooms = tagged(scene,'roomId')
    visible = {obj for room in rooms.values() for obj in [room,*room.children_recursive]}
    for obj in scene.objects:
        if obj not in visible and obj.type=='MESH':
            obj.hide_render = True
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 6
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    outputs = []
    for key,room in rooms.items():
        meshes = [obj for obj in room.children_recursive if obj.type=='MESH' and
                  not any(slot.material and 'glass' in slot.material.name.lower() for slot in obj.material_slots)]
        mesh = render_meshes(meshes,room)
        if not mesh:
            continue
        mesh.name = key+' display'
        # Work only on derived meshes. Isolate material bake targets per room.
        for slot in mesh.material_slots:
            if slot.material:
                slot.material = slot.material.copy()
        uv = mesh.data.uv_layers.new(name='BakedLight')
        mesh.data.uv_layers.active = uv
        select([mesh])
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(island_margin=.003)
        bpy.ops.object.mode_set(mode='OBJECT')
        image = bpy.data.images.new('Light '+key,1024,1024,alpha=False)
        for slot in mesh.material_slots:
            if not slot.material:
                continue
            mat = slot.material
            mat.use_nodes = True
            tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = image
            mat.node_tree.nodes.active = tex
        bpy.ops.object.bake(type='COMBINED',pass_filter={'DIRECT','INDIRECT','DIFFUSE','EMIT'},margin=2)
        outputs.append((mesh,image,uv.name))
    # Preserve the original bounce lighting until every target has been baked.
    for mesh,image,uv_name in outputs:
        image.pack()
        mat = bpy.data.materials.new(mesh.name+' light')
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        nodes.clear()
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        coords = nodes.new('ShaderNodeUVMap')
        coords.uv_map = uv_name
        emit = nodes.new('ShaderNodeEmission')
        output = nodes.new('ShaderNodeOutputMaterial')
        links = mat.node_tree.links
        links.new(coords.outputs['UV'],tex.inputs['Vector'])
        links.new(tex.outputs['Color'],emit.inputs['Color'])
        links.new(emit.outputs[0],output.inputs['Surface'])
        mesh.data.materials.clear()
        mesh.data.materials.append(mat)
