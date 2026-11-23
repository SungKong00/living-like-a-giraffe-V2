// Every component validates its options when it is built. A typo in an option
// name, a variant the system does not define, or an icon-only button without
// an accessible name throws immediately instead of rendering something that
// quietly drifts away from the design system.

export class DesignSystemError extends TypeError {
  constructor(component, message) {
    super('[ds] ' + component + ': ' + message)
    this.name = 'DesignSystemError'
  }
}

const fail = (component, message) => {
  throw new DesignSystemError(component, message)
}

const describe = (value) =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

// A rule turns a raw option value into the validated one, or throws.
// Rules are plain functions so components can declare their schema inline.
function rule(type, check, fallback) {
  const make = (required) => (value, component, key) => {
    if (value === undefined) {
      if (required) fail(component, '필수 옵션 "' + key + '"이(가) 없습니다.')
      return typeof fallback === 'function' ? fallback() : fallback
    }
    if (!check(value))
      fail(
        component,
        '옵션 "' +
          key +
          '"은(는) ' +
          type +
          '여야 합니다. 받은 값: ' +
          describe(value),
      )
    return value
  }
  const optional = make(false)
  optional.required = make(true)
  return optional
}

const isNode = (v) => v instanceof Node
const isChild = (v) =>
  v == null ||
  v === false ||
  typeof v === 'string' ||
  typeof v === 'number' ||
  isNode(v)

export const is = Object.freeze({
  string: (fallback) => rule('문자열', (v) => typeof v === 'string', fallback),
  number: (fallback) =>
    rule(
      '유한한 숫자',
      (v) => typeof v === 'number' && Number.isFinite(v),
      fallback,
    ),
  // is.boolean() defaults to false; is.boolean(undefined) keeps "not set".
  boolean: (...fallback) =>
    rule(
      'true/false',
      (v) => typeof v === 'boolean',
      fallback.length ? fallback[0] : false,
    ),
  func: (fallback) => rule('함수', (v) => typeof v === 'function', fallback),
  array: (fallback = () => []) => rule('배열', Array.isArray, fallback),
  // Text or a DOM node. Components accept nodes only where they render them.
  content: (fallback = null) => rule('문자열 또는 DOM 노드', isChild, fallback),
  children: (fallback = () => []) =>
    rule(
      '자식 노드 배열',
      (v) => Array.isArray(v) && v.every(isChild),
      fallback,
    ),
  node: (fallback = null) => rule('DOM 노드', isNode, fallback),
  // One value from a closed set. The set is the component's public contract.
  oneOf: (values, fallback) =>
    rule(
      '[' + values.join(', ') + '] 중 하나',
      (v) => values.includes(v),
      fallback,
    ),
  any: (fallback) => rule('값', () => true, fallback),
})

// Reads `given` against `schema`. Unknown keys are mistakes, not extensions:
// add the option to the component (and its documentation) instead.
export function options(component, given, schema) {
  if (given == null || typeof given !== 'object' || Array.isArray(given))
    fail(component, '옵션 객체가 필요합니다.')
  for (const key of Object.keys(given))
    if (!Object.hasOwn(schema, key))
      fail(
        component,
        '알 수 없는 옵션 "' +
          key +
          '". 사용할 수 있는 옵션: ' +
          Object.keys(schema).join(', '),
      )
  const out = {}
  for (const [key, read] of Object.entries(schema))
    out[key] = read(given[key], component, key)
  return Object.freeze(out)
}

export function invariant(condition, component, message) {
  if (!condition) fail(component, message)
}

// Views may hand a component a class to position it (grid area, absolute
// placement) but never to restyle it, so the class must not borrow the
// component namespace.
export function viewClass(component, name) {
  invariant(
    !name || !/(^|\s)ui-/.test(name),
    component,
    'className은 배치용 화면 클래스만 받습니다. 모양은 variant·size 옵션으로 지정하세요.',
  )
  return name
}
