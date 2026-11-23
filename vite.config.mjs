import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'chrome130'
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
