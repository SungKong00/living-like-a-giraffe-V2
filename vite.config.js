import { defineConfig } from 'vite'
import path from 'node:path'
export default defineConfig({
  root: 'web',
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
