import test from 'node:test'
import assert from 'node:assert/strict'
import {
  options,
  is,
  viewClass,
  DesignSystemError,
} from '../web/ds/contract.js'

const schema = {
  label: is.string().required,
  variant: is.oneOf(['primary', 'ghost'], 'ghost'),
  pressed: is.boolean(undefined),
  wide: is.boolean(),
}

test('컴포넌트 옵션은 기본값을 채우고 고정된다', () => {
  const o = options('Button', { label: '발행' }, schema)
  assert.deepEqual(
    { ...o },
    {
      label: '발행',
      variant: 'ghost',
      pressed: undefined,
      wide: false,
    },
  )
  assert.ok(Object.isFrozen(o))
})

test('설계와 다른 사용은 만들 때 바로 거부된다', () => {
  const misuse = [
    [{ label: '발행', varient: 'primary' }, /알 수 없는 옵션 "varient"/],
    [{ label: '발행', variant: 'shiny' }, /primary, ghost/],
    [{ variant: 'primary' }, /필수 옵션 "label"/],
    [{ label: 3 }, /문자열/],
    [{ label: '발행', wide: 'yes' }, /true\/false/],
  ]
  for (const [given, message] of misuse)
    assert.throws(
      () => options('Button', given, schema),
      (e) => e instanceof DesignSystemError && message.test(e.message),
    )
})

test('화면 클래스는 컴포넌트 모양을 덮어쓸 수 없다', () => {
  assert.equal(viewClass('Button', 'world-back'), 'world-back')
  assert.throws(
    () => viewClass('Button', 'world-back ui-button--primary'),
    DesignSystemError,
  )
})
