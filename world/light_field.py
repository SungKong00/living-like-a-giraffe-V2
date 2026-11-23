"""Sample directional diffuse light in the empty room using the same Cycles scene."""
import bpy
import numpy as np
from mathutils import Vector

from model import AXIS, select, values

GRID = 6
TILE = 4
AXES = [(1,0,0), (-1,0,0), (0,1,0), (0,-1,0), (0,0,1), (0,0,-1)]


def capture(scene, rooms):
    # Each tiny patch samples one signed world axis. One bake covers all rooms.
    vertices, faces, fields = [], [], {}
    for key, room in rooms.items():
        bounds = np.array([tuple(AXIS @ (o.matrix_world @ Vector(corner)))
                           for o in room.children_recursive if o.type == "MESH" and not o.hide_render
                           for corner in o.bound_box])
        if not bounds.size:
            bounds = np.array([tuple(AXIS @ room.matrix_world.translation)])
        lo, hi = bounds.min(axis=0), bounds.max(axis=0)
        inset = (hi-lo) / (2*GRID)
        lo_x, lo_z = (lo+inset)[[0,2]]
        hi_x, hi_z = (hi-inset)[[0,2]]
        height = (AXIS @ room.matrix_world.translation).y + 1
        fields[key] = dict(min=[lo_x,lo_z], max=[hi_x,hi_z], size=GRID, samples=[])
        for z in np.linspace(lo_z, hi_z, GRID):
            for x in np.linspace(lo_x, hi_x, GRID):
                for axis in AXES:
                    normal = Vector(axis)
                    u = normal.orthogonal().normalized() * 0.012
                    v = normal.cross(u)
                    start = len(vertices)
                    for offset in [-u-v, u-v, u+v, -u+v]:
                        vertices.append(AXIS.inverted() @ (Vector((x,height,z)) + 0.02*normal + offset))
                    faces.append(range(start, start+4))
    mesh = bpy.data.meshes.new("Studio probes")
    mesh.from_pydata(vertices, [], faces)
    obj = bpy.data.objects.new("Studio probes", mesh)
    scene.collection.objects.link(obj)
    obj.visible_shadow = obj.visible_diffuse = obj.visible_glossy = False
    uv = mesh.uv_layers.new()
    columns = 32
    rows = (len(faces) + columns-1) // columns
    for face in mesh.polygons:
        x, y = face.index % columns, face.index // columns
        for loop, (u,v) in zip(face.loop_indices, [(0,0),(1,0),(1,1),(0,1)]):
            uv.data[loop].uv = ((x+u)/columns,(y+v)/rows)
    mat = bpy.data.materials.new("Studio white diffuse")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    diffuse = nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = (1,1,1,1)
    mat.node_tree.links.new(diffuse.outputs[0], nodes.get("Material Output").inputs["Surface"])
    image = bpy.data.images.new("Studio samples", columns*TILE, rows*TILE, float_buffer=True)
    target = nodes.new("ShaderNodeTexImage")
    target.image = image
    nodes.active = target
    mesh.materials.append(mat)
    select([obj])
    samples = scene.cycles.samples
    scene.cycles.samples = 32
    try:
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT","INDIRECT","COLOR"}, margin=0)
    finally:
        scene.cycles.samples = samples
    pixels = np.empty(columns*TILE*rows*TILE*4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(rows*TILE, columns*TILE, 4)
    ordered = list(fields.values())
    for i in range(len(faces)):
        x,y = i%columns*TILE, i//columns*TILE
        sample = pixels[y+1:y+3, x+1:x+3, :3].mean(axis=(0,1))
        ordered[i//(GRID*GRID*6)]["samples"].extend(values(sample.tolist()))
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    bpy.data.materials.remove(mat)
    bpy.data.images.remove(image)
    return fields
