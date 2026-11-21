// 旧 Android WebView（Chromium < 99 / < 104）不认 @layer 和 `(width>=…)`，
// 产物里再出现就说明 PostCSS 或 cssTarget 配置被改回去了，直接让构建失败。
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('../dist/assets/', import.meta.url)
let failed = false
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.css')) continue
  const css = readFileSync(new URL(name, dir), 'utf8')
  if (css.includes('@layer') || /\(width\s*>=/.test(css)) {
    console.error(`✗ ${name} 里有旧内核不认的 CSS（@layer 或范围 media query）`)
    failed = true
  }
}
if (failed) process.exit(1)
console.log('✓ CSS 兼容老 WebView')
