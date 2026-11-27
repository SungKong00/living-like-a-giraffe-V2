"""Blender plumbing shared by the figure and its wardrobe (Blender 4.2)."""

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from .loft import TAU, smoothstep

UV = "Atlas"
COLOR = "Col"


def srgb(hex_color):
    """'#rrggbb' to linear RGB."""
    value = np.array([int(hex_color[i:i + 2], 16) for i in (1, 3, 5)], float) / 255.0
    return np.where(value <= 0.04045, value / 12.92, ((value + 0.055) / 1.055) ** 2.4)


def rgb(hex_color):
    """'#rrggbb' to display-referred (sRGB) RGB, as image pixels store it."""
    return np.array([int(hex_color[i:i + 2], 16) for i in (1, 3, 5)], float) / 255.0


def collection(name):
    found = bpy.data.collections.get(name)
    if found is None:
        found = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(found)
    return found


def make_object(name, verts, faces, into, smooth=True):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in np.asarray(verts, float)], [], [tuple(int(i) for i in f) for f in faces])
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.polygons.foreach_set("use_smooth", [smooth] * len(mesh.polygons))
    obj = bpy.data.objects.new(name, mesh)
    into.objects.link(obj)
    return obj


def positions(obj):
    out = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", out)
    return out.reshape(-1, 3)


def bake_modifiers(obj):
    """Replace the mesh with what its modifiers produce."""
    graph = bpy.context.evaluated_depsgraph_get()
    graph.update()
    baked = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), depsgraph=graph)
    old = obj.data
    obj.modifiers.clear()
    obj.data = baked
    baked.name = old.name
    bpy.data.meshes.remove(old)
    baked.polygons.foreach_set("use_smooth", [True] * len(baked.polygons))
    return obj


