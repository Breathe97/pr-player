import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { name } from './package.json'

// https://vite.dev/config/
export default defineConfig(() => {
  return {
    plugins: [vue()],
    base: `/${name}`,
    build: {
      outDir: `dist_${name}`
    }
  }
})
