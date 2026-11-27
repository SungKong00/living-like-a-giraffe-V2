import { api, app, stage, zoomControls } from './ui.js'
import {
  el,
  Brand,
  brandName,
  Button,
  EmptyState,
  Icon,
  IconButton,
  NavLinks,
  SceneCaption,
} from './ds/index.js'

const route = location.pathname
const studioAvailable = !matchMedia(
  '(pointer: coarse) and (max-device-width: 960px)',
).matches
// The studio opens an event page with `?draft` to show unpublished text.
// Without a studio login the published page is shown instead.
let draftView = new URLSearchParams(location.search).has('draft')
async function draftPages() {
  try {
    return (await api('admin/draft')).layout.pages
  } catch (e) {
    if (e.status !== 401) throw e
    draftView = false
    return null
  }
}
const photo = (id) =>
  id === 'mental-sauna' ? 'sauna' : id === 'sports-day' ? 'sports' : 'world'
const coverSrc = (id) => '/images/' + photo(id) + '.jpg'

// ---- Site header ----
function header() {
  const section = route.startsWith('/events')
    ? 'events'
    : route === '/'
      ? 'world'
      : null
  document.querySelector('#site-header').replaceChildren(
    Brand({}),
    NavLinks({
      label: '주요 메뉴',
      items: [
        { label: '공간', href: '/', current: section === 'world' },
        { label: '행사 기록', href: '/events', current: section === 'events' },
      ],
    }),
    el(
      'div',
      { class: 'site-header__end', hidden: !studioAvailable },
      Button({
        label: '스튜디오',
        href: '/studio',
        variant: 'ghost',
        iconEnd: 'external',
      }),
    ),
  )
}

// ---- Event archive ----
function eventCard(p) {
  return el(
    'a',
    { class: 'event-card', href: '/events/' + p.id },
    el(
      'div',
      { class: 'event-card__media' },
      el('img', { src: coverSrc(p.id), alt: '', loading: 'lazy' }),
    ),
    el(
      'div',
      { class: 'event-card__body' },
      el('h2', { class: 'event-card__title' }, p.title),
      el('p', { class: 'event-card__summary' }, p.summary),
      el(
        'span',
        { class: 'event-card__more' },
        '기록 읽기',
        Icon('arrow-right', 'sm'),
      ),
    ),
  )
}

function archive(pages) {
  app.replaceChildren(
    el(
      'section',
      { class: 'page' },
      el(
        'header',
        { class: 'page-header' },
        el(
          'span',
          { class: 'eyebrow' },
          '아카이브 · ' + pages.length + '개의 기록',
        ),
        el('h1', { class: 'page-title' }, '행사 기록'),
        el(
          'p',
          { class: 'page-lead' },
          `${brandName}의 공간에서 열린 행사들을 사진과 글로 남겨 둡니다.`,
        ),
      ),
      pages.length
        ? el('div', { class: 'event-grid' }, ...pages.map(eventCard))
        : EmptyState({
            icon: 'page',
            title: '아직 기록된 행사가 없습니다',
            description: '행사가 기록되면 이곳에 모입니다.',
          }),
    ),
  )
}

function detail(page) {
  app.replaceChildren(
    el(
      'article',
      { class: 'page page--reading event-detail' },
      Button({
        label: '행사 기록',
        href: '/events',
        variant: 'ghost',
        size: 'sm',
        icon: 'arrow-left',
        className: 'event-detail__back',
      }),
      el(
        'header',
        { class: 'page-header' },
        el(
          'span',
          { class: 'eyebrow' },
          draftView ? '행사 기록 · 공개 전 초안' : '행사 기록',
        ),
        el('h1', { class: 'page-title' }, page.title),
        el('p', { class: 'page-lead' }, page.summary),
      ),
      el('img', {
        class: 'event-detail__cover',
        src: coverSrc(page.id),
        alt: '',
      }),
      el('p', { class: 'prose' }, page.body),
      el(
        'footer',
        { class: 'event-detail__footer' },
        page.url
          ? Button({
              label: '원문 보기',
              href: page.url,
              external: true,
              variant: 'primary',
              size: 'lg',
              iconEnd: 'external',
            })
          : null,
        Button({
          label: '공간에서 보기',
          href: '/',
          variant: 'secondary',
          size: 'lg',
          icon: 'map',
        }),
      ),
    ),
  )
}

function events(pages, id) {
  if (!id) return archive(pages)
  const page = pages.find((p) => p.id === id)
  if (page) return detail(page)
  app.replaceChildren(
    el(
      'section',
      { class: 'page page--reading' },
      EmptyState({
        size: 'lg',
        icon: 'page',
        title: '행사를 찾을 수 없습니다',
        description: '주소가 바뀌었거나 기록이 정리되었을 수 있습니다.',
        actions: [
          Button({
            label: '행사 기록으로',
            href: '/events',
            variant: 'primary',
            icon: 'arrow-left',
          }),
        ],
      }),
    ),
  )
}

