"""Blender adapter. All persistent transforms are room-local, in glTF axes."""

import math
import re

import bpy
from mathutils import Matrix, Vector, Quaternion

AXIS = Matrix.Rotation(-math.pi / 2, 4, "X")
ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}\Z")
ROOMS = [
    ("sauna", "멘탈 사우나", (12, 36)),
    ("sports", "운동회", (48, 36)),
    ("supporters", "후원자의 방", (12, 12)),
    ("vintage", "빈티지 숍", (36, 12)),
]


def empty(scene, name):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    return obj


def parent_at(obj, parent):
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def bootstrap(scene):
    """Only the original v06 import relies on collection and object names."""
    original = list(scene.objects)
    for index, (key, title, center) in enumerate(ROOMS, 1):
        room = empty(scene, title)
        room["roomId"] = key
        room["label"] = title
        room.location = (*center, 0)
        bpy.context.view_layer.update()
        for obj in original:
            if any(
                c.name.startswith(f"{index:02}_")
                or (index == 1 and c.name.startswith("06_Sauna"))
                for c in obj.users_collection
            ):
                if obj.parent is None:
                    parent_at(obj, room)
        if index == 1:
            bench = empty(scene, "서쪽 나무 벤치")
            bench.parent = room
            bench.location = (-10, -1.4, 0)
            bench["itemId"] = "sauna-bench"
            bench["kind"] = "tier-bench"
            bench["label"] = "나무 벤치"
            bpy.context.view_layer.update()
            for name in ("West_Bench_Tier_0", "West_Bench_Tier_1"):
                parent_at(scene.objects[name], bench)
    scene["riragiWorld"] = True


def values(values):
    return [round(x, 5) for x in values]


def transform(matrix):
    p, q, s = (AXIS @ matrix @ AXIS.inverted()).decompose()
    return dict(
        position=values(p), rotation=values((q.x, q.y, q.z, q.w)), scale=values(s)
    )


def apply_transform(obj, value):
    x, y, z, w = value["rotation"]
    matrix = Matrix.LocRotScale(
        Vector(value["position"]), Quaternion((w, x, y, z)), Vector(value["scale"])
    )
    obj.matrix_basis = AXIS.inverted() @ matrix @ AXIS


def tagged(scene, prop):
    result = {}
    for obj in scene.objects:
        if prop not in obj:
            continue
        key = obj[prop]
        if not isinstance(key, str) or not ID.fullmatch(key) or key in result:
            raise ValueError(f"{obj.name}: {prop} 누락 또는 중복 ({key})")
        result[key] = obj
    return result


def area_lights(scene):
    return [
        dict(
            position=values(AXIS @ obj.matrix_world.translation),
            color=values(obj.data.color),
            energy=round(obj.data.energy, 3),
            size=round(obj.data.size, 3),
        )
        for obj in scene.objects
        if obj.type == "LIGHT" and obj.data.type == "AREA"
    ]


def srgb_byte(value):
    channel = 12.92 * value if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055
    return round(255 * min(1, max(0, channel)))


