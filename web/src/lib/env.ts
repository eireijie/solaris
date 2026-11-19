/**
 * Build-time environment (Vite `import.meta.env`). All values here are public.
 *
 *   VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY   accounts (optional — the site works without them)
 *   VITE_PUBLIC_SITE_URL                                deployed platform URL (QR code, auth email links)
 */
const env = import.meta.env as Record<string, string | undefined>;

export const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? "").trim();
export const SUPABASE_KEY = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

/** True when this build was configured with Supabase credentials. */
export const ACCOUNTS_CONFIGURED = /^https:\/\/.+/.test(SUPABASE_URL) && SUPABASE_KEY.length > 20;

/** Fallback when VITE_PUBLIC_SITE_URL is not set: the platform root of the current page. */
function currentRoot(): string {
  if (typeof window === "undefined") return "";
  const { origin, pathname } = window.location;
  // From /demo/ the platform lives one level up.
  const path = pathname.replace(/demo\/(index\.html)?$/, "").replace(/index\.html$/, "");
  return origin + path;
}

/**
 * Public URL of the full platform (with trailing slash). Used for the summit QR code and
 * as the redirect target in account emails. Change it with VITE_PUBLIC_SITE_URL at build time.
 */
export function publicSiteUrl(): string {
  const v = (env.VITE_PUBLIC_SITE_URL ?? "").trim();
  const url = /^https?:\/\//.test(v) ? v : currentRoot();
  return url.endsWith("/") ? url : `${url}/`;
}

/** The site URL without protocol, for printing under the QR code. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
