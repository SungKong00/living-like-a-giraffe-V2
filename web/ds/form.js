import { el, cx } from './dom.js'
import { Icon } from './icon.js'
import { options, is, invariant, viewClass } from './contract.js'

// Form controls share one commit model so every view behaves the same:
//   • typing previews or validates (`onInput`), leaving commits (`onCommit`)
//   • Enter leaves a single-line field, Escape restores the last saved value
//   • an invalid value shows its reason under the field and is never committed
// Each control takes a stable `key` so renderKeepingFocus() can restore focus
// and caret after a panel re-renders.

const FIELD_SIZES = ['sm', 'md', 'lg']

function errorSlot() {
  return el('small', { class: 'ui-field-error', role: 'alert', hidden: true })
}

function showProblem(node, slot, problem) {
  slot.textContent = problem || ''
  slot.hidden = !problem
  node.toggleAttribute('aria-invalid', !!problem)
}

/**
 * Single-line text input.
 * `appearance: 'title'` renders an inline-editable heading (inspector names).
 */
export function TextInput(props) {
  const o = options('TextInput', props, {
    label: is.string().required,
    value: is.string(''),
    key: is.string(),
    name: is.string(),
    type: is.oneOf(['text', 'url', 'password', 'search', 'email'], 'text'),
    placeholder: is.string(),
    autocomplete: is.string(),
    required: is.boolean(),
    size: is.oneOf(FIELD_SIZES, 'md'),
    appearance: is.oneOf(['default', 'title'], 'default'),
    icon: is.string(),
    validate: is.func(),
    onInput: is.func(),
    onCommit: is.func(),
    className: is.string(),
  })
  const input = el('input', {
    class: 'ui-input__control',
    type: o.type,
    name: o.name,
    'data-key': o.key,
    'aria-label': o.label,
    placeholder: o.placeholder,
    autocomplete: o.autocomplete,
    required: o.required,
    spellcheck: 'false',
  })
  input.value = o.value
  const slot = errorSlot()
  input.addEventListener('input', () => {
    showProblem(input, slot, o.validate?.(input.value))
    o.onInput?.(input.value)
  })
  if (o.onCommit) {
    input.addEventListener('change', () => {
      const problem = o.validate?.(input.value)
      showProblem(input, slot, problem)
      if (problem) return
      o.onCommit(o.type === 'text' ? input.value.trim() : input.value)
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur()
      if (e.key === 'Escape') {
        input.value = o.value
        showProblem(input, slot, null)
        input.blur()
      }
    })
  }
  return el(
    'div',
    {
      class: cx(
        'ui-input',
        'ui-input--' + o.size,
        o.appearance === 'title' && 'ui-input--title',
        o.icon && 'ui-input--with-icon',
        viewClass('TextInput', o.className),
      ),
    },
    el(
      'div',
      { class: 'ui-input__box' },
      o.icon ? Icon(o.icon, 'sm') : null,
      input,
    ),
    slot,
  )
}

/** Multi-line text. Commits when the field loses focus. */
export function TextArea(props) {
  const o = options('TextArea', props, {
    label: is.string().required,
    value: is.string(''),
    key: is.string(),
    rows: is.number(4),
    placeholder: is.string(),
    validate: is.func(),
    onCommit: is.func().required,
  })
  const area = el('textarea', {
    class: 'ui-textarea__control',
    'data-key': o.key,
    'aria-label': o.label,
    rows: o.rows,
    placeholder: o.placeholder,
    spellcheck: 'true',
  })
  area.value = o.value
  const slot = errorSlot()
  area.addEventListener('input', () =>
    showProblem(area, slot, o.validate?.(area.value)),
  )
  area.addEventListener('change', () => {
    const problem = o.validate?.(area.value)
    showProblem(area, slot, problem)
    if (!problem) o.onCommit(area.value)
  })
  return el('div', { class: 'ui-textarea' }, area, slot)
}

