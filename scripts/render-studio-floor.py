"""Render the v06 Backdrop lighting plate in the same colour space as the world."""
from pathlib import Path

import bpy

source = Path(".world/models/initial/source.blend")
bpy.ops.wm.open_mainfile(filepath=str(source.resolve()), use_scripts=False)
scene = next(scene for scene in bpy.data.scenes if scene.get("riragiWorld"))
bpy.context.window.scene = scene
for obj in scene.objects:
    if obj.type in {"MESH", "FONT", "CURVE"} and obj.name != "Backdrop":
        obj.hide_render = True

camera = scene.camera
camera.location = (32, 24, 120)
camera.rotation_euler = (0, 0, 0)
camera.data.type = "ORTHO"
camera.data.ortho_scale = 240
camera.data.clip_end = 500
scene.render.resolution_x = scene.render.resolution_y = 768
scene.render.resolution_percentage = 100
scene.cycles.samples = 8
scene.cycles.device = "CPU"
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 89
scene.render.filepath = str(Path("web/public/images/studio-floor.jpg").resolve())
bpy.ops.render.render(write_still=True)
