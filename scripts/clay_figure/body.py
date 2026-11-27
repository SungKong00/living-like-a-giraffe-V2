"""The standing clay giraffe: proportions, skin, face, mane and skeleton.

Blender axes: the figure faces -Y, +Z is up, `.L` parts are on +X, the soles
rest on Z = 0. Bone and socket names follow the studio's giraffe contract
(shared/giraffe-proportions.mjs, web/giraffe-proportions.js) so the studio's
body sliders, wearables and sockets work on this model unchanged.
"""

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from . import scene
from .loft import TAU, Loft, smoothstep

PALETTE = {
    "ochre": "#E9BC85",
    "spot": "#C98041",
    "cream": "#F4E3C3",
    "hoof": "#7A4A33",
    "pink": "#EDA89D",
    "mane": "#A5602F",
    "ink": "#1C1513",
    "white": "#FFF9F0",
    "line": "#5B3423",
}

# Atlas regions as (x, y, width, height, margin). Strips that do not span the
# whole image repeat their edge columns into a margin so seam faces can unroll.
REGIONS = {
    "trunk": (0.0, 0.42, 1.0, 0.58, 0.0),
    "head": (0.0, 0.08, 0.5, 0.32, 0.1),
    "arm": (0.5, 0.08, 0.25, 0.32, 0.1),
    "leg": (0.75, 0.08, 0.25, 0.32, 0.1),
}
ATLAS = 1024


def swatch(name):
    index = list(PALETTE).index(name)
    return ((index + 0.5) / len(PALETTE), 0.03)


def atlas_uv(region, u, angle):
    x, y, w, h, margin = REGIONS[region]
    inner = w * (1 - 2 * margin)
    return x + w * margin + angle / TAU * inner, y + u * h


def mirror(stations):
    return [dict(s, p=(-s["p"][0], s["p"][1], s["p"][2])) for s in stations]


def flip(point):
    return np.array([-point[0], point[1], point[2]])