/** Numeric input with an optional axis or unit prefix (X, Y, m). */
export function NumberInput(props) {
  const o = options('NumberInput', props, {
    label: is.string().required,
    value: is.number().required,
    key: is.string(),
    prefix: is.string(),
    step: is.number(0.25),
    min: is.number(),
    max: is.number(),
    onCommit: is.func().required,
  })
  const input = el('input', {
    class: 'ui-number__control',
    type: 'number',
    'data-key': o.key,
    'aria-label': o.label,
    step: o.step,
    min: o.min,
    max: o.max,
    inputmode: 'decimal',
  })
  input.value = String(o.value)
  input.addEventListener('change', () => {
    let v = Number(input.value)
    if (input.value === '' || !Number.isFinite(v)) {
      input.value = String(o.value)
      return
    }
    if (o.min != null) v = Math.max(o.min, v)
    if (o.max != null) v = Math.min(o.max, v)
    o.onCommit(v)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur()
    if (e.key === 'Escape') {
      input.value = String(o.value)
      input.blur()
    }
  })
  return el(
    'label',
    { class: 'ui-number' },
    o.prefix
      ? el(
          'span',
          { class: 'ui-number__prefix', 'aria-hidden': 'true' },
          o.prefix,
        )
      : null,
    input,
  )
}

/** Range slider. `onInput` previews while dragging; `onCommit` records once. */
export function Slider(props) {
  const o = options('Slider', props, {
    label: is.string().required,
    value: is.number().required,
    min: is.number().required,
    max: is.number().required,
    step: is.number(1),
    key: is.string(),
    format: is.func(() => String),
    onInput: is.func(),
    onCommit: is.func().required,
  })
  invariant(o.min < o.max, 'Slider', 'min은 max보다 작아야 합니다.')
  const range = el('input', {
    class: 'ui-slider__control',
    type: 'range',
    'data-key': o.key,
    'aria-label': o.label,
    min: o.min,
    max: o.max,
    step: o.step,
  })
  range.value = String(o.value)
  const out = el('output', { class: 'ui-slider__value' }, o.format(o.value))
  const paint = () =>
    range.style.setProperty(
      '--fill',
      ((Number(range.value) - o.min) / (o.max - o.min)) * 100 + '%',
    )
  paint()
  range.addEventListener('input', () => {
    const v = Number(range.value)
    out.textContent = o.format(v)
    paint()
    o.onInput?.(v)
  })
  range.addEventListener('change', () => o.onCommit(Number(range.value)))
  return el('div', { class: 'ui-slider' }, range, out)
}

/** Native select with design-system styling. */
export function Select(props) {
  const o = options('Select', props, {
    label: is.string().required,
    value: is.string().required,
    options: is.array().required,
    key: is.string(),
    size: is.oneOf(FIELD_SIZES, 'md'),
    onChange: is.func().required,
  })
  const node = el(
    'select',
    { class: 'ui-select__control', 'data-key': o.key, 'aria-label': o.label },
    ...o.options.map((item) => {
      invariant(
        item &&
          typeof item.value === 'string' &&
          typeof item.label === 'string',
        'Select',
        'options의 각 항목은 { value, label } 문자열이어야 합니다.',
      )
      return el(
        'option',
        { value: item.value, disabled: !!item.disabled },
        item.label,
      )
    }),
  )
  node.value = o.value
  node.addEventListener('change', () => o.onChange(node.value))
  return el(
    'div',
    { class: cx('ui-select', 'ui-select--' + o.size) },
    node,
    Icon('chevron-down', 'sm'),
  )
}

/** Mutually exclusive choice between two to five short options. */
export function Segmented(props) {
  const o = options('Segmented', props, {
    label: is.string().required,
    value: is.string().required,
    options: is.array().required,
    key: is.string(),
    onChange: is.func().required,
  })
  invariant(
    o.options.length >= 1 && o.options.length <= 5,
    'Segmented',
    '선택지는 1~5개입니다. 더 많으면 Select를 쓰세요.',
  )
  return el(
    'div',
    { class: 'ui-segmented', role: 'radiogroup', 'aria-label': o.label },
    ...o.options.map(({ value, label }) =>
      el(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: 'ui-segmented__option',
          'data-key': (o.key || o.label) + ':' + value,
          'aria-checked': String(value === o.value),
          onclick: () => value !== o.value && o.onChange(value),
        },
        label,
      ),
    ),
  )
}