// ---- World ----
async function visit(data) {
  const view = stage()
  let world
  const placeCard = el('article', {
    class: 'place-card',
    hidden: true,
    'aria-live': 'polite',
  })
  const back = Button({
    label: '전체 공간',
    icon: 'arrow-left',
    className: 'world-back',
    onClick: () => world?.selectRoom(null),
  })
  back.hidden = true
  const shortcuts = el(
    'aside',
    { class: 'world-events', 'aria-label': '공간에서 만나는 행사' },
    el('h2', { class: 'world-events__title' }, '공간에서 만나는 행사'),
    ...data.layout.pages
      .slice(0, 2)
      .map((p) =>
        el(
          'a',
          { class: 'world-events__link', href: '/events/' + p.id },
          el('img', { src: coverSrc(p.id), alt: '' }),
          el('span', {}, p.title),
          Icon('arrow-right', 'sm'),
        ),
      ),
  )
  const overviewDescription = '방을 선택해 그곳의 행사를 만나보세요.'
  const title = document.createTextNode(brandName)
  const description = document.createTextNode(overviewDescription)
  view.host.append(
    SceneCaption({
      className: 'world-intro',
      eyebrow: '공간 아카이브',
      icon: 'map',
      title,
      description,
    }),
    back,
    shortcuts,
    zoomControls((factor) => world?.zoom(factor), { className: 'world-zoom' }),
    placeCard,
  )
  app.replaceChildren(view.host)

  function open(s) {
    const p = data.layout.pages.find((p) => p.id === s.action.page)
    placeCard.className = 'place-card' + (p ? '' : ' place-card--text-only')
    placeCard.replaceChildren(
      p
        ? el('img', {
            class: 'place-card__media',
            src: coverSrc(p.id),
            alt: '',
          })
        : '',
      el(
        'div',
        { class: 'place-card__body' },
        el(
          'span',
          { class: 'place-card__eyebrow' },
          p ? '행사 기록' : '외부 링크',
        ),
        el('h2', { class: 'place-card__title' }, s.label),
        p ? el('p', { class: 'place-card__summary' }, p.summary) : null,
        p
          ? Button({
              label: '행사 자세히 보기',
              href: '/events/' + p.id,
              variant: 'primary',
              iconEnd: 'arrow-right',
              className: 'place-card__action',
            })
          : Button({
              label: '링크 열기',
              href: s.action.url,
              external: true,
              variant: 'primary',
              iconEnd: 'external',
              className: 'place-card__action',
            }),
      ),
      IconButton({
        icon: 'close',
        label: '닫기',
        size: 'sm',
        className: 'place-card__close',
        onClick: () => (placeCard.hidden = true),
      }),
    )
    placeCard.hidden = false
  }

  // Characters of the published world; only the chosen room's move.
  let cast = null
  try {
    const { openVisitorScene } = await import('./scene.js')
    world = await openVisitorScene(view, data, {
      onPick: (owner) => !!cast?.pick(owner),
      onRoom(id) {
        cast?.focus(id)
        shortcuts.hidden = !!id
        back.hidden = !id
        placeCard.hidden = true
        title.data = data.rooms.find((r) => r.id === id)?.label || brandName
        description.data = !id
          ? overviewDescription
          : data.layout.spots.some(
                (s) =>
                  s.anchor === id ||
                  data.layout.items.some(
                    (i) => i.room === id && i.id === s.anchor,
                  ),
              )
            ? '표시를 눌러 행사 기록을 열어보세요.'
            : '이 방에 연결된 행사 기록이 아직 없습니다.'
      },
      onSpot: open,
    })
    if (data.characters)
      cast = (await import('./visitor-characters.js')).visitorCharacters(
        world,
        data,
        {
          onPage: (page, c) =>
            open({ label: c.label, action: { type: 'page', page } }),
        },
      )
  } catch (e) {
    view.loading.replaceChildren(
      Icon('alert', 'sm'),
      '3D 공간을 열 수 없습니다.',
      el('a', { href: '/events' }, '행사 기록 보기'),
    )
    console.error(e)
  }
}

// ---- Boot ----
header()
try {
  if (route === '/studio' && studioAvailable)
    await (await import('./studio.js')).studio()
  else {
    const id = route.split('/')[2]
    if (route.startsWith('/events') && id && draftView)
      events((await draftPages()) ?? (await api('world')).layout.pages, id)
    else {
      const state = await api('world')
      if (route.startsWith('/events')) events(state.layout.pages, id)
      else await visit(state)
    }
  }
} catch (e) {
  app.replaceChildren(
    el(
      'section',
      { class: 'page page--reading' },
      EmptyState({
        size: 'lg',
        icon: 'alert',
        title: '페이지를 열 수 없습니다',
        description: e.message,
        actions: [
          Button({ label: '공간으로 돌아가기', href: '/', variant: 'primary' }),
        ],
      }),
    ),
  )
}
