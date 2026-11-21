/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端类型：'worker'；留空表示纯本地模式 */
  readonly VITE_BACKEND_KIND?: string;
  /** 后端地址：Cloudflare Pages Functions 的站点根地址 */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
