import {
  Armchair,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CloudAlert,
  CloudCheck,
  Copy,
  DoorOpen,
  Download,
  Eye,
  FileText,
  Info,
  Keyboard,
  KeyRound,
  Link,
  Lightbulb,
  LoaderCircle,
  Magnet,
  Map as MapGlyph,
  MapPin,
  Minus,
  MousePointerClick,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Scan,
  Search,
  Send,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  X,
  Globe,
  LampCeiling,
  RectangleHorizontal,
  Undo,
  Clapperboard,
  Bookmark,
  History,
  Hand,
  PawPrint,
  Play,
} from 'lucide'
import { DesignSystemError } from './contract.js'

// Flyweight: each glyph is parsed into one <svg> template the first time it
// is used; every later use clones that template. The registry is closed —
// add an entry here (and to the design-system guide) to use a new glyph.
const glyphs = Object.freeze({
  add: Plus,
  alert: TriangleAlert,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  check: Check,
  clay: Hand,
  'check-circle': CircleCheck,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  close: X,
  copy: Copy,
  delete: Trash2,
  download: Download,
  external: ArrowUpRight,
  fit: Scan,
  furniture: Armchair,
  character: PawPrint,
  handoff: ArrowLeftRight,
  history: History,
  bookmark: Bookmark,
  info: Info,
  key: KeyRound,
  keyboard: Keyboard,
  link: Link,
  light: Lightbulb,
  'light-area': RectangleHorizontal,
  'light-spot': LampCeiling,
  map: MapGlyph,
  minus: Minus,
  motion: Clapperboard,
  page: FileText,
  play: Play,
  pointer: MousePointerClick,
  preview: Eye,
  publish: Send,
  redo: Redo2,
  room: DoorOpen,
  reset: Undo,
  'rotate-left': RotateCcw,
  'rotate-right': RotateCw,
  saved: CloudCheck,
  'save-error': CloudAlert,
  search: Search,
  snap: Magnet,
  spinner: LoaderCircle,
  spot: MapPin,
  undo: Undo2,
  upload: Upload,
  world: Globe,
})

export const iconNames = Object.freeze(Object.keys(glyphs))

const SVG = 'http://www.w3.org/2000/svg'
const templates = new Map()

function template(name) {
  let svg = templates.get(name)
  if (svg) return svg
  const nodes = glyphs[name]
  if (!nodes)
    throw new DesignSystemError(
      'Icon',
      '등록되지 않은 아이콘 "' +
        name +
        '". 사용할 수 있는 아이콘: ' +
        iconNames.join(', '),
    )
  svg = document.createElementNS(SVG, 'svg')
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }))
    svg.setAttribute(k, v)
  for (const [tag, attrs] of nodes) {
    const child = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, v)
    svg.append(child)
  }
  templates.set(name, svg)
  return svg
}

const sizes = ['xs', 'sm', 'md', 'lg']

// Icons are decorative: the control that holds one supplies the name.
export function Icon(name, size = 'md') {
  if (!sizes.includes(size))
    throw new DesignSystemError(
      'Icon',
      '크기는 ' + sizes.join(', ') + ' 중 하나입니다.',
    )
  const svg = template(name).cloneNode(true)
  svg.setAttribute('class', 'ui-icon ui-icon--' + size)
  svg.dataset.icon = name
  return svg
}
