"""Copy the `clay_protect` vertex group of character meshes into `_CLAY_PROTECT`.

The studio keeps vertices with this float attribute (0-1) out of the clay
look, so a character's eyes, mouth and fittings stay as modelled. glTF does
not carry vertex groups, so the weights are copied to a point attribute that
the glTF exporter writes when "Data > Mesh > Attributes" is on.

In Blender: paint a `clay_protect` vertex group (weight 1 = keep as is), run
this script from the Text Editor, then export with Attributes enabled.

From the project root, for a saved file (writes <name>.glb beside it):

    .venv/bin/python scripts/clay-protect-attribute.py path/to/character.blend
"""
import sys
from pathlib import Path

import bpy

GROUP = "clay_protect"
ATTRIBUTE = "_CLAY_PROTECT"


def copy_weights(obj):
    group = obj.vertex_groups.get(GROUP)
    if obj.type != "MESH" or group is None:
        return False
    mesh = obj.data
    if ATTRIBUTE in mesh.attributes:
        mesh.attributes.remove(mesh.attributes[ATTRIBUTE])
    values = mesh.attributes.new(ATTRIBUTE, "FLOAT", "POINT").data
    for vertex in mesh.vertices:
        weight = 0.0
        for element in vertex.groups:
            if element.group == group.index:
                weight = element.weight
        values[vertex.index].value = weight
    return True


def main():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    blend = next((Path(a) for a in args if a.endswith(".blend")), None)
    if blend:
        bpy.ops.wm.open_mainfile(filepath=str(blend.resolve()), use_scripts=False)
    marked = [obj.name for obj in bpy.data.objects if copy_weights(obj)]
    print(f"{ATTRIBUTE}: {', '.join(marked) if marked else 'no mesh has ' + GROUP}")
    if blend:
        bpy.ops.export_scene.gltf(
            filepath=str(blend.with_suffix(".glb").resolve()),
            export_format="GLB",
            export_attributes=True,
            export_extras=True,
            export_animations=True,
            export_skins=True,
        )


main()
