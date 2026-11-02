import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API_TARGET = 'https://por-auto.guygubaby.top'

export default defineConfig({
  base: '/',
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/latest': { target: API_TARGET, changeOrigin: true },
    },
  },
})
