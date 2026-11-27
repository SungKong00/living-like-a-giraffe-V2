import { defineConfig } from 'vite'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
export default defineConfig({
  root: 'web',
  plugins: [
    {
      name: 'studio-biped-sample',
      generateBundle() {
        const model = new URL('./assets-source/characters/riragi-clay/riragi-biped.glb', import.meta.url)
        if (!existsSync(model)) return
        this.emitFile({
          type: 'asset',
          fileName: 'api/admin/characters/files/riragi-biped.glb',
          source: readFileSync(model),
        })
      },
    },
  ],
  server: {
    fs: {
      strict: true,
      allow: [path.resolve('web'), path.resolve('node_modules')],
      deny: ['.env*', '*.blend', '**/.world/**'],
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Babylon loads meshoptimizer's classic script through a script element.
        // Pages serves .cjs with a non-JavaScript MIME type and nosniff.
        assetFileNames: (asset) =>
          asset.names?.includes('meshopt_decoder.cjs')
            ? 'assets/[name]-[hash].js'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
})
