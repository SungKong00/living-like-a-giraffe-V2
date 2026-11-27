"""Make an editable biped outfit from the wardrobe master and a JSON recipe."""

import argparse
import json
import math
import os
from pathlib import Path
import re
import sys

import bpy


MASTER = Path(__file__).resolve().parents[1] / "assets-source/characters/riragi-clay/riragi-biped-suit.blend"


def style_piece(obj, options):
    unknown = set(options) - {"id", "label", "fit", "hide"}
    if unknown:
        raise ValueError(f"{obj.name}: unknown options {sorted(unknown)}")
    identity = options.get("id", obj["wearable"])
    if not isinstance(identity, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,39}", identity):
        raise ValueError(f"Invalid wearable ID: {identity!r}")
    label = options.get("label", obj["label"])
    if not isinstance(label, str) or not label.strip() or len(label) > 40:
        raise ValueError(f"{identity}: expected a label of 1–40 characters")

    shape_keys = obj.data.shape_keys
    controls = {}
    if shape_keys:
        controls = {k.name: k for k in shape_keys.key_blocks if k != shape_keys.reference_key}
    fit = options.get("fit", {})
    if not isinstance(fit, dict):
        raise ValueError(f"{identity}.fit: expected a mapping from control names to numbers")
    for name, value in fit.items():
        key = controls.get(name)
        if key is None:
            raise ValueError(f"{identity}: unknown fit {name!r}, available: {sorted(controls)}")
        if type(value) not in (int, float) or not math.isfinite(value) or not key.slider_min <= value <= key.slider_max:
            raise ValueError(f"{identity}.{name}: expected {key.slider_min} to {key.slider_max}")
        key.value = value
    if "hide" in options:
        trims = {m.name[5:]: m for m in obj.modifiers if m.type == "MASK" and m.name.startswith("Trim.")}
        hidden = options["hide"]
        if not isinstance(hidden, list) or not all(isinstance(item, str) and item in trims for item in hidden):
            raise ValueError(f"{identity}.hide: choose from {sorted(trims)}")
        for name, modifier in trims.items():
            modifier.show_viewport = modifier.show_render = name in hidden

    obj["wearable"], obj["label"] = identity, label
    obj.name = "Wear." + identity


def make_variant(source, recipe, output):
    if output.suffix.lower() != ".blend" or output.resolve() in {MASTER.resolve(), source.resolve()}:
        raise ValueError("Choose a separate .blend output for the variant.")
    changes = json.loads(recipe.read_text(encoding="utf-8"))
    if not isinstance(changes, dict) or not changes:
        raise ValueError("Expected one or more wardrobe source IDs in the recipe.")
    bpy.ops.wm.open_mainfile(filepath=str(source.resolve()), use_scripts=False, load_ui=False)
    pieces = {obj["wardrobe_source"]: obj for obj in bpy.context.scene.objects if obj.get("wardrobe_source")}
    for name, options in changes.items():
        if name not in pieces or not isinstance(options, dict):
            raise ValueError(f"Invalid recipe entry {name!r}. Available pieces: {sorted(pieces)}")
        style_piece(pieces[name], options)
    if len({obj["wearable"] for obj in pieces.values()}) != len(pieces):
        raise ValueError("Every item in the outfit needs a distinct wearable ID.")
    # Blender may temporarily suffix a name when two items exchange IDs.
    for obj in pieces.values():
        obj.name = "Wear." + obj["wearable"]
    bpy.context.view_layer.update()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()), compress=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recipe", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", type=Path, default=MASTER)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    make_variant(args.source, args.recipe, args.output)
    sys.stdout.flush()
    os._exit(0)