def web_lights(scene):
    result = []
    for key, obj in tagged(scene, "webLightId").items():
        if (
            obj.type != "LIGHT" or obj.data.type not in {"POINT", "SPOT", "AREA"}
            or not obj.parent or "roomId" not in obj.parent
        ):
            raise ValueError(f"{obj.name}: 웹 조명의 방과 종류를 확인하세요")
        lamp = obj.data
        shape = {"type": lamp.type.lower()}
        if lamp.type != "POINT":
            q = (AXIS.to_quaternion() @ obj.matrix_local.to_quaternion()).normalized()
            if q.w < 0:
                q.negate()
            shape["rotation"] = values((q.x, q.y, q.z, q.w))
        if lamp.type == "SPOT":
            shape.update(angle=round(math.degrees(lamp.spot_size), 4), blend=round(lamp.spot_blend, 5))
        elif lamp.type == "AREA":
            if lamp.shape not in {"RECTANGLE", "SQUARE"}:
                raise ValueError(f"{obj.name}: 웹 면광원은 직사각형 또는 정사각형으로 지정하세요")
            scale = obj.matrix_local.to_scale()
            height = lamp.size_y if lamp.shape == "RECTANGLE" else lamp.size
            shape.update(width=round(lamp.size * abs(scale.x), 5), height=round(height * abs(scale.y), 5))
        result.append(dict(
            id=key,
            label=obj.get("label", obj.name),
            room=obj.parent["roomId"],
            position=values(AXIS @ obj.matrix_local.translation),
            color="#" + "".join(f"{srgb_byte(c):02x}" for c in obj.data.color),
            energy=round(obj.data.energy, 4), enabled=not obj.hide_render, shape=shape,
        ))
    return result


def apply_web_lights(scene, lights):
    rooms = tagged(scene, "roomId")
    existing = tagged(scene, "webLightId")
    for light in lights:
        shape = light.get("shape", {"type": "point"})
        kind = shape["type"].upper()
        obj = existing.pop(light["id"], None)
        if obj is None:
            lamp = bpy.data.lights.new(light["label"], kind)
            obj = bpy.data.objects.new(light["label"], lamp)
            scene.collection.objects.link(obj)
            obj["webLightId"] = light["id"]
        obj.parent = rooms[light["room"]]
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.location = AXIS.inverted() @ Vector(light["position"])
        obj["label"] = light["label"]
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        obj.data.type = kind
        obj.hide_render = not light.get("enabled", True)
        obj.hide_viewport = obj.hide_render
        if kind != "POINT":
            x, y, z, w = shape["rotation"]
            obj.rotation_mode = "QUATERNION"
            obj.rotation_quaternion = AXIS.to_quaternion().inverted() @ Quaternion((w, x, y, z)).normalized()
            obj.scale = (1, 1, 1)
        if kind == "SPOT":
            obj.data.spot_size = math.radians(shape["angle"])
            obj.data.spot_blend = shape["blend"]
        if kind == "AREA":
            obj.data.shape = "RECTANGLE"
            obj.data.size, obj.data.size_y = shape["width"], shape["height"]
        obj.data.color = [
            linear(int(light["color"][i:i + 2], 16) / 255) for i in (1, 3, 5)
        ]
        obj.data.energy = light["energy"]
    for obj in existing.values():
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()


def inventory(scene):
    rooms = tagged(scene, "roomId")
    items = []
    options = {}
    for key, obj in tagged(scene, "itemId").items():
        if obj.parent not in rooms.values() or not ID.fullmatch(obj.get("kind", "")):
            raise ValueError(f"{obj.name}: 방 부모 또는 가구 종류 확인")
        if key in rooms:
            raise ValueError(f"{obj.name}: 방과 가구 ID가 겹칩니다")
        colors = [c.strip().lower() for c in obj.get("webColors", "*").split(",")]
        finishes = [
            v.strip()
            for v in obj.get("webFinishes", "matte,gloss").split(",")
            if v.strip()
        ]
        if any(
            not re.fullmatch(r"\*|original|#[0-9a-f]{6}", c) for c in colors
        ) or not set(finishes) <= {"original", "matte", "gloss"}:
            raise ValueError(f"{obj.name}: 색 또는 표면 허용값을 확인하세요")
        allowed = dict(
            colors=list(dict.fromkeys(["original", *colors])),
            finishes=list(dict.fromkeys(["original", *finishes])),
        )
        if options.setdefault(obj["kind"], allowed) != allowed:
            raise ValueError(f"{obj.name}: 같은 가구 종류의 옵션이 다릅니다")
        items.append(
            dict(
                id=key,
                kind=obj["kind"],
                label=obj.get("label", obj.name),
                room=obj.parent["roomId"],
                color=obj.get("color", "original"),
                finish=obj.get("finish", "original"),
                **transform(obj.matrix_local),
            )
        )
    if not rooms:
        raise ValueError("방 기준점이 없습니다.")
    return dict(
        lights=area_lights(scene),
        webLights=web_lights(scene),
        options=options,
        rooms=[
            dict(id=k, label=o.get("label", o.name), **transform(o.matrix_world))
            for k, o in rooms.items()
        ],
        items=items,
    )


