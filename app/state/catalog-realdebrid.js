import { createRealDebrid } from './realdebrid.js';
import { refreshRealDebrid } from './device-login.js';
import { webURL } from './download-sources.js';

function createCatalogRealDebridResolver({ http, getSettings, saveSettings, fallback,
  now = Date.now, log = message => console.log(message), createClient }) {
  let cached = {}, expires = 0, cachedKey;

  function client(settings) {
    if (createClient) return createClient(settings);
    const renew = settings.realdebridRefresh && settings.realdebridClient && settings.realdebridSecret
      ? async ({ signal }) => {
        const token = await refreshRealDebrid({ http, client: settings.realdebridClient,
          secret: settings.realdebridSecret, refresh: settings.realdebridRefresh, signal });
        saveSettings(token);
        return token;
      } : null;
    return createRealDebrid({ http, key: settings.realdebrid, renew,
      expiresAt: Number(settings.realdebridExpires) || 0 });
  }

  async function resolve(release, context = {}) {
    const settings = getSettings();
    if (!context.catalog || !settings.realdebrid || context.directURL || release.manifestUrl ||
        release.headers && Object.keys(release.headers).length) return fallback.resolve(release, context);
    const url = release.browserUrl || release.url;
    let host, service;
    try {
      host = webURL(url).host;
      service = client(settings);
      if (cachedKey !== settings.realdebrid || now() >= expires) {
        const rows = await service.hosts({ signal: context.signal });
        if (!rows || typeof rows !== 'object' || Array.isArray(rows)) throw new Error('Invalid host list');
        cached = rows; cachedKey = settings.realdebrid; expires = now() + 5 * 60e3;
      }
      const domain = Object.keys(cached).find(value => /^[a-z0-9][a-z0-9.-]*\.[a-z0-9]+$/.test(value) &&
        (host === value || host.endsWith(`.${value}`)));
      if (!domain || cached[domain]?.supported !== 1 || cached[domain]?.status !== 'up')
        return fallback.resolve(release, context);
    } catch (error) {
      if (context.signal?.aborted || error.name === 'AbortError') throw error;
      cached = {}; cachedKey = settings.realdebrid; expires = now() + 30e3;
      log('[realdebrid-auto] Host list unavailable; using the original source');
      return fallback.resolve(release, context);
    }
    try {
      log(`[realdebrid-auto] Preparing ${host} through Real-Debrid`);
      context.onProgress?.({ service: 'Real-Debrid', progress: 0 });
      const prepared = await service.prepare(url, { signal: context.signal });
      webURL(prepared.url);
      log(`[realdebrid-auto] ${host} converted through Real-Debrid`);
      return { url: prepared.url, rejectHtml: true, viaRealDebrid: true,
        ...(Number.isSafeInteger(prepared.sizeBytes) && prepared.sizeBytes > 0
          ? { expectedBytes: prepared.sizeBytes } : {}) };
    } catch (error) {
      if (context.signal?.aborted || error.name === 'AbortError') throw error;
      log(`[realdebrid-auto] Conversion failed for ${host}; using the original source`);
    } finally {
      context.onProgress?.(null);
    }
    return fallback.resolve(release, context);
  }
  return { resolve };
}

export { createCatalogRealDebridResolver };
