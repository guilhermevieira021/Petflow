/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * URL publica da API, sem barra final (ex.: https://api.petflow.app).
   * Vazio/ausente em desenvolvimento -- o proxy do Vite (vite.config.ts)
   * encaminha `/api/*` para a API local na mesma origem.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
