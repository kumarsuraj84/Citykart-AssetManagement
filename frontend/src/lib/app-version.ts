// S8: set at build time by vite.config.ts (`define`), e.g. the git commit of the release.
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "unknown";
