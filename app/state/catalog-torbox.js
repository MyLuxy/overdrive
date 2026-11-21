// Automatically prepare supported catalog hosts through the user's saved TorBox
// account. A failed/offline service leaves the original source available.
import { createTorbox } from './torbox.js';
import { webURL } from './download-sources.js';

const HOSTERS = 'https://api.torbox.app/v1/api/webdl/hosters';
const HOST_TTL = 5 * 60e3;

function matchingHost(rows, host) {
  return rows.find(row => Array.isArray(row?.domains) && row.domains.some(value => {
    if (typeof value !== 'string') return false;
    const domain = value.toLowerCase();
    return /^[a-z0-9][a-z0-9.-]*\.[a-z0-9]+$/.test(domain) &&
      (host === domain || host.endsWith(`.${domain}`));
  }));
}

function createCatalogTorboxResolver({ http, getKey, fallback, now = Date.now,
  createClient = key => createTorbox({ http, key }), log = message => console.log(message) }) {
  let cached = [], expires = 0;

  async function hosters(signal) {
    if (now() < expires) return cached;
    const response = await http.request(HOSTERS, { signal, maxBytes: 1024 * 1024 });
    if (response.status < 200 || response.status >= 300) throw new Error('Host list unavailable');
    const body = JSON.parse(await response.text());
    if (!body?.success || !Array.isArray(body.data)) throw new Error('Invalid host list');
    cached = body.data;
    expires = now() + HOST_TTL;
    return cached;
  }

  async function resolve(release, context = {}) {
    const key = getKey();
    // Captured/manual links and split manifests retain their explicit route.
    if (!context.catalog || !key || context.directURL || release.manifestUrl ||
        release.headers && Object.keys(release.headers).length) return fallback.resolve(release, context);
    const url = release.browserUrl || release.url;
    let host;
    try {
      host = webURL(url).host;
      const entry = matchingHost(await hosters(context.signal), host);
      if (!entry) return fallback.resolve(release, context);
      if (entry.status !== true) {
        log(`[torbox-auto] ${host} is offline at TorBox; using the original source`);
        return fallback.resolve(release, context);
      }
    } catch (error) {
      if (context.signal?.aborted || error.name === 'AbortError') throw error;
      // Back off after an outage instead of querying the API for every catalog row.
      cached = []; expires = now() + 30e3;
      log('[torbox-auto] Host list unavailable; using the original source');
      return fallback.resolve(release, context);
    }
    try {
      log(`[torbox-auto] Preparing ${host} through TorBox`);
      context.onProgress?.({ service: 'TorBox', progress: 0 });
      const prepared = await createClient(key).prepare(url, {
        signal: context.signal,
        onProgress: report => context.onProgress?.({ ...report, service: 'TorBox' }),
      });
      // Validate the result without changing the catalog release, its identity,
      // archive password, hashes, or the selected storage location.
      webURL(prepared.url);
      log(`[torbox-auto] ${host} converted through TorBox`);
      return { url: prepared.url, rejectHtml: true, viaTorbox: true,
        ...(Number.isSafeInteger(prepared.sizeBytes) && prepared.sizeBytes > 0
          ? { expectedBytes: prepared.sizeBytes } : {}) };
    } catch (error) {
      if (context.signal?.aborted || error.name === 'AbortError') throw error;
      // Never log API errors/URLs here: their text can contain the user's key.
      log(`[torbox-auto] Conversion failed for ${host}; using the original source`);
    } finally {
      context.onProgress?.(null);
    }
    return fallback.resolve(release, context);
  }

  return { resolve };
}

export { createCatalogTorboxResolver, matchingHost };