def fuse(name, pieces, into, voxel=0.014, smooth=10):
    """Knead separate lumps into one skin, as clay parts are blended by thumb.

    `pieces` are `(verts, faces)` of closed volumes. Returns the fused object
    and, per input piece, a BVH tree for asking which lump a point came from.
    """
    trees, verts, faces, base = [], [], [], 0
    for piece_verts, piece_faces in pieces:
        trees.append(BVHTree.FromPolygons([tuple(v) for v in piece_verts], [tuple(f) for f in piece_faces]))
        verts.append(np.asarray(piece_verts, float))
        faces += [tuple(i + base for i in f) for f in piece_faces]
        base += len(piece_verts)
    obj = make_object(name, np.concatenate(verts), faces, into)
    remesh = obj.modifiers.new("Knead", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = voxel
    remesh.adaptivity = 0.0
    soften = obj.modifiers.new("Thumb", "SMOOTH")
    soften.factor = 0.5
    soften.iterations = smooth
    return bake_modifiers(obj), trees


def membership(points, trees, softness=0.012):
    """How much each point belongs to each lump, from its distance to the lump."""
    distance = np.empty((len(points), len(trees)))
    for j, tree in enumerate(trees):
        for i, p in enumerate(points):
            distance[i, j] = tree.find_nearest(Vector(p))[3]
    distance -= distance.min(1, keepdims=True)
    share = np.exp(-distance / softness)
    return share / share.sum(1, keepdims=True)


class Chain:
    """Skin weights along a run of bones, blended across each joint."""

    def __init__(self, bones, line, blend):
        # `bones[i]` owns the stretch before joint `i`; the last owns the rest.
        # `line` holds the joints plus one end point that gives the last bone a direction.
        self.bones = bones
        self.line = np.asarray(line, float)
        self.blend = np.broadcast_to(np.asarray(blend, float), (len(bones) - 1,))
        steps = np.linalg.norm(np.diff(self.line, axis=0), axis=1)
        self.steps = steps
        self.arc = np.concatenate([[0.0], np.cumsum(steps)])

    def coordinate(self, points):
        points = np.asarray(points, float)
        best = np.full(len(points), np.inf)
        along = np.zeros(len(points))
        last = len(self.steps) - 1
        for i, length in enumerate(self.steps):
            a, b = self.line[i], self.line[i + 1]
            t = ((points - a) @ (b - a)) / (length * length)
            t = np.clip(t, -np.inf if i == 0 else 0.0, np.inf if i == last else 1.0)
            d = np.linalg.norm(points - (a + np.outer(t, b - a)), axis=1)
            closer = d < best
            best = np.where(closer, d, best)
            along = np.where(closer, self.arc[i] + t * length, along)
        return along

    def weights(self, points):
        along = self.coordinate(points)
        passed = [smoothstep(-h, h, along - self.arc[i]) for i, h in enumerate(self.blend)]
        out = {}
        for i, bone in enumerate(self.bones):
            before = passed[i - 1] if i > 0 else 1.0
            after = passed[i] if i < len(passed) else 0.0
            out[bone] = out.get(bone, 0.0) + (before - after)
        return out


def blend_weights(shares, per_region):
    """Mix per-region weight sets by membership share."""
    out = {}
    for j, weights in enumerate(per_region):
        for bone, w in weights.items():
            out[bone] = out.get(bone, 0.0) + shares[:, j] * w
    return out


def relax_weights(obj, weights, rounds=2):
    """Average weights over mesh edges so lumps hand over smoothly."""
    edges = np.empty(len(obj.data.edges) * 2, int)
    obj.data.edges.foreach_get("vertices", edges)
    a, b = edges.reshape(-1, 2).T
    count = np.bincount(np.concatenate([a, b]), minlength=len(obj.data.vertices)).astype(float)
    out = {}
    for bone, w in weights.items():
        w = np.broadcast_to(np.asarray(w, float), (len(count),)).copy()
        for _ in range(rounds):
            total = np.bincount(a, w[b], len(count)) + np.bincount(b, w[a], len(count))
            w = 0.5 * w + 0.5 * total / np.maximum(count, 1)
        out[bone] = w
    return out


def set_weights(obj, weights, limit=4):
    """Write normalised skin weights, at most `limit` bones per vertex (glTF)."""
    names = list(weights)
    count = len(obj.data.vertices)
    table = np.stack([np.broadcast_to(np.asarray(weights[n], float), (count,)) for n in names], 1)
    table = np.where(table < 0.01, 0.0, table)
    if table.shape[1] > limit:
        cut = np.sort(table, 1)[:, -limit][:, None]
        table = np.where(table >= cut, table, 0.0)
    total = table.sum(1, keepdims=True)
    if np.any(total == 0):
        raise ValueError(f"{obj.name}: {int((total == 0).sum())} vertices have no bone")
    table = table / total
    for j, name in enumerate(names):
        group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
        used = np.nonzero(table[:, j])[0]
        for value in np.unique(np.round(table[used, j], 3)):
            members = used[np.round(table[used, j], 3) == value]
            group.add([int(i) for i in members], float(value), "REPLACE")


def set_group(obj, name, value):
    count = len(obj.data.vertices)
    value = np.broadcast_to(np.asarray(value, float), (count,))
    group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
    for level in np.unique(np.round(value, 2)):
        if level > 0:
            group.add([int(i) for i in np.nonzero(np.round(value, 2) == level)[0]], float(level), "REPLACE")


def bind(obj, rig):
    obj.parent = rig
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig


def paint(obj, colors):
    """Face colours (linear RGB, one per face or one for all) as a corner attribute."""
    mesh = obj.data
    layer = mesh.color_attributes.get(COLOR) or mesh.color_attributes.new(COLOR, "BYTE_COLOR", "CORNER")
    colors = np.asarray(colors, float)
    if colors.ndim == 1:
        colors = np.broadcast_to(colors, (len(mesh.polygons), 3))
    totals = np.empty(len(mesh.polygons), int)
    mesh.polygons.foreach_get("loop_total", totals)
    corner = np.repeat(colors, totals, axis=0)
    rgba = np.concatenate([corner, np.ones((len(corner), 1))], 1)
    layer.data.foreach_set("color", rgba.ravel())
    mesh.color_attributes.active_color = layer
    mesh.color_attributes.render_color_index = list(mesh.color_attributes).index(layer)


def unwrap(obj, uv_of, params=None, labels=None):
    """Corner UVs from per-vertex surface parameters.

    `uv_of(label, u, angle)` returns atlas coordinates; `angle` is unrolled per
    face so a face on the seam does not smear across the whole strip.
    `params[label]` holds `(u, theta)` for every vertex under that mapping, and
    `labels` picks the mapping per face.
    """
    mesh = obj.data
    layer = mesh.uv_layers.get(UV) or mesh.uv_layers.new(name=UV)
    out = np.zeros((len(mesh.loops), 2))
    for poly in mesh.polygons:
        label = labels[poly.index]
        u, theta = params[label]
        ids = np.array(poly.vertices)
        angle = np.asarray(theta[ids], float)
        known = ~np.isnan(angle)
        angle = np.where(known, np.mod(angle, TAU), 0.0)
        if known.any():
            if angle[known].max() - angle[known].min() > np.pi:
                angle = np.where(angle < np.pi, angle + TAU, angle)
            angle = np.where(known, angle, angle[known].mean())
        out[poly.loop_start:poly.loop_start + poly.loop_total] = np.stack(uv_of(label, u[ids], angle), 1)
    layer.data.foreach_set("uv", out.ravel())


def flat_uv(obj, uv):
    mesh = obj.data
    layer = mesh.uv_layers.get(UV) or mesh.uv_layers.new(name=UV)
    layer.data.foreach_set("uv", np.tile(np.asarray(uv, float), len(mesh.loops)))


def join(objects, name):
    """Merge objects into the first one."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.name = name
    merged.data.name = name
    return merged


def ellipsoid(center, radii, rotation=None, segments=16, rings=10):
    verts, faces = [], []
    for i in range(1, rings):
        phi = np.pi * i / rings
        for j in range(segments):
            a = TAU * j / segments
            verts.append((np.sin(phi) * np.cos(a), np.sin(phi) * np.sin(a), np.cos(phi)))
    verts += [(0, 0, 1), (0, 0, -1)]
    top, bottom = len(verts) - 2, len(verts) - 1
    for i in range(rings - 2):
        for j in range(segments):
            k = (j + 1) % segments
            faces.append((i * segments + j, i * segments + k, (i + 1) * segments + k, (i + 1) * segments + j))
    for j in range(segments):
        k = (j + 1) % segments
        faces.append((top, k, j))
        faces.append((bottom, (rings - 2) * segments + j, (rings - 2) * segments + k))
    points = np.array(verts) * np.asarray(radii, float)
    if rotation is not None:
        points = points @ np.asarray(rotation, float).T
    return points + np.asarray(center, float), faces


def basis(forward, up):
    """Columns x, y, z with z along `forward` and y near `up`."""
    z = np.asarray(forward, float)
    z = z / np.linalg.norm(z)
    x = np.cross(np.asarray(up, float), z)
    x = x / np.linalg.norm(x)
    return np.stack([x, np.cross(z, x), z], 1)


def strand(points, radius, sides=8):
    """A thin rope through the given points, with pinched ends."""
    points = np.asarray(points, float)
    count = len(points)
    tangent = np.gradient(points, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    ref = np.array([0.0, 0.0, 1.0])
    verts, faces = [], []
    for i, (p, t) in enumerate(zip(points, tangent)):
        a = np.cross(t, ref)
        if np.linalg.norm(a) < 1e-4:
            a = np.cross(t, [1.0, 0.0, 0.0])
        a /= np.linalg.norm(a)
        b = np.cross(t, a)
        r = (radius[i] if np.ndim(radius) else radius) * min(1.0, 0.45 + 0.275 * min(i, count - 1 - i))
        for k in range(sides):
            ang = TAU * k / sides
            verts.append(p + (a * np.cos(ang) + b * np.sin(ang)) * r)
    for i in range(count - 1):
        for k in range(sides):
            m = (k + 1) % sides
            faces.append((i * sides + k, i * sides + m, (i + 1) * sides + m, (i + 1) * sides + k))
    verts += [points[0], points[-1]]
    faces += [(len(verts) - 2, (k + 1) % sides, k) for k in range(sides)]
    faces += [(len(verts) - 1, (count - 1) * sides + k, (count - 1) * sides + (k + 1) % sides) for k in range(sides)]
    return np.array(verts), faces