/**
 * Color swatches. 'original' means "keep the model's own color".
 * With `allowCustom`, a native color picker previews while it moves.
 */
export function SwatchPicker(props) {
  const o = options('SwatchPicker', props, {
    label: is.string().required,
    value: is.string().required,
    colors: is.array().required,
    key: is.string('color'),
    allowCustom: is.boolean(),
    customLabel: is.string('직접 고른 색'),
    originalLabel: is.string('원본 색'),
    customFallback: is.string('#ac7958'),
    onPreview: is.func(),
    onChange: is.func().required,
  })
  const group = el(
    'div',
    { class: 'ui-swatches', role: 'radiogroup', 'aria-label': o.label },
    ...o.colors.map((c) => {
      const original = c === 'original'
      return el('button', {
        type: 'button',
        role: 'radio',
        class: cx('ui-swatch', original && 'ui-swatch--original'),
        'data-key': o.key + ':' + c,
        'aria-checked': String(o.value === c),
        'aria-label': original ? o.originalLabel : c,
        title: original ? o.originalLabel : c,
        style: original ? null : '--swatch:' + c,
        onclick: () => o.onChange(c),
      })
    }),
  )
  if (o.allowCustom) {
    const custom = el('input', {
      type: 'color',
      class: 'ui-swatch ui-swatch--custom',
      'data-key': o.key + ':custom',
      'aria-label': o.customLabel,
      title: o.customLabel,
      'data-on': String(o.value !== 'original' && !o.colors.includes(o.value)),
    })
    custom.value = o.value === 'original' ? o.customFallback : o.value
    custom.addEventListener('input', () => o.onPreview?.(custom.value))
    custom.addEventListener('change', () => o.onChange(custom.value))
    group.append(custom)
  }
  return group
}

/** A two-state button such as "격자 맞춤". Keeps its own pressed state. */
export function Toggle(props) {
  const o = options('Toggle', props, {
    label: is.string().required,
    pressed: is.boolean(),
    icon: is.string(),
    hint: is.string(),
    onChange: is.func().required,
  })
  let pressed = o.pressed
  const node = el(
    'button',
    {
      type: 'button',
      class: 'ui-toggle',
      'aria-pressed': String(pressed),
      title: o.hint,
      onclick: () => {
        pressed = !pressed
        node.setAttribute('aria-pressed', String(pressed))
        o.onChange(pressed)
      },
    },
    o.icon ? Icon(o.icon, 'sm') : null,
    el('span', {}, o.label),
    el('span', { class: 'ui-toggle__track', 'aria-hidden': 'true' }),
  )
  return node
}

/** A visible label above a control, with optional help text. */
export function Field(props) {
  const o = options('Field', props, {
    label: is.string().required,
    control: is.node().required,
    hint: is.string(),
  })
  return el(
    'label',
    { class: 'ui-field' },
    el('span', { class: 'ui-field__label' }, o.label),
    o.control,
    o.hint ? el('small', { class: 'ui-field__hint' }, o.hint) : null,
  )
}

/**
 * A choice between a few options that each need more than a word to show,
 * such as two conflicting values. Renders a fieldset of selectable cards.
 */
export function RadioCards(props) {
  const o = options('RadioCards', props, {
    legend: is.string().required,
    name: is.string().required,
    value: is.string(),
    options: is.array().required,
    onChange: is.func().required,
  })
  return el(
    'fieldset',
    { class: 'ui-radio-cards' },
    el('legend', { class: 'ui-radio-cards__legend' }, o.legend),
    el(
      'div',
      { class: 'ui-radio-cards__options' },
      ...o.options.map((item) => {
        const i = options('RadioCards.option', item, {
          value: is.string().required,
          title: is.string().required,
          content: is.content(),
        })
        const input = el('input', {
          type: 'radio',
          class: 'ui-radio-cards__input',
          name: o.name,
          value: i.value,
          checked: i.value === o.value,
          onchange: () => o.onChange(i.value),
        })
        return el(
          'label',
          { class: 'ui-radio-cards__option' },
          input,
          el('span', { class: 'ui-radio-cards__title' }, i.title),
          i.content
            ? el('span', { class: 'ui-radio-cards__content' }, i.content)
            : null,
        )
      }),
    ),
  )
}
