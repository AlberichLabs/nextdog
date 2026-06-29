// Ambient types for the Vite-injected `import.meta.env` used by the dev harness.
// `VITE_NEXTDOG_SIDECAR_URL` lets `pnpm dev` point the hot-reloaded UI at a
// dev-port sidecar (see scripts/dev.mjs); it is only ever read under
// `import.meta.env.DEV`, so production builds dead-code-eliminate it.
export {};

declare global {
  interface ImportMetaEnv {
    readonly DEV: boolean;
    readonly VITE_NEXTDOG_SIDECAR_URL?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
