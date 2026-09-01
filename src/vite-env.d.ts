/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_BASE_URL?: string;
  readonly VITE_DOWNLOAD_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
