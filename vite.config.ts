import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import VueRouter from 'vue-router/vite';

export default defineConfig({
  plugins: [VueRouter({ routesFolder: 'src/pages', dts: 'src/typed-router.d.ts' }), vue(), tailwindcss()],
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
});
