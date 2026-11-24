// A helper may only return the embedded, self-contained visitor model for its snapshot.
export function validateResult(bytes, rooms, items) {
  const invalid = () => {
    throw Error('이 개정의 방과 가구를 포함한 GLB가 필요합니다.')
  }
  if (
    bytes.length < 28 ||
    bytes.toString('ascii', 0, 4) !== 'glTF' ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length ||
    bytes.toString('ascii', 16, 20) !== 'JSON'
  )
    invalid()
  const end = 20 + bytes.readUInt32LE(12)
  if (
    end + 8 > bytes.length ||
    bytes.readUInt32LE(end + 4) !== 0x004e4942 ||
    end + 8 + bytes.readUInt32LE(end) !== bytes.length
  )
    invalid()
  const doc = JSON.parse(bytes.toString('utf8', 20, end))
  if (
    doc.asset?.version !== '2.0' ||
    !doc.meshes?.length ||
    !doc.buffers?.length ||
    doc.buffers
      .slice(1)
      .some((b) => !b.extensions?.EXT_meshopt_compression?.fallback) ||
    doc.buffers[0].byteLength > bytes.length - end - 8 ||
    [...doc.buffers, ...(doc.images ?? [])].some((x) => x.uri !== undefined)
  )
    invalid()
  const ids = (key) =>
    doc.nodes
      .map((n) => n.extras?.[key])
      .filter(Boolean)
      .sort()
  const same = (actual, expected) =>
    JSON.stringify(actual) === JSON.stringify(expected.map((r) => r.id).sort())
  if (!same(ids('roomId'), rooms) || !same(ids('itemId'), items)) invalid()
}
