/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端类型：'worker' | 'supabase'；留空表示纯本地模式 */
  readonly VITE_BACKEND_KIND?: string;
  /** 后端地址：Worker 根地址或 Supabase 项目地址 */
  readonly VITE_BACKEND_URL?: string;
  /** 后端访问凭据：Supabase 的 anon key（Worker 不需要） */
  readonly VITE_BACKEND_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
