// The leads list's rules that any business uses (report_leads in core/tools/catalog.ts).

// Profiles on these hosts belong to different businesses, so the profile path is part of the key.
const SHARED_HOSTS = new Set(["instagram.com", "facebook.com", "linktr.ee", "yelp.com", "google.com", "maps.google.com", "tiktok.com", "x.com", "twitter.com", "square.site", "toasttab.com"]);
/** Dedupe key for a lead's website: the host without www., plus the profile path on shared hosts. */
export const domainOf = (url: string) => {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!SHARED_HOSTS.has(host)) return host;
    const path = u.pathname.split("/").filter(Boolean).slice(0, 2).join("/").toLowerCase();
    return path ? `${host}/${path}` : null;
  } catch { return null; }
};
