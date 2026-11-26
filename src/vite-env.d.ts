/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Mapbox access token for drives with traffic; set at build time, never committed. */
  readonly VITE_MAPBOX_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