class Figure:
    """Proportions of the figure. Lengths are metres; the model is 3.5 m to the horn tips."""

    def __init__(self):
        self.trunk = Loft([
            dict(p=(0, 0.004, 0.985), rx=0.190, ryf=0.155, ryb=0.165, n=2.2),
            dict(p=(0, 0.004, 1.090), rx=0.250, ryf=0.198, ryb=0.215, n=2.3),
            dict(p=(0, 0.002, 1.300), rx=0.232, ryf=0.200, ryb=0.182, n=2.3),
            dict(p=(0, 0.000, 1.520), rx=0.244, ryf=0.208, ryb=0.190, n=2.3),
            dict(p=(0, 0.000, 1.690), rx=0.240, ryf=0.188, ryb=0.180, n=2.2),
            dict(p=(0, -0.002, 1.800), rx=0.208, ryf=0.170, ryb=0.170, n=2.1),
            dict(p=(0, -0.006, 1.900), rx=0.176, ry=0.168),
            dict(p=(0, -0.016, 2.060), rx=0.160, ry=0.160),
            dict(p=(0, -0.046, 2.420), rx=0.148, ry=0.148),
            dict(p=(0, -0.086, 2.760), rx=0.140, ry=0.140),
            dict(p=(0, -0.118, 2.990), rx=0.134, ry=0.134),
        ])
        self.shoulder = np.array([0.262, 0.000, 1.745])
        self.elbow = np.array([0.326, 0.006, 1.430])
        self.wrist = np.array([0.352, -0.024, 1.120])
        self.hand_tip = np.array([0.357, -0.040, 0.950])
        arm = [
            dict(p=self.shoulder, rx=0.086),
            dict(p=self.elbow, rx=0.076),
            dict(p=self.wrist, rx=0.068),
            dict(p=self.wrist + (self.hand_tip - self.wrist) * 0.3, rx=0.062),
        ]
        self.hip = np.array([0.140, 0.004, 1.070])
        self.knee = np.array([0.150, -0.012, 0.620])
        self.ankle = np.array([0.155, 0.000, 0.240])
        self.toe = np.array([0.155, -0.130, 0.030])
        leg = [
            dict(p=self.hip, rx=0.135, ry=0.138),
            dict(p=self.knee, rx=0.112),
            dict(p=self.ankle, rx=0.094),
            dict(p=self.ankle - (0, 0, 0.10), rx=0.088),
        ]
        self.arms = {"L": Loft(arm), "R": Loft(mirror(arm))}
        self.legs = {"L": Loft(leg), "R": Loft(mirror(leg))}
        # The head runs from the back of the skull to the tip of the muzzle;
        # `ryf` is the underside (jaw), `ryb` the crown.
        self.head = Loft([
            dict(p=(0, 0.050, 3.152), rx=0.165, ryf=0.170, ryb=0.162),
            dict(p=(0, -0.020, 3.155), rx=0.200, ryf=0.205, ryb=0.195),
            dict(p=(0, -0.140, 3.150), rx=0.222, ryf=0.215, ryb=0.210),
            dict(p=(0, -0.250, 3.125), rx=0.205, ryf=0.195, ryb=0.185),
            dict(p=(0, -0.335, 3.075), rx=0.172, ryf=0.150, ryb=0.128),
            dict(p=(0, -0.420, 3.040), rx=0.165, ryf=0.135, ryb=0.115),
            dict(p=(0, -0.485, 3.015), rx=0.150, ryf=0.118, ryb=0.104),
        ])
        self.ear_root = np.array([0.166, -0.100, 3.272])
        self.ear_tip = np.array([0.435, -0.085, 3.372])
        # Coats and jackets hang from the hips instead of following the crotch.
        hang = self.trunk.values[1:]
        self.drape = Loft(
            [dict(p=(0, 0.004, 0.30), rx=0.292, ryf=0.218, ryb=0.232, n=2.3),
             dict(p=(0, 0.004, 0.985), rx=0.286, ryf=0.214, ryb=0.228, n=2.3)]
            + [dict(p=v[:3], rx=v[3], ryf=v[4], ryb=v[5], n=v[6]) for v in hang])
        self.tail = np.array([(0, 0.170, 1.230), (0, 0.262, 1.100), (0, 0.290, 0.900), (0, 0.280, 0.740)])

        def neck(z):
            return self.trunk.sample(self.trunk.at_z(z))[0][:3]

        self.joints = {
            "Root": ((0, 0, 0), (0, 0, 0.2)),
            "Pelvis": (neck(1.07), neck(1.28)),
            "Spine": (neck(1.28), neck(1.52)),
            "Chest": (neck(1.52), neck(1.88)),
            "Neck.01": (neck(1.88), neck(2.24)),
            "Neck.02": (neck(2.24), neck(2.60)),
            "Neck.03": (neck(2.60), neck(2.94)),
            "Head": (neck(2.94), (0, -0.40, 3.05)),
            "Muzzle": ((0, -0.300, 3.090), (0, -0.560, 3.000)),
            "Tail.01": (self.tail[0], self.tail[2]),
            "Tail.02": (self.tail[2], (0, 0.275, 0.600)),
        }
        for side, sign in (("L", 1), ("R", -1)):
            def s(p):
                return np.array(p) * (sign, 1, 1)
            self.joints.update({
                "Ear." + side: (s(self.ear_root), s(self.ear_tip)),
                "Arm.Upper." + side: (s(self.shoulder), s(self.elbow)),
                "Arm.Lower." + side: (s(self.elbow), s(self.wrist)),
                "Arm.Hoof." + side: (s(self.wrist), s(self.hand_tip)),
                "Hind.Upper." + side: (s(self.hip), s(self.knee)),
                "Hind.Lower." + side: (s(self.knee), s(self.ankle)),
                "Hind.Hoof." + side: (s(self.ankle), s(self.toe)),
            })
        self.parents = {
            "Pelvis": "Root", "Spine": "Pelvis", "Chest": "Spine", "Neck.01": "Chest",
            "Neck.02": "Neck.01", "Neck.03": "Neck.02", "Head": "Neck.03", "Muzzle": "Head",
            "Tail.01": "Pelvis", "Tail.02": "Tail.01",
        }
        for side in "LR":
            self.parents.update({
                "Ear." + side: "Head",
                "Arm.Upper." + side: "Chest", "Arm.Lower." + side: "Arm.Upper." + side,
                "Arm.Hoof." + side: "Arm.Lower." + side,
                "Hind.Upper." + side: "Pelvis", "Hind.Lower." + side: "Hind.Upper." + side,
                "Hind.Hoof." + side: "Hind.Lower." + side,
            })

        j = self.joints
        spine = ["Spine", "Chest", "Neck.01", "Neck.02", "Neck.03", "Head"]
        self.skin = {
            "trunk": scene.Chain(
                ["Pelvis"] + spine,
                [j[b][0] for b in spine] + [np.array(j["Head"][0]) + (0, 0, 0.3)],
                [0.08, 0.08, 0.10, 0.10, 0.10, 0.05],
            ),
            "tail": scene.Chain(["Pelvis", "Tail.01", "Tail.02"],
                                [self.tail[0], self.tail[2], j["Tail.02"][1]], [0.04, 0.06]),
        }
        for side in "LR":
            arm_bones = ["Arm.Upper." + side, "Arm.Lower." + side, "Arm.Hoof." + side]
            self.skin["arm." + side] = scene.Chain(
                ["Chest"] + arm_bones, [j[b][0] for b in arm_bones] + [j[arm_bones[-1]][1]], [0.07, 0.06, 0.03])
            leg_bones = ["Hind.Upper." + side, "Hind.Lower." + side, "Hind.Hoof." + side]
            ankle = np.array(j[leg_bones[-1]][0])
            self.skin["leg." + side] = scene.Chain(
                ["Pelvis"] + leg_bones, [j[b][0] for b in leg_bones] + [ankle - (0, 0, 0.2)], [0.09, 0.07, 0.035])

    def head_weights(self, points):
        u = self.head.project(points)[0]
        muzzle = smoothstep(self.head.at(3.4), self.head.at(4.3), u)
        return {"Head": 1.0 - muzzle, "Muzzle": muzzle}


