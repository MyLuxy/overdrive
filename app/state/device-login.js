// Linking a debrid account with the phone instead of typing its key with the controller: the console
// asks the service for a short code, shows it with a QR code of the service's own approval page, and
// waits while the player signs in on the phone and approves Overdrive. The service then hands the
// console a token, saved like a typed key (download-services.js). TorBox and Real-Debrid both have
// this "device flow"; Premiumize's needs a client registered with it, so it keeps the typed key.
//
// TorBox:      GET  /v1/api/user/auth/device/start?app=Overdrive -> device_code, code, interval,
//                   expires_in, verification_url(_complete), friendly_verification_url
//              POST /v1/api/user/auth/device/token {"device_code"} -> DEVICE_CODE_NOT_USED until
//                   approved, then the token (answers checked against the live API, 2026-10-25)
// Real-Debrid: GET  /oauth/v2/device/code?client_id=X245A4XAIBGVM&new_credentials=yes -> device_code,
//                   user_code, interval, expires_in, verification_url, direct_verification_url
//              GET  /oauth/v2/device/credentials?client_id=…&code=<device_code> -> 403 until approved,
//                   then a client_id and client_secret of this user's own
//              POST /oauth/v2/token (client_id, client_secret, code, grant_type) -> access_token,
//                   expires_in, refresh_token; the same call with the refresh token as `code` renews it
// X245A4XAIBGVM is the client Real-Debrid publishes for open-source apps (api.real-debrid.com).

  var TORBOX = "https://api.torbox.app/v1/api/user/auth/device";
  var REALDEBRID = "https://api.real-debrid.com/oauth/v2";
  var OPEN_SOURCE_CLIENT = "X245A4XAIBGVM";
  var DEVICE_GRANT = "http://oauth.net/grant_type/device/1.0";
  var APP = "Overdrive";

  class Expired extends Error {}

  async function json(response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  // "https://tor.box/link" reads better on a TV without its scheme.
  var bare = (url) => String(url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

  function createDeviceLogin({ http, service, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    if (service !== "torbox" && service !== "realdebrid") throw new Error(`${service} has no phone login.`);
    const request = (url, options = {}) => http.request(url, { maxBytes: 64 * 1024, ...options });

    /** Asks for a code: { code, qr, page, expiresAt, interval, device }. */
    async function start({ signal } = {}) {
      if (service === "torbox") {
        const response = await request(`${TORBOX}/start?app=${APP}`, { signal });
        const body = await json(response);
        const data = body?.data;
        if (!body?.success || !data?.device_code || !data.code) throw new Error(body?.detail || `TorBox answered HTTP ${response.status}.`);
        return {
          code: String(data.code),
          qr: data.verification_url_complete || data.verification_url,
          page: bare(data.friendly_verification_url || data.verification_url),
          expiresAt: now() + (Number(data.expires_in) || 600) * 1e3,
          interval: Math.max(2, Number(data.interval) || 5) * 1e3,
          device: data.device_code
        };
      }
      const response = await request(`${REALDEBRID}/device/code?client_id=${OPEN_SOURCE_CLIENT}&new_credentials=yes`, { signal });
      const data = await json(response);
      if (response.status >= 400 || !data?.device_code || !data.user_code) throw new Error(data?.error ? `Real-Debrid: ${data.error}.` : `Real-Debrid answered HTTP ${response.status}.`);
      return {
        code: String(data.user_code),
        qr: data.direct_verification_url || data.verification_url,
        page: bare(data.verification_url),
        expiresAt: now() + (Number(data.expires_in) || 900) * 1e3,
        interval: Math.max(2, Number(data.interval) || 5) * 1e3,
        device: data.device_code
      };
    }

    // One look: null while the player has not approved yet, the credentials once they have.
    async function check(session, { signal } = {}) {
      if (service === "torbox") {
        const response = await request(`${TORBOX}/token`, {
          method: "POST", signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_code: session.device })
        });
        const body = await json(response);
        if (body?.success) {
          const data = body.data;
          // The field is not documented: the usual names first, then any value shaped like a TorBox
          // key (a UUID), so a renamed field still links the account.
          const named = typeof data === "string" ? data : data?.access_token ?? data?.token ?? data?.api_key ?? data?.apikey;
          const token = named ?? Object.values(data || {}).find((value) => typeof value === "string" && /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value));
          if (!named) console.log(`[device-login] torbox: approved, fields ${Object.keys(data || {}).join(", ")}`);
          if (typeof token !== "string" || !token) throw new Error("TorBox approved the console but sent no key.");
          return { torbox: token.trim() };
        }
        const error = String(body?.error || "");
        if (error === "ITEM_NOT_FOUND" || /EXPIRED/i.test(error)) throw new Expired(body?.detail || "The code expired.");
        if (error && error !== "DEVICE_CODE_NOT_USED") console.log(`[device-login] torbox: ${error} ${String(body?.detail || "").slice(0, 120)}`);
        return null;
      }
      const response = await request(`${REALDEBRID}/device/credentials?client_id=${OPEN_SOURCE_CLIENT}&code=${encodeURIComponent(session.device)}`, { signal });
      if (response.status === 403) return null;
      const credentials = await json(response);
      if (response.status >= 400 || !credentials?.client_id || !credentials.client_secret) {
        if (response.status >= 400 && response.status !== 400) console.log(`[device-login] realdebrid credentials: HTTP ${response.status}`);
        return null;
      }
      return tokens({ client: credentials.client_id, secret: credentials.client_secret, code: session.device, signal });
    }

    async function tokens({ client, secret, code, signal }) {
      const form = `client_id=${encodeURIComponent(client)}&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}&grant_type=${encodeURIComponent(DEVICE_GRANT)}`;
      const response = await request(`${REALDEBRID}/token`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form
      });
      const data = await json(response);
      if (response.status >= 400 || !data?.access_token) {
        console.log(`[device-login] realdebrid token: HTTP ${response.status} ${String(data?.error || "").slice(0, 80)}`);
        throw new Error(data?.error ? `Real-Debrid: ${data.error}.` : `Real-Debrid answered HTTP ${response.status}.`);
      }
      return {
        realdebrid: data.access_token,
        realdebridRefresh: data.refresh_token || "",
        realdebridClient: client,
        realdebridSecret: secret,
        realdebridExpires: String(now() + (Number(data.expires_in) || 3600) * 1e3)
      };
    }

    /** Waits until the player approves; throws Expired when the code runs out first. */
    async function approved(session, { signal } = {}) {
      for (;;) {
        if (signal?.aborted) throw new Error("Cancelled.");
        if (now() >= session.expiresAt) throw new Expired("The code expired.");
        await wait(session.interval);
        if (signal?.aborted) throw new Error("Cancelled.");
        let result = null;
        try {
          result = await check(session, { signal });
        } catch (error) {
          if (error instanceof Expired) throw error;
          // A network hiccup is not a refusal: the next look may well get through.
          console.log(`[device-login] ${service}: ${error.message}`);
        }
        if (result) return result;
      }
    }

    return { start, approved, check };
  }

  /** A new Real-Debrid access token from the saved refresh token: what setServices() takes. */
  async function refreshRealDebrid({ http, client, secret, refresh, now = Date.now, signal }) {
    const form = `client_id=${encodeURIComponent(client)}&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(refresh)}&grant_type=${encodeURIComponent(DEVICE_GRANT)}`;
    const response = await http.request(`${REALDEBRID}/token`, {
      method: "POST", signal, maxBytes: 64 * 1024,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });
    const data = await json(response);
    if (response.status >= 400 || !data?.access_token) {
      console.log(`[device-login] realdebrid refresh: HTTP ${response.status} ${String(data?.error || "").slice(0, 80)}`);
      throw new Error("Real-Debrid no longer accepts this console. Link it again in the download settings.");
    }
    console.log("[device-login] realdebrid: token renewed");
    return {
      realdebrid: data.access_token,
      realdebridRefresh: data.refresh_token || refresh,
      realdebridExpires: String(now() + (Number(data.expires_in) || 3600) * 1e3)
    };
  }

  // An email shown on a TV that may be streamed: enough of it to recognise, not to copy.
  var masked = (name) => String(name || "").replace(/^([^@]{0,2})[^@]*(@.*)$/, "$1***$2");

  // Who the key belongs to, for the setup to say so; null when the service does not answer.
  async function accountOf({ http, service, key, signal }) {
    try {
      if (service === "torbox") {
        const response = await http.request("https://api.torbox.app/v1/api/user/me?settings=false", { signal, maxBytes: 256 * 1024, headers: { Authorization: `Bearer ${key}` } });
        const data = (await json(response))?.data;
        if (response.status >= 400 || !data) return null;
        const plans = ["Free", "Essential", "Pro", "Standard"];
        return { name: masked(data.email || data.username), plan: plans[Number(data.plan)] ?? "", until: String(data.premium_expires_at || "").slice(0, 10) };
      }
      if (service === "realdebrid") {
        const response = await http.request("https://api.real-debrid.com/rest/1.0/user", { signal, maxBytes: 64 * 1024, headers: { Authorization: `Bearer ${key}` } });
        const data = await json(response);
        if (response.status >= 400 || !data) return null;
        return { name: masked(data.username || data.email), plan: data.type === "premium" ? "Premium" : String(data.type || ""), until: String(data.expiration || "").slice(0, 10) };
      }
    } catch {
    }
    return null;
  }

export { Expired, accountOf, createDeviceLogin, refreshRealDebrid };
