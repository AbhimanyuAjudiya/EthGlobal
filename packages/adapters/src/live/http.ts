/** Small helpers around protocol's httpJson (the one HTTP client); no second client lives here. */
export const withFetch = (fetchFn: typeof fetch | undefined): { fetch?: typeof fetch } =>
  fetchFn ? { fetch: fetchFn } : {};

/** Refuses a base URL that is not https (localhost excepted) or whose host is not in `allowedHosts` (T-42). */
export function checkedBaseUrl(raw: string, allowedHosts?: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`${url.origin} must use https`);
  }
  if (allowedHosts && !allowedHosts.includes(url.hostname)) {
    throw new Error(`${url.hostname} is not an allowed host (${allowedHosts.join(', ')})`);
  }
  if (url.username || url.password) throw new Error('credentials in URLs are refused');
  return url;
}

/** `base` + `path`, keeping the base's own path prefix (e.g. /facilitator, /api/v1/open). */
export const joinUrl = (base: URL, path: string): string =>
  `${base.origin}${base.pathname.replace(/\/$/, '')}${path}`;
