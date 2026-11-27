"""Lofted clay volumes: an elliptical section carried along a path.

Every soft part of the figure (trunk, limbs, head, sleeves, trouser legs) is a
Loft. The same parametrisation `(u, theta)` places paint, facial features and
garment panels on a part, so a garment always follows the body it was cut for.

`u` runs 0..1 along the path. `theta` runs around the section: 0 is the `side`
axis, pi/2 the `front` axis (`side x tangent`).
"""

import numpy as np

TAU = 2.0 * np.pi


def _slopes(x, y):
    """Monotone cubic (PCHIP) slopes, so radii never overshoot a station."""
    h = np.diff(x)
    d = np.diff(y, axis=0) / h[:, None]
    m = np.zeros_like(y)
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, len(x) - 1):
        w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
        same = d[i - 1] * d[i] > 0
        with np.errstate(divide="ignore", invalid="ignore"):
            harmonic = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
        m[i] = np.where(same, harmonic, 0.0)
    return m


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


class Loft:
    def __init__(self, stations, side=(1.0, 0.0, 0.0)):
        rows = []
        for s in stations:
            ry = s.get("ry", s["rx"])
            rows.append([*s["p"], s["rx"], s.get("ryf", ry), s.get("ryb", ry), s.get("n", 2.0)])
        self.values = np.array(rows, float)
        steps = np.linalg.norm(np.diff(self.values[:, :3], axis=0), axis=1)
        self.length = float(steps.sum())
        self.params = np.concatenate([[0.0], np.cumsum(steps)]) / self.length
        self.slopes = _slopes(self.params, self.values)
        self.side = np.array(side, float)
        dense = np.linspace(0.0, 1.0, 257)
        self._dense = dense
        self._centers = self.sample(dense)[0][:, :3]

    def at(self, index):
        """Parameter of a station; fractional indices fall between stations."""
        return float(np.interp(index, np.arange(len(self.params)), self.params))

    def at_z(self, z):
        """Parameter where the path crosses height z (paths that run along Z)."""
        zs = self._centers[:, 2]
        order = np.argsort(zs)
        return np.interp(z, zs[order], self._dense[order])

    def sample(self, u):
        u = np.clip(np.asarray(u, float), 0.0, 1.0)
        i = np.clip(np.searchsorted(self.params, u, side="right") - 1, 0, len(self.params) - 2)
        h = (self.params[i + 1] - self.params[i])[..., None]
        t = ((u - self.params[i]) / h[..., 0])[..., None]
        y0, y1, m0, m1 = self.values[i], self.values[i + 1], self.slopes[i], self.slopes[i + 1]
        t2, t3 = t * t, t * t * t
        value = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1
        slope = ((6 * t2 - 6 * t) * y0 / h + (3 * t2 - 4 * t + 1) * m0
                 + (-6 * t2 + 6 * t) * y1 / h + (3 * t2 - 2 * t) * m1)
        return value, slope

    def frame(self, u):
        value, slope = self.sample(u)
        tangent = slope[..., :3]
        tangent = tangent / np.linalg.norm(tangent, axis=-1, keepdims=True)
        side = self.side - tangent * (tangent @ self.side)[..., None]
        side = side / np.linalg.norm(side, axis=-1, keepdims=True)
        front = np.cross(side, tangent)
        return value, tangent, side, front

    def _bare(self, u, theta):
        value, _, side, front = self.frame(u)
        theta = np.asarray(theta, float)
        c, s = np.cos(theta), np.sin(theta)
        power = 2.0 / value[..., 6]
        a = np.sign(c) * np.abs(c) ** power
        b = np.sign(s) * np.abs(s) ** power
        ry = np.where(s >= 0, value[..., 4], value[..., 5])
        return value[..., :3] + side * (value[..., 3] * a)[..., None] + front * (ry * b)[..., None]

    def normal(self, u, theta):
        u, theta = np.broadcast_arrays(np.asarray(u, float), np.asarray(theta, float))
        e = 1e-3
        lo, hi = np.clip(u - e, 0, 1), np.clip(u + e, 0, 1)
        du = self._bare(hi, theta) - self._bare(lo, theta)
        dt = self._bare(u, theta + e) - self._bare(u, theta - e)
        n = np.cross(dt, du)
        n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-12)
        out = self._bare(u, theta) - self.sample(u)[0][..., :3]
        return n * np.where((n * out).sum(-1) < 0, -1.0, 1.0)[..., None]

    def surface(self, u, theta, offset=0.0):
        u, theta = np.broadcast_arrays(np.asarray(u, float), np.asarray(theta, float))
        offset = np.asarray(offset, float)
        points = self._bare(u, theta)
        if np.any(offset != 0):
            points = points + self.normal(u, theta) * np.broadcast_to(offset, u.shape)[..., None]
        return points

    def radius(self, u, theta):
        """Distance from the path to the surface, for turning widths into angles."""
        return np.linalg.norm(self._bare(u, theta) - self.sample(u)[0][..., :3], axis=-1)

    def project(self, points):
        """Parameters `(u, theta)` of the surface point nearest to each given point."""
        points = np.asarray(points, float)
        best = np.empty(len(points), int)
        for start in range(0, len(points), 4096):
            chunk = points[start:start + 4096]
            d = ((chunk[:, None, :] - self._centers[None, ::4, :]) ** 2).sum(-1)
            best[start:start + 4096] = d.argmin(1) * 4
        u = self._dense[best]
        for _ in range(2):
            value, tangent, _, _ = self.frame(u)
            u = np.clip(u + ((points - value[:, :3]) * tangent).sum(-1) / self.length, 0.0, 1.0)
        value, _, side, front = self.frame(u)
        d = points - value[:, :3]
        along_front = (d * front).sum(-1)
        ry = np.where(along_front >= 0, value[:, 4], value[:, 5])
        theta = np.arctan2(along_front / ry, (d * side).sum(-1) / value[:, 3])
        return u, theta

    def derive(self, u0=0.0, u1=1.0, ease=0.0, count=14):
        """A fatter (or thinner) loft over part of this one: the block for a garment."""
        us = np.linspace(u0, u1, count)
        value = self.sample(us)[0]
        grow = np.array([ease(u) for u in us]) if callable(ease) else np.full(count, float(ease))
        return Loft(
            [dict(p=v[:3], rx=v[3] + g, ryf=v[4] + g, ryb=v[5] + g, n=v[6]) for v, g in zip(value, grow)],
            side=self.side,
        )

    def mesh(self, nu=24, ntheta=32, start="round", end="round", u0=0.0, u1=1.0,
             cap=1.0, bevel=0.012, sink=0.6):
        """Vertices, faces and per-vertex `(u, theta)` of the lofted volume.

        Ends: `round` closes with a dome, `flat` with a bevelled lid, `sink`
        turns the rim inwards like a cuff, `open` leaves the ring.
        """
        thetas = np.linspace(0.0, TAU, ntheta, endpoint=False)
        us = np.linspace(u0, u1, nu)
        rings = [(self.surface(u, thetas), u) for u in us]
        poles = {}

        def close(u, direction, mode, into):
            value, tangent, _, _ = self.frame(u)
            center, axis = value[:3], tangent * direction
            spokes = self.surface(u, thetas) - center
            reach = float(min(value[3:6])) * (cap[0 if direction < 0 else 1] if np.ndim(cap) else cap)
            added = []
            if mode == "round":
                for k in range(1, 6):
                    phi = k / 6 * np.pi / 2
                    added.append(center + spokes * np.cos(phi) + axis * reach * np.sin(phi))
                poles[into] = center + axis * reach
            elif mode in ("flat", "sink"):
                shrink = 1.0 - bevel / float(min(value[3:6]))
                added.append(center + spokes * shrink + axis * bevel)
                if mode == "flat":
                    added.append(center + spokes * 0.5 + axis * bevel)
                    poles[into] = center + axis * bevel
                else:
                    added.append(center + spokes * sink + axis * bevel)
                    added.append(center + spokes * sink - axis * bevel * 4)
            return [(ring, u) for ring in added]

        before = close(u0, -1.0, start, "start")
        after = close(u1, 1.0, end, "end")
        rings = before[::-1] + rings + after
        verts = np.concatenate([ring for ring, _ in rings])
        params = np.concatenate([np.stack([np.full(ntheta, u), thetas], 1) for _, u in rings])
        faces = []
        for r in range(len(rings) - 1):
            a, b = r * ntheta, (r + 1) * ntheta
            for j in range(ntheta):
                k = (j + 1) % ntheta
                faces.append((a + j, a + k, b + k, b + j))
        extra = []
        if "start" in poles:
            index = len(verts) + len(extra)
            extra.append((poles["start"], u0))
            faces += [(index, (j + 1) % ntheta, j) for j in range(ntheta)]
        if "end" in poles:
            index = len(verts) + len(extra)
            extra.append((poles["end"], u1))
            last = (len(rings) - 1) * ntheta
            faces += [(index, last + j, last + (j + 1) % ntheta) for j in range(ntheta)]
        if extra:
            verts = np.concatenate([verts, np.array([p for p, _ in extra])])
            params = np.concatenate([params, np.array([[u, np.nan] for _, u in extra])])
        return verts, faces, params

    def patch(self, param, ns, nt, wrap=False, offset=0.0, rim=0.012, sink_to=-0.006):
        """A slab of clay laid on the surface.

        `param(s, t)` maps the unit square to `(u, theta)` (arrays in, arrays
        out). The outline is rolled over and tucked down to `sink_to` so the
        slab reads as a thick piece pressed onto what is underneath.
        """
        s = np.linspace(0.0, 1.0, ns)
        t = np.linspace(0.0, 1.0, nt, endpoint=not wrap)
        grid_s, grid_t = np.meshgrid(s, t, indexing="ij")
        u, theta = param(grid_s, grid_t)
        lift = offset(grid_s, grid_t) if callable(offset) else np.full(grid_s.shape, float(offset))
        # Extend the grid by two tucked rows on every open edge.
        rows = [0, 0] + list(range(ns)) + [ns - 1, ns - 1]
        cols = list(range(nt)) if wrap else [0, 0] + list(range(nt)) + [nt - 1, nt - 1]
        depth_r = np.array([2, 1] + [0] * ns + [1, 2])
        depth_c = np.zeros(nt, int) if wrap else np.array([2, 1] + [0] * nt + [1, 2])
        depth = np.maximum(depth_r[:, None], depth_c[None, :])
        iu = u[np.ix_(rows, cols)]
        it = theta[np.ix_(rows, cols)]
        il = lift[np.ix_(rows, cols)]
        il = np.where(depth == 1, il - rim, il)
        il = np.where(depth == 2, np.minimum(il - rim, sink_to), il)
        # Lower the outermost visible row a little: a thumb-rounded edge.
        inner_r = np.array([9, 9, 0] + [1] * (ns - 2) + [0, 9, 9])
        inner_c = np.ones(nt, int) if wrap else np.array([9, 9, 0] + [1] * (nt - 2) + [0, 9, 9])
        edge = (depth == 0) & (np.minimum(inner_r[:, None], inner_c[None, :]) == 0)
        il = np.where(edge, il - rim * 0.3, il)
        points = self.surface(iu, it, il)
        nr, nc = points.shape[:2]
        verts = points.reshape(-1, 3)
        params = np.stack([iu.ravel(), it.ravel()], 1)
        faces = []
        for r in range(nr - 1):
            for c in range(nc if wrap else nc - 1):
                d = (c + 1) % nc
                faces.append((r * nc + c, r * nc + d, (r + 1) * nc + d, (r + 1) * nc + c))
        return verts, faces, params
