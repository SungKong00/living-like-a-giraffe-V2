import {defineConfig} from 'vite'
import path from 'node:path'
export default defineConfig({root:'web',server:{fs:{strict:true,allow:[path.resolve('web'),path.resolve('node_modules')],deny:['.env*','*.blend','**/.world/**']}},build:{outDir:'../dist',emptyOutDir:true}})
