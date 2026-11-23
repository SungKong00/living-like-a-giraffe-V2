"""Run with the project bpy runtime after prepare:world."""

import sys
from pathlib import Path
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "world"))
from model import inventory, tagged, transform
from worker import load

scene = load(Path(".world/models/initial/source.blend"))
bench = tagged(scene, "itemId")["sauna-bench"]
room = bench.parent
floor = scene.objects["Sauna_Floor"]
assert floor not in bench.children_recursive and len(bench.children) == 2
relative = transform(bench.matrix_local)
room.rotation_euler.z += 0.7
bpy.context.view_layer.update()
assert inventory(scene)["items"][0]["position"] == relative["position"]


def invalid(change, restore, expected):
    change()
    try:
        inventory(scene)
        raise AssertionError("잘못된 인계가 승인되었습니다")
    except ValueError as error:
        assert expected in str(error), str(error)
    finally:
        restore()


invalid(
    lambda: bench.__setitem__("itemId", ""),
    lambda: bench.__setitem__("itemId", "sauna-bench"),
    bench.name,
)
other = bench.copy()
scene.collection.objects.link(other)
invalid(lambda: None, lambda: bpy.data.objects.remove(other, do_unlink=True), "중복")
invalid(
    lambda: setattr(bench, "parent", None),
    lambda: setattr(bench, "parent", room),
    bench.name,
)
print("방 회전, 편집 경계, 빈 ID·중복·방 누락 검사 통과")
