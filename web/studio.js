import {app,api,el,button,stage,notify} from './ui.js'
import {EditHistory} from './history.js'
import {createScene} from './scene.js'
import {GizmoManager} from '@babylonjs/core/Gizmos/gizmoManager'
import {Quaternion} from '@babylonjs/core/Maths/math.vector'
const key=()=>crypto.randomUUID()
const field=(name,node)=>el('label',{},name,node)
const safe=fn=>async()=>{try{await fn()}catch(e){notify(e.message)}}
function input(value,change,type='text'){
  const n=el('input',{type,value})
  n.onchange=()=>change(type==='number'?Number(n.value):n.value)
  return n
}
function select(list,value,change){
  const n=el('select',{},...list.map(([id,title])=>el('option',{value:id},title)))
  n.value=value;n.onchange=()=>change(n.value);return n
}
function vec(value,fn){
  return el('div',{class:'group'},...value.map((v,i)=>{
    const n=input(Math.round(v*100)/100,val=>{const next=value.slice();next[i]=val;fn(next)},'number')
    n.step='.1';n.ariaLabel=['X','Y','Z'][i];return n
  }))
}
function login(){
  const secret=el('input',{type:'password',autocomplete:'current-password',required:''})
  const form=el('form',{class:'login'},el('h1',{},'월드 스튜디오'),field('관리자 키',secret),el('button',{class:'primary'},'스튜디오 열기'))
  form.onsubmit=async e=>{e.preventDefault();try{await api('login','POST',{key:secret.value});await studio()}catch(err){notify(err.message)}}
  app.replaceChildren(form)
}
export async function studio(){
  let saved
  try{saved=await api('admin/draft')}catch(e){if(e.status===401){login();return}throw e}
  const history=new EditHistory(saved.layout),view=stage()
  const layers=el('aside',{class:'panel layers'}),panel=el('aside',{class:'panel'}),status=el('small',{'aria-live':'polite'})
  const sync=el('small',{}),undo=button('되돌리기',()=>{history.undo();refresh()}),redo=button('다시 실행',()=>{history.redo();refresh()})
  let selected={type:'item',id:saved.layout.items[0]?.id},world,gizmo,mode='position',candidate,choices={}
  const dirty=()=>JSON.stringify(history.value)!==JSON.stringify(saved.layout)
  async function save(){
    if(dirty())saved=await api('admin/draft','PUT',{revision:saved.id,layout:history.value})
    sync.textContent='저장됨'
  }
  const bar=el('div',{class:'studio-bar'},el('strong',{},'월드 스튜디오'),sync,undo,redo,button('초안 저장',safe(save)),button('발행',safe(async()=>{await save();await api('admin/publish','POST',{revision:saved.id});await poll()}),'primary'),status)
  app.replaceChildren(bar,el('div',{class:'desk'},layers,view.host,panel))
  function choose(type,id){selected={type,id};render()}
  function refresh(){world?.update(history.value);render()}
  function change(fn){history.change(fn);refresh()}
  function changeRow(list,id,patch){change(data=>Object.assign(data[list].find(o=>o.id===id),patch))}
  function setMode(m){
    mode=m;gizmo.attachToNode(null)
    gizmo.positionGizmoEnabled=m==='position';gizmo.rotationGizmoEnabled=m==='rotation';gizmo.scaleGizmoEnabled=m==='scale'
    render()
  }
  function itemForm(i){
    const patch=p=>changeRow('items',i.id,p)
    const rotation=Quaternion.FromArray(i.rotation).toEulerAngles()
    const angle=input(Math.round(rotation.y*180/Math.PI),deg=>patch({rotation:Quaternion.FromEulerAngles(rotation.x,deg*Math.PI/180,rotation.z).asArray()}),'number')
    const duplicate=()=>{const id=key();selected={type:'item',id};change(d=>d.items.push({...structuredClone(i),id,label:i.label+' 복제',position:[i.position[0]+2,i.position[1],i.position[2]]}))}
    return [el('h2',{},'가구 속성'),field('이름',input(i.label,label=>patch({label}))),field('위치 · X / 높이 / Z',vec(i.position,position=>patch({position}))),field('회전 각도',angle),field('크기',vec(i.scale,scale=>patch({scale}))),
      field('가구 색',input(i.color==='original'?'#ac7958':i.color,color=>patch({color}),'color')),button('원본 색',()=>patch({color:'original'})),
      field('표면',select([['original','원본'],['matte','무광'],['gloss','유광']],i.finish,finish=>patch({finish}))),
      button('복제',duplicate),button('클릭 영역 추가',()=>addSpot(i.id)),
      button('삭제',()=>change(d=>{if(d.spots.some(s=>s.anchor===i.id)){notify('연결된 클릭 영역을 먼저 옮기거나 삭제하세요.');return}d.items=d.items.filter(o=>o.id!==i.id)}))]
  }
  function addSpot(anchor){
    const page=history.value.pages[0];if(!page){notify('행사 페이지를 먼저 추가하세요.');return}
    const id=key();selected={type:'spot',id}
    change(d=>d.spots.push({id,anchor,label:'새 안내',position:[0,1,0],size:[2,2,2],action:{type:'page',page:page.id}}))
  }
  function spotForm(s,d){
    const patch=p=>changeRow('spots',s.id,p)
    const target=select([...saved.rooms,...d.items].map(r=>[r.id,r.label]),s.anchor,anchor=>patch({anchor}))
    const dest=select([...d.pages.map(p=>[p.id,p.title]),['__url','외부 링크']],s.action.page||'__url',v=>patch({action:v==='__url'?{type:'url',url:'https://example.org'}:{type:'page',page:v}}))
    return [el('h2',{},'클릭 영역'),field('표시 이름',input(s.label,label=>patch({label}))),field('기준 방 또는 가구',target),field('상대 위치',vec(s.position,position=>patch({position}))),field('클릭 범위',vec(s.size,size=>patch({size}))),field('연결',dest),
      s.action.type==='url'?field('주소',input(s.action.url,url=>patch({action:{type:'url',url}}),'url')):null,
      button('영역 삭제',()=>change(data=>data.spots=data.spots.filter(o=>o.id!==s.id)))]
  }
  function pageForm(p){
    const patch=v=>changeRow('pages',p.id,v)
    const body=el('textarea',{},p.body);body.onchange=()=>patch({body:body.value})
    return [el('h2',{},'행사 페이지'),field('제목',input(p.title,title=>patch({title}))),field('개요',input(p.summary,summary=>patch({summary}))),field('본문',body),field('원문 주소',input(p.url,url=>patch({url}),'url'))]
  }
  async function upload(file){
    if(!file)return
    await save();notify('Blender 파일을 확인하고 있습니다.')
    candidate=await api('admin/upload','POST',file);choices={};render()
  }
  async function accept(){
    if(dirty())throw Error('재인계 검토 중 변경되었습니다. 저장 후 다시 검토하세요.')
    await api('admin/import','POST',{...candidate,choices})
    location.reload()
  }
  function handoff(){
    const file=el('input',{type:'file',accept:'.blend'})
    file.onchange=safe(()=>upload(file.files[0]))
    const group=el('details',{},el('summary',{},'전체 Blender 파일 인계'),
      button('저장한 초안 내려받기',safe(async()=>{await save();location.assign('/api/admin/download/draft')})),
      el('a',{class:'action',href:'/api/admin/download/published'},'공개본 내려받기'),field('수정본 업로드',file))
    if(candidate){
      group.open=true
      for(const c of candidate.conflicts)group.append(field(c.key,select([['','선택'],['web','웹 · '+JSON.stringify(c.web)],['file','제작본 · '+JSON.stringify(c.file)]],choices[c.key]||'',v=>choices[c.key]=v)))
      group.append(button('검토 결과를 초안에 적용',safe(accept)))
    }
    return group
  }
  function render(){
    const d=history.value
    sync.textContent=dirty()?'저장되지 않은 변경':'저장됨'
    function row(type,o,name){return button(name,()=>choose(type,o.id),selected.type===type&&selected.id===o.id?'chosen':'')}
    layers.replaceChildren(el('h2',{},'장면 목록'),...saved.rooms.flatMap(r=>[
      row('room',r,r.label),...d.items.filter(i=>i.room===r.id).map(i=>row('item',i,'↳ '+i.label))]),
      el('h3',{},'클릭 영역'),...d.spots.map(s=>row('spot',s,s.label)),
      el('h3',{},'행사 페이지'),...d.pages.map(p=>row('page',p,p.title)),
      button('＋ 페이지',()=>{const id=key();selected={type:'page',id};change(data=>data.pages.push({id,title:'새 행사',summary:'',body:'',url:''}))}))
    const i=d.items.find(o=>o.id===selected.id&&selected.type==='item'),s=d.spots.find(o=>o.id===selected.id&&selected.type==='spot'),p=d.pages.find(o=>o.id===selected.id&&selected.type==='page')
    const r=saved.rooms.find(o=>o.id===selected.id&&selected.type==='room')
    const form=i?itemForm(i):s?spotForm(s,d):p?pageForm(p):r?[el('h2',{},r.label),button('방 확대',()=>world.selectRoom(r.id)),button('클릭 영역 추가',()=>addSpot(r.id))]:[]
    panel.replaceChildren(...form.filter(Boolean),handoff(),el('details',{},el('summary',{},'공개 관리'),button('직전 공개본 복원',safe(async()=>{if(confirm('직전 공개본으로 복원할까요?')){await api('admin/restore','POST');await poll()}}))))
    gizmo?.attachToNode(i?world.instances.get(i.id):null)
    world?.showBox?.(s)
  }
  async function poll(){
    const state=await api('admin/status')
    status.textContent='공개 '+state.published.slice(0,6)+(state.job?' · '+state.job.status:'')
    if(state.job?.error)status.textContent+=' · '+state.job.error
  }
  render();await poll()
  const timer=setInterval(()=>poll().catch(e=>status.textContent=e.message),3000)
  addEventListener('pagehide',()=>clearInterval(timer),{once:true})
  onbeforeunload=e=>{if(dirty()){e.preventDefault();e.returnValue=''}}
  world=await createScene(view,saved,{editing:true,onItem:id=>choose('item',id),onSpot:s=>choose('spot',s.id)})
  gizmo=new GizmoManager(world.scene);gizmo.usePointerToAttachGizmos=false
  for(const type of ['position','rotation','scale']){
    gizmo[type+'GizmoEnabled']=true
    const tool=gizmo.gizmos[type+'Gizmo']
    tool.onDragEndObservable.add(()=>{
      const id=selected.id,n=world.instances.get(id)
      if(n)changeRow('items',id,{position:n.position.asArray(),rotation:n.rotationQuaternion.asArray(),scale:n.scaling.asArray()})
    })
  }
  setMode('position')
  view.host.append(el('div',{class:'map-tools'},button('이동',()=>setMode('position')),button('회전',()=>setMode('rotation')),button('크기',()=>setMode('scale')),button('전체',()=>world.selectRoom(null))))
  document.addEventListener('keydown',e=>{
    if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?history.redo():history.undo();refresh()}
  })
}
