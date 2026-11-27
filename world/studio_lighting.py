"""Prepare a disposable editing scene with fixed receivers and live furniture."""
import base64
import json

import bpy
import numpy as np

from bake import bake
from model import AXIS, appearance, tagged, values, apply_web_lights


def display_lut(scene, out):
    # Sample the actual scene view/look/exposure. Lay out blue slices along X,
    # red inside a slice, green along Y. The log shaper covers linear HDR.
    size = 32
    y, x = np.indices((size, size * size))
    rgb = np.stack([x % size, y, x // size], axis=-1)
    rgba = np.ones((*x.shape, 4), dtype=np.float32)
    rgba[:, :, :3] = (np.exp2(rgb * (10 / (size - 1))) - 1) / 16
    image = bpy.data.images.new("Studio display LUT", size * size, size, float_buffer=True)
    image.pixels.foreach_set(rgba.ravel())
    settings = scene.render.image_settings
    scene.display_settings.display_device = "sRGB"
    settings.color_management = "FOLLOW_SCENE"
    settings.file_format, settings.color_mode, settings.color_depth = "PNG", "RGB", "8"
    filename = out / "studio-lut.png"
    image.save_render(str(filename), scene=scene)
    bpy.data.images.remove(image)
    return base64.b64encode(filename.read_bytes()).decode("ascii")


def panel(obj):
    orientation = AXIS.to_quaternion() @ obj.matrix_world.to_quaternion()
    scale = obj.matrix_world.to_scale()
    data = obj.data
    height = data.size_y if data.shape in {"RECTANGLE", "ELLIPSE"} else data.size
    return dict(position=values(AXIS @ obj.matrix_world.translation),
                rotation=values((orientation.x, orientation.y, orientation.z, orientation.w)),
                width=data.size * abs(scale.x), height=height * abs(scale.y),
                energy=data.energy, color=values(data.color), source=obj.get("sourceLightId"))


def prepare(scene, out, receivers):
    apply_web_lights(scene, [])
    items = tagged(scene, "itemId").values()
    hidden = {}
    cache = {}
    for item in items:
        appearance(item, {"color": "original", "finish": "original"}, cache)
        for obj in [item, *item.children_recursive]:
            hidden[obj] = obj.hide_render
            obj.hide_render = True
    field = bake(scene, out, receivers, fixed_only=True)
    for obj, previous in hidden.items():
        obj.hide_render = previous
    profile = {
        "areas": [panel(o) for o in scene.objects
                  if o.type == "LIGHT" and o.data.type == "AREA" and not o.hide_render],
        **field,
        "lut": display_lut(scene, out),
    }
    next(iter(tagged(scene, "roomId").values()))["studioLighting"] = json.dumps(profile)