# ---------------------------------------------------------------- paint

def _blur(image, sigma_y, sigma_x):
    fy = np.fft.fftfreq(image.shape[0])[:, None]
    fx = np.fft.fftfreq(image.shape[1])[None, :]
    kernel = np.exp(-2 * np.pi ** 2 * ((fy * sigma_y) ** 2 + (fx * sigma_x) ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(image) * kernel))


def reticulate(height, width, rows, cols, gap, rng, drop=0.06):
    """Giraffe patches: shrunken Voronoi cells with thumbed corners.

    `gap[row]` is the half-width of the pale lines in cell units; at 0.5 and
    above the patches vanish. The pattern repeats across the width.
    """
    seeds = []
    for r in range(-1, rows + 1):
        for c in range(cols):
            x = (c + 0.5 * (r % 2) + rng.uniform(-0.26, 0.26)) % cols
            y = r + 0.5 + rng.uniform(-0.26, 0.26)
            shrink, missing = rng.uniform(0.0, 0.07), rng.random() < drop
            for shift in (-cols, 0, cols):
                seeds.append((x + shift, y, shrink, missing))
    seeds = np.array(seeds, np.float32)
    px = ((np.arange(width) + 0.5) / width * cols).astype(np.float32)
    py = ((np.arange(height) + 0.5) / height * rows).astype(np.float32)
    mask = np.zeros((height, width), np.float32)
    for start in range(0, height, 48):
        y = py[start:start + 48]
        d2 = (px[None, :, None] - seeds[None, None, :, 0]) ** 2 + (y[:, None, None] - seeds[None, None, :, 1]) ** 2
        nearest = np.argpartition(d2, 1, axis=2)[:, :, :2]
        first = np.take_along_axis(d2, nearest[:, :, :1], 2)[:, :, 0]
        second = np.take_along_axis(d2, nearest[:, :, 1:2], 2)[:, :, 0]
        swap = second < first
        a = np.where(swap, nearest[:, :, 1], nearest[:, :, 0])
        b = np.where(swap, nearest[:, :, 0], nearest[:, :, 1])
        apart = np.linalg.norm(seeds[a, :2] - seeds[b, :2], axis=-1)
        border = np.abs(second - first) / (2 * np.maximum(apart, 1e-6))
        inside = border > np.asarray(gap, np.float32)[start:start + 48, None] + seeds[a, 2]
        mask[start:start + 48] = np.where(seeds[a, 3] > 0, 0.0, inside)
    soft = _blur(mask, 0.095 * height / rows, 0.095 * width / cols)
    return smoothstep(0.42, 0.58, soft)


