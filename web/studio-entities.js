// Every kind of thing the studio edits is declared once in this registry.
// A type says how to find its row in the draft, what to call it, which
// icon to show and which scope it belongs to. The outline, breadcrumbs,
// selection checks and inspectors all read this table, so a new kind of object
// (a giraffe, say) is one more entry here plus its inspector — no new `if`
// chains through the studio.
//
// Scopes nest: 월드 › 방 › 가구 › 클릭 영역. A value set on a wider scope is
// the default for everything inside it. An object's own editor may override
// it, and PropertyRow's `override` marks that and offers a reset.

export const WORLD = Object.freeze({ type: 'world', id: 'world' })

const lightIcon = (light) =>
  ({ spot: 'light-spot', area: 'light-area' })[light?.shape?.type] || 'light'

export const entityTypes = Object.freeze({
  world: {
    noun: '월드',
    icon: () => 'world',
    find: () => WORLD,
    name: () => '월드',
    parent: () => null,
  },
  room: {
    noun: '방',
    icon: () => 'room',
    find: (s, id) => s.rooms.find((r) => r.id === id),
    name: (r) => r.label,
    parent: () => WORLD,
  },
  item: {
    noun: '가구',
    icon: () => 'furniture',
    find: (s, id) => s.layout.items.find((i) => i.id === id),
    name: (i) => i.label,
    parent: (i) => ({ type: 'room', id: i.room }),
    removable: true,
  },
  giraffe: {
    noun: '기린',
    icon: () => 'giraffe',
    find: (s, id) => (s.layout.giraffes ?? []).find((g) => g.id === id),
    name: (g) => g.label,
    parent: (g) => ({ type: 'room', id: g.room }),
    removable: true,
  },
  light: {
    noun: '조명',
    icon: lightIcon,
    find: (s, id) => s.light(id),
    name: (l) => l.label,
    // Blender lights without a room light the whole world.
    parent: (l) => (l.room ? { type: 'room', id: l.room } : WORLD),
    // Blender lights refuse deletion in the command; studio lights delete.
    removable: true,
  },
  spot: {
    noun: '클릭 영역',
    icon: () => 'spot',
    find: (s, id) => s.layout.spots.find((x) => x.id === id),
    name: (x) => x.label,
    parent: (x, s) =>
      s.rooms.some((r) => r.id === x.anchor)
        ? { type: 'room', id: x.anchor }
        : { type: 'item', id: x.anchor },
    removable: true,
  },
  page: {
    noun: '행사 페이지',
    icon: () => 'page',
    find: (s, id) => s.layout.pages.find((p) => p.id === id),
    name: (p) => p.title,
    // Pages live outside the 3D scene; they have no wider scope.
    parent: () => null,
    removable: true,
  },
})

/**
 * Read-only queries over one snapshot of the studio. `source` provides
 * `layout` (the shown draft), `rooms` and `light(id)`.
 */
export function entities(source) {
  const typeOf = (sel) => {
    const type = entityTypes[sel?.type]
    if (!type) throw Error('알 수 없는 선택 종류: ' + sel?.type)
    return type
  }
  const find = (sel) => (sel ? typeOf(sel).find(source, sel.id) : null)
  return Object.freeze({
    find,
    exists: (sel) => !!find(sel),
    name: (sel) => {
      const e = find(sel)
      return e ? typeOf(sel).name(e) : ''
    },
    icon: (sel) => typeOf(sel).icon(find(sel)),
    noun: (sel) => typeOf(sel).noun,
    removable: (sel) => !!typeOf(sel).removable,
    /** Scope chain from the widest scope down to `sel` itself. */
    path(sel) {
      const chain = []
      for (let at = sel; at;) {
        const e = find(at)
        if (!e) break
        chain.unshift(at)
        at = typeOf(at).parent(e, source)
      }
      return chain
    },
    /** The room that contains `sel`, if any. */
    roomOf(sel) {
      for (let at = sel; at;) {
        if (at.type === 'room') return at.id
        const e = find(at)
        if (!e) return null
        at = typeOf(at).parent(e, source)
      }
      return null
    },
  })
}
