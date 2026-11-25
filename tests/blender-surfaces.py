"""Regression: a joined object's used faces, not its slot list, define the render policy."""

import sys
from collections import Counter
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "world"))
from bake import prepare_surfaces
from model import appearance
from surfaces import surface_kind

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
room = bpy.data.objects.new("Room", None)
scene.collection.objects.link(room)
room["roomId"] = "test-room"
bpy.ops.mesh.primitive_cube_add()
cube = bpy.context.object
cube.parent = room
stone, glass, fog = [bpy.data.materials.new(name) for name in ("Stone", "Glass", "Fog")]
for mat in (stone, glass, fog):
    mat.use_nodes = True
    cube.data.materials.append(mat)
# An unconnected glass shader must not stop the opaque material being baked.
stone.node_tree.nodes.new("ShaderNodeBsdfGlass")
glass.node_tree.nodes.get("Principled BSDF").inputs[
    "Transmission Weight"
].default_value = 1
tree = fog.node_tree
tree.nodes.remove(tree.nodes.get("Principled BSDF"))
tree.links.new(
    tree.nodes.new("ShaderNodeVolumePrincipled").outputs[0],
    tree.get_output_node("CYCLES").inputs["Volume"],
)
for face in cube.data.polygons:
    face.material_index = face.index % 3
hidden = cube.copy()
scene.collection.objects.link(hidden)
hidden.hide_render = True
appearance(cube, {"color": "#332211", "finish": "matte"}, {})
assert cube.material_slots[2].material == fog
bpy.ops.mesh.primitive_cube_add()
vapor = bpy.context.object
vapor.parent = room
vapor.data.materials.append(fog)

bpy.ops.mesh.primitive_cube_add()
unused = bpy.context.object
unused.parent = room
unused.data.materials.append(stone)
unused.data.materials.append(glass)
receivers = prepare_surfaces(scene)
counts = Counter()
for obj in room.children_recursive:
    if obj.type != "MESH" or obj.hide_render:
        continue
    for face in obj.data.polygons:
        kind = surface_kind(obj.material_slots[face.material_index].material)
        assert (obj in receivers) == (kind == "bake")
        counts[kind] += 1
assert counts == {"bake": 8, "live": 2}, counts
assert len(hidden.data.polygons) == 6
print(
    "Mixed-material geometry preserves opaque and glass faces and omits volume boundaries"
)