def duplicate(source, parent):
    copy = source.copy()
    bpy.context.scene.collection.objects.link(copy)
    copy.parent = parent
    for child in source.children:
        duplicate(child, copy)
    return copy


def linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def appearance(obj, item, cache):
    color, finish = item["color"], item["finish"]
    for part in [obj, *obj.children_recursive]:
        for slot in part.material_slots:
            current = slot.material
            if not current:
                continue
            base = bpy.data.materials.get(current.get("riragiBase", "")) or current
            key = (base.name, color, finish)
            if key not in cache:
                material = base
                if color != "original" or finish != "original":
                    base.use_fake_user = True
                    material = base.copy()
                    material["riragiBase"] = base.name
                    shader = (
                        next(
                            (
                                n
                                for n in material.node_tree.nodes
                                if n.type == "BSDF_PRINCIPLED"
                            ),
                            None,
                        )
                        if material.use_nodes
                        else None
                    )
                    if not shader:
                        raise ValueError(
                            f"{base.name}: 옵션에 사용할 Principled 재질 필요"
                        )
                    if color != "original":
                        shader.inputs["Base Color"].default_value = [
                            linear(int(color[i : i + 2], 16) / 255) for i in (1, 3, 5)
                        ] + [1]
                    if finish != "original":
                        shader.inputs["Roughness"].default_value = (
                            0.88 if finish == "matte" else 0.22
                        )
                cache[key] = material
            slot.link = "OBJECT"
            slot.material = cache[key]
    obj["color"], obj["finish"] = color, finish


def apply(scene, items):
    rooms = tagged(scene, "roomId")
    existing = tagged(scene, "itemId")
    templates = {o["kind"]: o for o in existing.values()}
    cache = {}
    for item in items:
        key = item["id"]
        obj = existing.get(key)
        if obj is None:
            obj = duplicate(templates[item["kind"]], rooms[item["room"]])
            obj["itemId"] = key
        obj.parent = rooms[item["room"]]
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj["label"] = item["label"]
        apply_transform(obj, item)
        appearance(obj, item, cache)
    keep = {i["id"] for i in items}
    for key, obj in existing.items():
        if key not in keep:
            for child in reversed(obj.children_recursive):
                bpy.data.objects.remove(child, do_unlink=True)
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()


def wrap_mesh_anchors(scene):
    # Geometry compression may change a mesh node's local transform. Give its
    # logical ID an independent transform before touching the derived mesh.
    for obj in list(scene.objects):
        if obj.type == "EMPTY" or not ("itemId" in obj or "roomId" in obj):
            continue
        root = empty(scene, obj.name + " anchor")
        root.parent = obj.parent
        root.matrix_basis = obj.matrix_local.copy()
        for key in ("itemId", "roomId", "label", "kind", "color", "finish"):
            if key in obj:
                root[key] = obj[key]
                del obj[key]
        children = list(obj.children)
        obj.parent = root
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_basis = Matrix.Identity(4)
        for child in children:
            child.parent = root
        bpy.context.view_layer.update()


def select(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def export_glb(scene, path):
    rooms = tagged(scene, "roomId")
    objects = [o for r in rooms.values() for o in [r, *r.children_recursive]]
    select([o for o in objects if not (o.type == "LIGHT" and o.hide_render)])
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        use_selection=True,
        export_extras=True,
        export_lights=True,
        export_animations=False,
        export_apply=True,
    )