def paint_atlas(figure, seed=11):
    """Paint the skin: ochre slip, sienna patches, a cream muzzle, wrists and fetlocks."""
    rng = np.random.default_rng(seed)
    color = {name: scene.rgb(value) for name, value in PALETTE.items()}
    image = np.empty((ATLAS, ATLAS, 3))
    image[:] = color["ochre"]

    def place(region, canvas):
        x, y, w, h, margin = REGIONS[region]
        height, width = canvas.shape[:2]
        pad = int(round(w * ATLAS * margin))
        if pad:
            canvas = np.concatenate([canvas[:, -pad:], canvas, canvas[:, :pad]], 1)
        x0, y0 = int(round(x * ATLAS)), int(round(y * ATLAS))
        image[y0:y0 + height, x0:x0 + canvas.shape[1]] = canvas

    def size(region):
        x, y, w, h, margin = REGIONS[region]
        return int(round(h * ATLAS)), int(round(w * ATLAS)) - 2 * int(round(w * ATLAS * margin))

    def tint(mask, base, name):
        return base + (color[name] - base) * mask[..., None]

    # Trunk: patches thin out under the jaw and stay off the crotch.
    height, width = size("trunk")
    u = (np.arange(height) + 0.5) / height
    gap = 0.21 + 0.31 * smoothstep(0.84, 0.99, u) + 0.31 * (1 - smoothstep(0.02, 0.10, u))
    patches = reticulate(height, width, 11, 5, gap, rng)
    place("trunk", tint(patches, np.broadcast_to(color["ochre"], (height, width, 3)), "spot"))

    # Limbs: smaller patches that fade towards a cream wrist or fetlock.
    for region, end in (("arm", 0.80), ("leg", 0.80)):
        height, width = size(region)
        u = (np.arange(height) + 0.5) / height
        gap = 0.21 + 0.35 * smoothstep(0.35, 0.72, u) + 0.3 * (1 - smoothstep(0.10, 0.2, u))
        patches = reticulate(height, width, 7, 3, gap, rng, drop=0.1)
        canvas = tint(patches, np.broadcast_to(color["ochre"], (height, width, 3)), "spot")
        cuff = np.broadcast_to(smoothstep(end - 0.05, end + 0.03, u)[:, None], (height, width))
        place(region, tint(cuff, canvas, "cream"))

    # Head: the cream of the muzzle runs further back along the jaw.
    height, width = size("head")
    u = ((np.arange(height) + 0.5) / height)[:, None]
    angle = ((np.arange(width) + 0.5) / width * TAU)[None, :]
    jaw = 0.5 + 0.5 * np.cos(angle)  # 1 on the underside, where the strip is cut
    start = figure.head.at(3.5) - 0.16 * jaw ** 2
    cream = smoothstep(start, start + 0.13, np.broadcast_to(u, (height, width)))
    place("head", tint(cream, np.broadcast_to(color["ochre"], (height, width, 3)), "cream"))

    # Slip is never even: a slow mottle over everything but the swatches.
    mottle = _blur(rng.standard_normal((ATLAS, ATLAS)), 26, 26)
    image *= (1 + 0.035 * mottle / mottle.std())[..., None]
    band = int(0.06 * ATLAS)
    for i, name in enumerate(PALETTE):
        image[:band, i * ATLAS // len(PALETTE):(i + 1) * ATLAS // len(PALETTE)] = color[name]

    picture = bpy.data.images.new("Giraffe slip", ATLAS, ATLAS, alpha=False)
    rgba = np.concatenate([np.clip(image, 0, 1), np.ones((ATLAS, ATLAS, 1))], 2)
    picture.pixels.foreach_set(rgba.astype(np.float32).ravel())
    picture.pack()
    return picture


def materials(picture):
    made = {}
    for name, rough in (("Clay", 0.88), ("Glazed clay", 0.22)):
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shader = nodes["Principled BSDF"]
        shader.inputs["Roughness"].default_value = rough
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = picture
        links.new(texture.outputs["Color"], shader.inputs["Base Color"])
        made[name] = material
    fabric = bpy.data.materials.new("Clay cloth")
    fabric.use_nodes = True
    nodes, links = fabric.node_tree.nodes, fabric.node_tree.links
    fabric.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.93
    tint = nodes.new("ShaderNodeVertexColor")
    tint.layer_name = scene.COLOR
    links.new(tint.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
    made[fabric.name] = fabric
    return made


# ---------------------------------------------------------------- build

class Builder:
    def __init__(self, figure, into, clay):
        self.figure = figure
        self.into = into
        self.clay = clay
        self.parts = []

    def add(self, name, verts, faces, weights, color=None, material="Clay", protect=0.0):
        obj = scene.make_object(name, verts, faces, self.into)
        obj.data.materials.append(self.clay[material])
        if color:
            scene.flat_uv(obj, swatch(color))
        points = scene.positions(obj)
        scene.set_weights(obj, weights(points) if callable(weights) else weights)
        if np.any(np.asarray(protect) > 0):
            scene.set_group(obj, "clay_protect", protect)
        self.parts.append(obj)
        return obj


def build_skin(b):
    f = b.figure
    lumps = [("trunk", f.trunk, 64, 48, "trunk")]
    for side in "LR":
        lumps.append(("arm", f.arms[side], 28, 24, "arm." + side))
        lumps.append(("leg", f.legs[side], 28, 28, "leg." + side))
    pieces = [loft.mesh(nu, nt)[:2] for _, loft, nu, nt, _ in lumps]
    body, trees = scene.fuse("Giraffe.Body", pieces, b.into)
    body.data.materials.append(b.clay["Clay"])
    points = scene.positions(body)
    share = scene.membership(points, trees)
    weights = scene.blend_weights(share, [f.skin[chain].weights(points) for *_, chain in lumps])
    scene.set_weights(body, scene.relax_weights(body, weights))

    owner = share.argmax(1)
    labels = [int(np.bincount(owner[list(p.vertices)]).argmax()) for p in body.data.polygons]
    params = []
    for region, loft, *_ in lumps:
        u, theta = loft.project(points)
        # Cut every strip down the back, where the mane or the dark hides the join.
        params.append((u, theta + (np.pi / 2 if region == "trunk" else -np.pi / 2)))
    scene.unwrap(body, lambda label, u, angle: atlas_uv(lumps[label][0], u, angle), params, labels)
    b.parts.append(body)
    return body


def build_hooves(b):
    f = b.figure
    for side in "LR":
        sign = 1 if side == "L" else -1
        ankle = f.ankle * (sign, 1, 1)
        for k, lean in enumerate((-1, 1)):
            cx = ankle[0] + lean * 0.052
            toe = Loft([
                dict(p=(cx - lean * 0.008, 0.004, 0.238), rx=0.054, ryf=0.072, ryb=0.074),
                dict(p=(cx, -0.004, 0.160), rx=0.064, ryf=0.082, ryb=0.100),
                dict(p=(cx + lean * 0.006, -0.010, 0.070), rx=0.072, ryf=0.088, ryb=0.130),
                dict(p=(cx + lean * 0.006, -0.010, 0.013), rx=0.070, ryf=0.086, ryb=0.130),
            ])
            verts, faces, _ = toe.mesh(14, 20, start="round", end="flat", cap=0.5, bevel=0.013)
            b.add(f"Hoof.{side}.{k}", verts, faces, {"Hind.Hoof." + side: 1.0}, "hoof")
        arm = f.arms[side]
        value, tangent, across, _ = arm.frame(0.9)
        wrist = f.wrist * (sign, 1, 1)
        for k, lean in enumerate((-1, 1)):
            base = wrist + across * lean * 0.026
            lobe = Loft([
                dict(p=base - tangent * 0.020, rx=0.040, ry=0.046),
                dict(p=base + tangent * 0.060, rx=0.047, ry=0.057),
                dict(p=base + tangent * 0.125, rx=0.040, ry=0.050),
            ])
            verts, faces, _ = lobe.mesh(10, 16, cap=0.75)
            b.add(f"Hand.{side}.{k}", verts, faces, {"Arm.Hoof." + side: 1.0}, "hoof")


def build_tail(b):
    f = b.figure
    path = Loft([dict(p=p, rx=0.017) for p in f.tail])
    verts, faces, _ = path.mesh(18, 10)
    b.add("Tail.Cord", verts, faces, f.skin["tail"].weights, "ochre")
    verts, faces = scene.ellipsoid(f.tail[-1] - (0, 0.004, 0.075), (0.042, 0.048, 0.105), segments=14, rings=10)
    b.add("Tail.Brush", verts, faces, {"Tail.02": 1.0}, "mane")


def build_head(b):
    f = b.figure
    head = f.head
    verts, faces, params = head.mesh(44, 48, cap=(0.6, 0.62))
    obj = scene.make_object("Giraffe.Head", verts, faces, b.into)
    obj.data.materials.append(b.clay["Clay"])
    u = params[:, 0]
    muzzle = smoothstep(head.at(3.4), head.at(4.3), u)
    scene.set_weights(obj, {"Head": 1.0 - muzzle, "Muzzle": muzzle})
    scene.set_group(obj, "clay_protect", 0.55 + 0.25 * muzzle)
    scene.unwrap(obj, lambda label, u, angle: atlas_uv("head", u, angle),
                 [(u, params[:, 1] - np.pi / 2)], [0] * len(obj.data.polygons))
    b.parts.append(obj)
    tree = BVHTree.FromPolygons([tuple(v) for v in verts], [tuple(face) for face in faces])
    up = np.array([0.0, 0.0, 1.0])

    for side, sign in (("L", 1), ("R", -1)):
        # Ears: a cupped leaf with a pink well.
        root, tip = f.ear_root * (sign, 1, 1), f.ear_tip * (sign, 1, 1)
        axis = (tip - root) / np.linalg.norm(tip - root)
        reach = np.linalg.norm(tip - root)
        forward = np.cross(axis, up) * sign
        forward /= np.linalg.norm(forward)
        outline = [(-0.06, 0.036, 0.032), (0.04, 0.074, 0.030), (0.14, 0.104, 0.026),
                   (0.23, 0.082, 0.021), (reach, 0.030, 0.013)]
        leaf = Loft([dict(p=root + axis * d, rx=w, ry=t) for d, w, t in outline], side=up)
        well = Loft([dict(p=root + axis * (0.02 + d * 0.86) + forward * 0.012, rx=w * 0.70, ry=t * 0.62)
                     for d, w, t in outline[1:]], side=up)

        def cup(points, loft):
            _, _, across, _ = loft.frame(loft.project(points)[0])
            centre = loft.sample(loft.project(points)[0])[0][:, :3]
            w = ((points - centre) * across).sum(1)
            return points + np.outer(w * w * 3.2, forward)

        ear_weight = lambda points: (lambda w: {"Head": 1 - w, "Ear." + side: w})(
            smoothstep(-0.02, 0.07, (points - root) @ axis))
        verts, faces, _ = leaf.mesh(18, 20, cap=0.8)
        b.add("Ear." + side, cup(verts, leaf), faces, ear_weight, "ochre")
        verts, faces, _ = well.mesh(14, 16, cap=0.8)
        b.add("Ear well." + side, cup(verts, well), faces, ear_weight, "pink")

        # Ossicones with a darker knob.
        base = np.array([sign * 0.076, -0.150, 3.320])
        top = np.array([sign * 0.098, -0.128, 3.492])
        horn = Loft([dict(p=base, rx=0.034), dict(p=(base + top) / 2, rx=0.029), dict(p=top, rx=0.027)])
        verts, faces, _ = horn.mesh(8, 14)
        b.add("Ossicone." + side, verts, faces, {"Head": 1.0}, "ochre")
        verts, faces = scene.ellipsoid(top + (top - base) * 0.12, (0.041, 0.041, 0.038), segments=14, rings=10)
        b.add("Ossicone knob." + side, verts, faces, {"Head": 1.0}, "mane")

        # Eyes: a glazed bead pressed into the face, a glint and a lash line.
        u_eye = head.at(3.25)
        theta = -0.50 if sign > 0 else np.pi + 0.50
        spot = head.surface(u_eye, theta)
        out = head.normal(u_eye, theta)
        lateral = np.cross(up, out)
        lateral /= np.linalg.norm(lateral)
        rise = np.cross(out, lateral)
        frame = np.stack([lateral, rise, out], 1)
        centre = spot - out * 0.014
        verts, faces = scene.ellipsoid(centre, (0.041, 0.053, 0.032), frame)
        b.add("Eye." + side, verts, faces, {"Head": 1.0}, "ink", "Glazed clay", protect=1.0)
        glint = centre + out * 0.028 + rise * 0.020 + lateral * 0.012
        verts, faces = scene.ellipsoid(glint, (0.010, 0.010, 0.006), frame, segments=10, rings=6)
        b.add("Glint." + side, verts, faces, {"Head": 1.0}, "white", "Glazed clay", protect=1.0)
        outer = -lateral * sign  # towards the ear
        arc = []
        for a in np.linspace(np.radians(140), np.radians(-8), 12):
            arc.append(centre + (np.cos(a) * outer * 0.053 + np.sin(a) * rise * 0.065))
        arc.append(arc[-1] + outer * 0.020 + rise * 0.016)
        lash_u, lash_t = head.project(np.array(arc))
        verts, faces = scene.strand(head.surface(lash_u, lash_t, 0.003), 0.0062)
        b.add("Lash." + side, verts, faces, {"Head": 1.0}, "line", protect=1.0)

        # Nostrils: two thumbnail presses on top of the muzzle.
        u_nose = head.at(5.6)
        theta = -np.pi / 2 + sign * 0.50
        frame = scene.basis(head.normal(u_nose, theta), -head.frame(u_nose)[1])
        verts, faces = scene.ellipsoid(head.surface(u_nose, theta, -0.002), (0.013, 0.019, 0.007), frame, 12, 8)
        b.add("Nostril." + side, verts, faces, {"Muzzle": 1.0}, "line", protect=1.0)

    # The mouth: one long press around the muzzle, lifting into a smile.
    value, tangent, across, down = head.frame(head.at(4.9))
    origin = value[:3] + down * 0.050
    hits = []
    for phi in np.linspace(-np.radians(104), np.radians(104), 41):
        lift = (abs(phi) / np.radians(104)) ** 2.2
        direction = np.cos(phi) * tangent + np.sin(phi) * across - down * 0.55 * lift
        location, normal, _, _ = tree.ray_cast(Vector(origin), Vector(direction / np.linalg.norm(direction)))
        if location is not None:
            hits.append(np.array(location) - np.array(normal) * 0.0015)
    verts, faces = scene.strand(np.array(hits), 0.0068)
    b.add("Mouth", verts, faces, {"Muzzle": 1.0}, "line", protect=1.0)


def build_mane(b, seed=5):
    """Pinched tufts pressed along the back of the neck, overlapping like roof tiles."""
    f = b.figure
    rng = np.random.default_rng(seed)
    trunk = f.trunk
    low, high = 1.955, 2.985
    count = 21
    pieces, base = ([], []), 0
    for i in range(count):
        t = i / (count - 1)
        u = trunk.at_z(low + (high - low) * t)
        back = -np.pi / 2
        out = trunk.normal(u, back)
        along = trunk.frame(u)[1]
        swell = np.sin(np.pi * (0.12 + 0.82 * t)) ** 0.6 * rng.uniform(0.92, 1.08)
        tilt = np.radians(rng.uniform(34, 44))
        axis = along * np.cos(tilt) + out * np.sin(tilt)
        centre = trunk.surface(u, back) + out * 0.020 * swell
        frame = scene.basis(axis, out)
        verts, faces = scene.ellipsoid(centre, np.array([0.038, 0.048, 0.084]) * swell, frame, 12, 8)
        pieces[0].append(verts)
        pieces[1].extend(tuple(i + base for i in face) for face in faces)
        base += len(verts)
    b.add("Mane", np.concatenate(pieces[0]), pieces[1], f.skin["trunk"].weights, "mane")


def build_rig(figure, into):
    data = bpy.data.armatures.new("Riragi.Rig")
    rig = bpy.data.objects.new("Riragi.Rig", data)
    into.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (head, tail) in figure.joints.items():
        bone = data.edit_bones.new(name)
        bone.head, bone.tail = Vector(head), Vector(tail)
    for name, parent in figure.parents.items():
        data.edit_bones[name].parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    data.bones["Root"].use_deform = False
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
    # The studio's body sliders; 1.0 is the figure as sculpted.
    for name in ("neck", "body", "legs", "head", "ears", "muzzle"):
        rig[name] = 1.0
    eye = figure.head.surface(figure.head.at(3.25), -np.pi / 2, 0.0)
    sockets = {
        "Socket.Crown": ("Head", (0, -0.150, 3.365)),
        "Socket.Face": ("Muzzle", (0, eye[1] - 0.10, eye[2] - 0.02)),
        "Socket.Neck": ("Neck.02", figure.trunk.surface(figure.trunk.at_z(2.42), np.pi / 2)),
        "Socket.Chest": ("Chest", figure.trunk.surface(figure.trunk.at_z(1.60), np.pi / 2)),
        "Socket.Back": ("Chest", figure.trunk.surface(figure.trunk.at_z(1.60), -np.pi / 2)),
        "Socket.Ear.L": ("Ear.L", figure.ear_tip * 0.75 + figure.ear_root * 0.25 + (0, -0.03, 0.06)),
        "Socket.Ear.R": ("Ear.R", flip(figure.ear_tip * 0.75 + figure.ear_root * 0.25 + (0, -0.03, 0.06))),
    }
    for name, (bone, at) in sockets.items():
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_size = 0.05
        into.objects.link(empty)
        empty.parent, empty.parent_type, empty.parent_bone = rig, "BONE", bone
        bpy.context.view_layer.update()
        empty.matrix_world = Matrix.Translation(Vector(at))
    return rig


def build(seed=11):
    """Build the bare giraffe in the current scene. Returns `(figure, rig, clay)`."""
    figure = Figure()
    clay = materials(paint_atlas(figure, seed))
    body = scene.collection("01 · Giraffe")
    pose = scene.collection("02 · Pose")
    rig = build_rig(figure, pose)
    builder = Builder(figure, body, clay)
    build_skin(builder)
    build_hooves(builder)
    build_tail(builder)
    build_head(builder)
    build_mane(builder)
    for obj in builder.parts:
        scene.bind(obj, rig)
    return figure, rig, clay
