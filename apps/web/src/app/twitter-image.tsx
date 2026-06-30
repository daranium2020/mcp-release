export { default, size, contentType, alt } from "./opengraph-image";

// Declared directly so Next.js static analysis can recognize the route segment
// config (re-exported values from another file are not detected by the bundler).
export const runtime = "nodejs";
