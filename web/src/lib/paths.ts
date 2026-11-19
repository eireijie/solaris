/**
 * Resolve URLs to files in `public/` so they work from any static host and any
 * sub-path, from both entry points (`/index.html` and `/demo/index.html`).
 *
 * - If VITE_BASE was set to an absolute path (e.g. "/solaris/"), that is used.
 * - Otherwise (default base "./") each HTML entry declares where the site root is,
 *   relative to itself, in <meta name="solaris-root" content="./" | "../">.
 *   We resolve that against the document URL (hash routing keeps the path stable).
 */
let cachedRoot: string | null = null;

export function appRoot(): string {
  if (cachedRoot) return cachedRoot;
  const base = import.meta.env.BASE_URL;
  if (base.startsWith("/") || /^https?:/.test(base)) {
    cachedRoot = new URL(base, window.location.href).href;
  } else {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="solaris-root"]');
    cachedRoot = new URL(meta?.content || "./", window.location.href).href;
  }
  if (!cachedRoot.endsWith("/")) cachedRoot += "/";
  return cachedRoot;
}

/** Absolute URL for a path inside `public/`, e.g. publicUrl("data/co2_bundle.json"). */
export function publicUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ""), appRoot()).href;
}

/** URL of the platform app (from either entry), optionally with a hash route. */
export function platformUrl(route = "/"): string {
  return `${appRoot()}#${route}`;
}

/** URL of the demo page. */
export function demoUrl(): string {
  return `${appRoot()}demo/`;
}
