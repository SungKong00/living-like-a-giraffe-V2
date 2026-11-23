import json
import os
import sys
from pathlib import Path

import bpy
from model import apply, apply_web_lights, bootstrap, export_glb, inventory, wrap_mesh_anchors


def load(path):
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.open_mainfile(filepath=str(path.resolve()), use_scripts=False)
    for data in [
        *bpy.data.images,
        *bpy.data.libraries,
        *bpy.data.sounds,
        *bpy.data.fonts,
    ]:
        if data.filepath and data.filepath != "<builtin>" and not data.packed_file:
            raise ValueError(f"외부 자원을 패킹하세요: {data.filepath}")
    scenes = [s for s in bpy.data.scenes if s.get("riragiWorld")]
    if len(scenes) != 1:
        raise ValueError("riragiWorld 장면이 하나 필요합니다.")
    bpy.context.window.scene = scenes[0]
    return scenes[0]


def save(path):
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(path.resolve()), compress=True)


def run(command, source, out, request=None):
    out.mkdir(parents=True, exist_ok=True)
    if command == "bootstrap":
        bpy.ops.wm.open_mainfile(filepath=str(source.resolve()), use_scripts=False)
        scene = bpy.data.scenes["01_Clay_Normal"]
        bpy.context.window.scene = scene
        bootstrap(scene)
        save(out / "source.blend")
    else:
        scene = load(source)
    manifest = inventory(scene)
    if request:
        data = json.loads(request.read_text())
        apply(scene, data["items"])
        apply_web_lights(scene, data.get("lights", []))
        scene["handoff"] = data["handoff"]
    if command == "download":
        save(out / "world.blend")
        inventory(load(out / "world.blend"))
    elif command == "publish":
        from bake import bake

        wrap_mesh_anchors(scene)
        bake(scene, out)
        export_glb(scene, out / "raw.glb")
    else:
        manifest["handoff"] = scene.get("handoff", "")
        (out / "catalog.json").write_text(json.dumps(manifest, ensure_ascii=False))
        # The editable scene builds web lights from the draft.
        apply_web_lights(scene, [])
        # Merge fixed surfaces only inside their owner's local space.
        from bake import render_meshes
        from model import tagged, appearance

        wrap_mesh_anchors(scene)
        cache = {}
        for item in tagged(scene, "itemId").values():
            appearance(item, {"color": "original", "finish": "original"}, cache)

        for room in tagged(scene, "roomId").values():
            fixed = [
                obj
                for obj in room.children_recursive
                if obj.type in {"MESH", "FONT", "CURVE"}
                and not any("itemId" in parent for parent in [obj, *ancestors(obj)])
            ]
            if fixed:
                render_meshes(fixed, room)
        export_glb(scene, out / "raw.glb")


def ancestors(obj):
    while obj.parent:
        obj = obj.parent
        yield obj


if __name__ == "__main__":
    import resource

    resource.setrlimit(resource.RLIMIT_CPU, (900, 910))
    cmd, source, out, *extra = sys.argv[1:]
    run(cmd, Path(source), Path(out), Path(extra[0]) if extra else None)
    # bpy embeds native render threads. Exit only after all synchronous writes succeed.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)
