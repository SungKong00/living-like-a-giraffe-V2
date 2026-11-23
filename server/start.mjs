import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import {timingSafeEqual,createHash,randomBytes} from 'node:crypto'
import {createServer} from 'node:http'
import {WorldStore,buildDir,root,modelDir,catalog,conflict} from './store.mjs'
import {Jobs} from './jobs.mjs'
const store=new WorldStore(), jobs=new Jobs(store)
const app=express(),server=createServer(app)
const sessions=new Map()
const tokenPath=path.join(root,'admin-key')
if(!process.env.RIRAGI_ADMIN_KEY&&!fs.existsSync(tokenPath))
  fs.writeFileSync(tokenPath,randomBytes(24).toString('base64url'),{mode:0o600,flag:'wx'})
const key=process.env.RIRAGI_ADMIN_KEY||fs.readFileSync(tokenPath,'utf8').trim()
const hash=s=>createHash('sha256').update(s).digest()
app.disable('x-powered-by')
app.use('/api',(req,res,next)=>{
  res.set('Cache-Control','no-store')
  if(req.method!=='GET'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return res.sendStatus(403)
  next()
})
app.use(express.json({limit:'2mb'}))
app.post('/api/login',(req,res)=>{
  if(typeof req.body?.key!=='string'||!timingSafeEqual(hash(key),hash(req.body.key)))return res.sendStatus(403)
  const sid=randomBytes(32).toString('hex')
  for(const [id,end] of sessions)if(end<Date.now())sessions.delete(id)
  sessions.set(sid,Date.now()+8*3600e3)
  res.cookie('riragi',sid,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:8*3600e3,path:'/api'}).json({ok:true})
})
app.use('/api/admin',(req,res,next)=>{
  const sid=/\briragi=([a-f0-9]{64})\b/.exec(req.headers.cookie||'')?.[1]
  if(!(sessions.get(sid)>Date.now()))return res.sendStatus(401)
  next()
})
function view(snap,admin=false){
  return {id:snap.id,layout:snap.layout,rooms:catalog(snap.model).rooms,asset:admin?'/api/admin/model/'+snap.model:'/api/world/'+snap.asset}
}
app.get('/api/world',(req,res)=>res.json(view(store.state.published)))
app.get('/api/world/:id',(req,res)=>{
  // Only assets which have completed publication receive a public route.
  if(!/^(initial|[a-f0-9]{64})$/.test(req.params.id))return res.sendStatus(404)
  const file=path.join(buildDir(req.params.id),'world.glb')
  if(!fs.existsSync(file))return res.sendStatus(404)
  res.set('Cache-Control','public, max-age=31536000, immutable').sendFile(file,{dotfiles:'allow'})
})
app.get('/api/admin/draft',(req,res)=>res.json(view(store.state.draft,true)))
app.get('/api/admin/model/:id',(req,res)=>{
  if(!/^(initial|[a-f0-9-]{36})$/.test(req.params.id))return res.sendStatus(404)
  res.sendFile(path.join(modelDir(req.params.id),'editor.glb'),{dotfiles:'allow'})
})
app.put('/api/admin/draft',(req,res)=>res.json(view(store.edit(req.body.revision,store.state.draft.model,req.body.layout),true)))
app.get('/api/admin/status',(req,res)=>{const s=store.state;res.json({published:s.published.id,previous:!!s.previous,job:s.job})})
app.post('/api/admin/publish',(req,res)=>res.status(202).json({job:jobs.publish(req.body.revision)}))
app.post('/api/admin/restore',(req,res)=>{store.restore();res.json({ok:true})})
app.get('/api/admin/download/:which',async(req,res)=>{
  if(!['draft','published'].includes(req.params.which))return res.sendStatus(404)
  const snap=store.state[req.params.which]
  res.download(await jobs.download(snap),'riragi-'+snap.id.slice(0,8)+'.blend',{dotfiles:'allow'})
})
app.post('/api/admin/upload',express.raw({type:'application/octet-stream',limit:'250mb'}),async(req,res)=>{
  if(!Buffer.isBuffer(req.body))return res.sendStatus(415)
  res.json(await jobs.upload(req.body))
})
app.post('/api/admin/import',(req,res)=>{
  const {model,revision,publication,choices,spots}=req.body
  const result=jobs.compare(model,choices)
  if(result.revision!==revision||result.publication!==publication||result.conflicts.length)throw conflict('최신 개정에서 충돌을 다시 확인하세요.')
  const layout={...store.state.draft.layout,items:result.items}
  if(spots)layout.spots=spots
  res.json(view(store.edit(revision,model,layout),true))
})
app.get('/api/admin/compare/:id',(req,res)=>res.json(jobs.compare(req.params.id)))
app.use('/api',(req,res)=>res.sendStatus(404))
app.use((err,req,res,next)=>res.status(err.status||400).json({error:err.message}))
if(process.argv.includes('--production')){
  app.use(express.static('dist'))
  app.get('/{*path}',(req,res)=>res.sendFile(path.resolve('dist/index.html')))
}else{
  const {createServer:createVite}=await import('vite')
  const vite=await createVite({server:{middlewareMode:true,hmr:{server}},appType:'spa'})
  app.use(vite.middlewares)
}
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('리라지 월드 http://127.0.0.1:'+server.address().port))
