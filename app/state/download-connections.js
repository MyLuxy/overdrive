import { webURL } from './download-sources.js';

// Apply this when enqueueing too, so saved/resumed jobs get the current policy.
function downloadConnections(options, viaTorbox = false) {
  if (viaTorbox) return 16;
  try {
    const { host } = webURL(options.url);
    if (['tb-cdn.io', 'tb-cdn.st', 'tb-cdn.cx', 'tb-cdn.earth', 'torbox.app'].some(domain =>
      host === domain || host.endsWith(`.${domain}`))) return 16;
  } catch {}
  return 64;
}

export { downloadConnections };
