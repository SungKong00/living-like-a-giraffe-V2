"""Edit native light objects in place; never reconstruct the artist's rig."""
from hashlib import sha256
import math

import bpy
from mathutils import Matrix, Quaternion, Vector
from model import AXIS, linear, srgb_byte, tagged, values


def sources(scene):
    for obj in scene.objects:
        if (obj.type != "LIGHT" or obj.data.type not in {"POINT", "SPOT", "AREA"}
                or "webLightId" in obj or obj.library or obj.constraints
                or obj.animation_data or obj.data.animation_data or obj.data.use_nodes):
            continue
        if "sourceLightId" not in obj:
            # Unmarked historical files get the same initial identity on every
            # load. The first complete handoff persists it across later renames.
            obj["sourceLightId"] = "native-" + sha256(obj.name.encode()).hexdigest()[:24]
    return {key: obj for key, obj in tagged(scene, "sourceLightId").items()
            if obj.type == "LIGHT" and not obj.constraints and not obj.animation_data
            and not obj.data.animation_data and not obj.data.use_nodes and not obj.library
            and obj.data.type in {"POINT", "SPOT", "AREA"} and "webLightId" not in obj}


def anchor(obj):
    parent = obj.parent
    while parent and "roomId" not in parent:
        parent = parent.parent
    return parent


def inventory(scene):
    rows = []
    for key, obj in sources(scene).items():
        room = anchor(obj)
        local = room.matrix_world.inverted() @ obj.matrix_world if room else obj.matrix_world
        lamp = obj.data
        shape = dict(type=lamp.type.lower())
        if lamp.type != "POINT":
            q = (AXIS.to_quaternion() @ local.to_quaternion()).normalized()
            if q.w < 0:
                q.negate()
            shape["rotation"] = values((q.x, q.y, q.z, q.w))
        if lamp.type == "AREA":
            height = lamp.size_y if lamp.shape in {"RECTANGLE", "ELLIPSE"} else lamp.size
            scale = local.to_scale()
            shape.update(width=lamp.size * abs(scale.x), height=height * abs(scale.y),
                         form=lamp.shape.lower())
        elif lamp.type == "SPOT":
            shape.update(angle=math.degrees(lamp.spot_size), blend=lamp.spot_blend)
        rows.append(dict(id=key, label=obj.name, room=room["roomId"] if room else None,
                         position=values(AXIS @ local.translation), shape=shape,
                         energy=round(lamp.energy, 4), enabled=not obj.hide_render,
                         color="#" + "".join(f"{srgb_byte(c):02x}" for c in lamp.color)))
    return rows


def apply(scene, edits):
    lights = sources(scene)
    for edit in edits:
        obj = lights[edit["id"]]
        if "energy" in edit or "color" in edit:
            if obj.data.users > 1:
                obj.data = obj.data.copy()
            if "energy" in edit:
                obj.data.energy = edit["energy"]
            if "color" in edit:
                obj.data.color = [linear(int(edit["color"][i:i+2], 16)/255) for i in (1, 3, 5)]
        if "enabled" in edit:
            obj.hide_render = not edit["enabled"]
        if "position" in edit or "rotation" in edit:
            room = anchor(obj)
            frame = room.matrix_world if room else Matrix.Identity(4)
            local = frame.inverted() @ obj.matrix_world
            if "rotation" in edit:
                x, y, z, w = edit["rotation"]
                q = AXIS.to_quaternion().inverted() @ Quaternion((w, x, y, z)).normalized()
                local = Matrix.LocRotScale(local.translation, q, local.to_scale())
            if "position" in edit:
                local.translation = AXIS.inverted() @ Vector(edit["position"])
            obj.matrix_world = frame @ local
    bpy.context.view_layer.update()
