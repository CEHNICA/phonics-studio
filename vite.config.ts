import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    /**
     * 用 preact/compat 顶替 React 运行时。
     *
     * 背景：线上实测阿里 CDN 对 .js **不启用 gzip/br**（HTML/CSS 会压，JS 不会），
     * 所以产物字节数就是真实下载量。react-dom 单个模块就 202KB（占首屏 2/3），
     * 3G 下光这一个文件就要下 4 秒。
     *
     * preact/compat 是 React API 兼容层，本项目只用到 createRoot / hooks /
     * lazy / Suspense / forwardRef，没有用 React 19 特有 API（use/useOptimistic 等），
     * 因此可以直接替换。
     *
     * alias 顺序敏感：更具体的后缀必须排在前面，否则 'react' 会先把 'react-dom' 吃掉。
     */
    alias: {
      'react-dom/client': 'preact/compat/client',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
      react: 'preact/compat',
    },
  },
  build: {
    // 输出 dist/.vite/manifest.json：让体检器能精确算出「首屏真正加载哪些 chunk」
    manifest: true,
  },
})
