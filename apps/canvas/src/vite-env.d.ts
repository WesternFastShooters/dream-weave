interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_DW_LOCAL_AUTO_LOGIN_EMAIL?: string;
  readonly VITE_DW_LOCAL_AUTO_LOGIN_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
