import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { optimize } from './optimize.mjs'
const dir = '.world/models/initial'
mkdirSync(dir,{recursive:true})
if (!existsSync(dir+'/source.blend') || !existsSync(dir+'/raw.glb'))
  execFileSync('.venv/bin/python',['world/worker.py','bootstrap','assets-source/riragi-v06/full/riraji_full.blend',dir],{stdio:'inherit'})
const catalog = JSON.parse(readFileSync(dir+'/catalog.json'))
await optimize(dir+'/raw.glb',dir+'/editor.glb',catalog.rooms.map(r=>r.id))
