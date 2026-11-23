import {el,button,api,app,stage,small} from './ui.js'
const route=location.pathname
document.querySelector('[data-nav="'+(route.startsWith('/events')?'events':'world')+'"]').classList.add('active')
const photo=id=>id==='mental-sauna'?'sauna':id==='sports-day'?'sports':'world'
const cover=(id)=>el('img',{class:'cover',alt:'',src:'/images/'+photo(id)+'.jpg'})
const detailLink=p=>el('a',{class:'primary',href:'/events/'+p.id},'행사 자세히 보기 ↗')
function events(pages,id){
  const page=pages.find(p=>p.id===id)
  if(id&&!page){app.replaceChildren(el('h1',{},'행사를 찾을 수 없습니다'),el('a',{href:'/events'},'행사 기록으로'));return}
  if(page){app.replaceChildren(el('article',{class:'detail'},el('a',{href:'/events'},'← 행사 기록'),el('h1',{},page.title),el('p',{class:'lead'},page.summary),cover(page.id),el('p',{class:'prose'},page.body),page.url?el('a',{class:'primary',href:page.url,target:'_blank',rel:'noopener noreferrer'},'원문 보기 ↗'):null));return}
  app.replaceChildren(el('section',{class:'archive'},el('h1',{},'행사 기록'),el('div',{class:'event-grid'},...pages.map(p=>el('a',{class:'event-card',href:'/events/'+p.id},cover(p.id),el('h2',{},p.title),el('p',{},p.summary),el('span',{},'기록 읽기 ↗'))))))
}
async function visit(data){
  const view=stage(),bottom=el('div',{class:'place-sheet',hidden:''})
  let world
  const back=button('← 전체 공간',()=>{world?.selectRoom(null)},'back');back.hidden=true
  const tools=el('div',{class:'map-tools'},button('＋',()=>world?.zoom(.25)),button('−',()=>world?.zoom(-.25)))
  tools.children[0].ariaLabel='확대';tools.children[1].ariaLabel='축소'
  const heading=el('h1',{},'리라지의 공간')
  view.host.append(el('div',{class:'map-heading'},heading,el('p',{},'방을 선택해 그곳의 행사를 만나보세요.')),back,tools,bottom)
  app.replaceChildren(view.host)
  function open(s){
    const p=data.layout.pages.find(p=>p.id===s.action.page)
    const link=p?detailLink(p):el('a',{class:'primary',href:s.action.url,target:'_blank',rel:'noopener noreferrer'},'링크 열기 ↗')
    bottom.replaceChildren(p?cover(p.id):null,el('div',{},el('h2',{},s.label),p?el('p',{},p.summary):null,link),button('닫기',()=>bottom.hidden=true,'close'))
    bottom.hidden=false
  }
  try{
    const {createScene}=await import('./scene.js')
    world=await createScene(view,data,{onRoom(id){
      back.hidden=!id;bottom.hidden=true;heading.textContent=data.rooms.find(r=>r.id===id)?.label||'리라지의 공간'
      const info=heading.nextElementSibling
      info.textContent=!id?'방을 선택해 그곳의 행사를 만나보세요.':data.layout.spots.some(s=>s.anchor===id||data.layout.items.some(i=>i.room===id&&i.id===s.anchor))?'표시를 눌러 행사 기록을 열어보세요.':'이 방에 연결된 행사 기록이 아직 없습니다.'
    },onSpot:open})
  }catch(e){view.loading.replaceChildren('3D 공간을 열 수 없습니다. ',el('a',{href:'/events'},'행사 기록 보기'));console.error(e)}
}
try{
  if(route==='/studio'&&!small())await (await import('./studio.js')).studio()
  else {
    const state=await api('world')
    if(route.startsWith('/events'))events(state.layout.pages,route.split('/')[2])
    else await visit(state)
  }
}catch(e){app.replaceChildren(el('p',{class:'error'},e.message),el('a',{href:'/'},'공간으로 돌아가기'))}
