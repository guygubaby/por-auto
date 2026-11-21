import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API_TARGET = 'https://por-auto.guygubaby.top'

// postcss 只是 Vite 的传递依赖，不额外引入类型；这里用最小结构描述用到的部分。
interface CssAtRule {
  nodes?: unknown[] | null
  params: string
  remove(): void
  replaceWith(...nodes: unknown[]): void
}

/**
 * 老 Android WebView（Chromium < 99）不认识 @layer，会把 Tailwind 整段丢掉，
 * 页面只剩裸 HTML；Chromium < 104 也解析不了 `(width>=40rem)` 这种范围写法。
 * 在 PostCSS 阶段摊平这两样，旧手机才能按设计稿排版，现代浏览器结果不变。
 */
const legacyCss = {
  postcssPlugin: 'por-auto-legacy-css',
  OnceExit(root: { walkAtRules: (name: string, callback: (rule: CssAtRule) => void) => void }) {
    root.walkAtRules('layer', (rule) => {
      // 去掉包装、保留里面的规则；`@layer a, b;` 这类空声明直接删掉。
      if (rule.nodes?.length) rule.replaceWith(...rule.nodes)
      else rule.remove()
    })
    root.walkAtRules('media', (rule) => {
      rule.params = rule.params.replace(/\(width\s*>=\s*([^)]+)\)/g, '(min-width:$1)')
    })
  },
}

export default defineConfig({
  base: '/',
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  css: {
    postcss: { plugins: [legacyCss] },
  },
  // 默认目标下 Lightning CSS 压缩会把 min-width 改回 `(width>=…)` 范围写法，旧内核不认。
  build: {
    cssTarget: 'chrome87',
  },
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/latest': { target: API_TARGET, changeOrigin: true },
    },
  },
})
