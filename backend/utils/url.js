export function normalizeInputUrl(raw) {
  if (!raw) throw new Error("URL required");
  let urlString = raw.trim();
  if (!/^https?:\/\//i.test(urlString)) urlString = "https://" + urlString;
  let u;
  try { u = new URL(urlString); } catch { throw new Error("Invalid URL"); }

  let host = u.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);

  let path = u.pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  return {
    domain: host,
    path: path || "/",
    canonicalUrl: `https://${host}${path === "/" ? "" : path}`
  };
}
