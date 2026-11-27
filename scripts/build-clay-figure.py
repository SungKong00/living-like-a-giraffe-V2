"""Build the clay giraffe figure and its wardrobe (Blender 4.2 Python module).

    .venv/bin/python scripts/build-clay-figure.py OUT.blend [--outfit PRESET.json ...] [--views DIR]

Every --outfit adds the wearables of one preset. The .blend keeps the rig,
skin weights and one mesh per wearable, ready for posing and export.
"""

import argparse
import os
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clay_figure import body, studio  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("output", type=Path)
    parser.add_argument("--outfit", type=Path, action="append", default=[])
    parser.add_argument("--views", type=Path, help="검토용 렌더를 저장할 폴더")
    parser.add_argument("--frame", default="full", choices=sorted(studio.FRAMES))
    parser.add_argument("--wear", help="렌더에서 입힐 착용물 ID(쉼표 구분). 생략하면 모두 입힌다.")
    args = parser.parse_args()
    if args.output.suffix != ".blend":
        parser.error("출력 파일 이름은 .blend로 끝나야 합니다.")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    figure, rig, clay = body.build()
    if args.outfit:
        from clay_figure import wardrobe
        for preset in args.outfit:
            wardrobe.dress(figure, rig, clay, preset)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output.resolve()), compress=True)
    if args.views:
        worn = None if args.wear is None else set(filter(None, args.wear.split(",")))
        for obj in bpy.context.scene.objects:
            if obj.get("wearable") and worn is not None:
                obj.hide_render = obj["wearable"] not in worn
        studio.shoot(args.views, args.output.stem, frame=args.frame)


if __name__ == "__main__":
    main()
    sys.stdout.flush()
    os._exit(0)
