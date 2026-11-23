"""Run with the project bpy runtime after prepare:world."""

import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "world"))
from bake import display_texture
from model import apply, inventory, tagged, transform
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

# Shared material must never transfer ownership of a fixed floor.
floor.material_slots[0].material = bench.children[0].material_slots[0].material
fixed = tuple(floor.matrix_world.translation)
parts = [tuple(child.matrix_world.translation) for child in bench.children]
row = inventory(scene)["items"][0]
row.update(position=[3, 0, 3], rotation=[0, 0.6, 0, 0.8], scale=[2, 2, 2])
apply(scene, [row])
assert tuple(floor.matrix_world.translation) == fixed
assert all(
    tuple(child.matrix_world.translation) != prev
    for child, prev in zip(bench.children, parts)
)
assert inventory(scene)["items"][0]["rotation"] == row["rotation"]

# Two highlights above display white must still be distinguishable after Filmic.
linear = bpy.data.images.new("HDR sample", 2, 1, float_buffer=True)
linear.pixels[:] = [1, 1, 1, 1, 4, 4, 4, 1]
scene.view_settings.view_transform = "Filmic"
with TemporaryDirectory() as directory:
    atlas = display_texture(scene, linear, directory)
    assert 0 < atlas.pixels[0] < atlas.pixels[4] < 1
    assert atlas.packed_file and atlas.colorspace_settings.name == "sRGB"
    try:
        display_texture(scene, atlas, directory)
    except ValueError:
        pass
    else:
        raise AssertionError("표시용 이미지에 색 변환을 두 번 적용했습니다.")
print("HDR 밝기 차이 보존, sRGB 패킹, 중복 색 변환 거부 확인")
