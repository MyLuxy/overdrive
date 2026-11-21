// The package helper: the server that hands a PKG to the PS5's own Downloads (pkg_proxy.cpp), run as
// a payload of its own so the console keeps fetching after Overdrive closes. The app starts it once
// (Packages.startHelper) and talks to it over HTTP on 127.0.0.1 with a secret only this console knows;
// a later session finds the same helper again on the port and secret kept in pkg-helper.json, or
// starts a new one there when the console restarted in between.

  function randomSecret() {
    let text = "";
    while (text.length < 40) text += Math.floor(Math.random() * 2 ** 32).toString(36);
    return text.slice(0, 40) + Date.now().toString(36);
  }

  // "token=…\nurl=…" into { token, url, … }.
  function fields(text) {
    const out = {};
    for (const line of String(text).split("\n")) {
      const mark = line.indexOf("=");
      if (mark > 0) out[line.slice(0, mark)] = line.slice(mark + 1).trim();
    }
    return out;
  }

  function createPkgHelper({ packages, http, fs, dir, log = "" }) {
    const file = `${dir}/pkg-helper.json`;
    let config = null;
    let starting = null;
    try {
      const saved = JSON.parse(String(fs.readFile(file)));
      if (Number.isInteger(saved?.port) && typeof saved.secret === "string" && saved.secret.length >= 16) config = saved;
    } catch {
    }
    const keep = () => {
      try {
        fs.mkdir(dir, { recursive: true });
        fs.writeFile(file, JSON.stringify(config), { sync: true });
      } catch (error) {
        console.log(`[pkg-helper] not saved: ${error.message}`);
      }
    };
    const base = () => `http://127.0.0.1:${config.port}/control/${config.secret}`;
    const call = async (command, body) => {
      const response = await http.request(`${base()}/${command}`, {
        maxBytes: 256 * 1024,
        ...body == null ? {} : { method: "POST", headers: { "Content-Type": "text/plain" }, body }
      });
      const text = await response.text();
      if (response.status !== 200) throw new Error(`the helper answered HTTP ${response.status} to ${command}: ${text.trim().slice(0, 120)}`);
      return text;
    };
    const alive = async () => {
      if (!config) return false;
      try {
        return (await call("ping")).startsWith("ok");
      } catch {
        return false;
      }
    };

    /** Makes sure the helper runs: the one already there, or a new one on the same port. */
    async function ensure() {
      if (await alive()) return;
      starting ?? (starting = (async () => {
        const wanted = config ?? { port: 0, secret: randomSecret() };
        const { port } = await packages.startHelper({ port: wanted.port, secret: wanted.secret, log });
        if (wanted.port && port !== wanted.port) console.log(`[pkg-helper] port ${wanted.port} was taken; the helper listens on ${port}`);
        config = { port, secret: wanted.secret };
        keep();
        console.log(`[pkg-helper] started on port ${port}`);
      })().finally(() => {
        starting = null;
      }));
      await starting;
    }

    /** Serves a link: { url, localUrl, token, port }; a token of before asks for that same link. */
    async function add({ url, total, file, token = "" }) {
      await ensure();
      const served = fields(await call("add", `${token || "-"}\n${total}\n${url}\n${file || "package"}\n`));
      if (!served.token) throw new Error("the helper named no link");
      return { url: served.url || "", localUrl: served.local || "", token: served.token, port: Number(served.port) || config.port, background: true };
    }

    /** What the console fetched of each link: [{ token, total, delivered, requests, idleMs }]. */
    async function stats() {
      if (!config) return [];
      const text = await call("stats");
      return text.split("\n").filter(Boolean).map((line) => {
        const [token, total, delivered, requests, idleMs, gets = "0", asked = "0"] = line.split(" ");
        return { token, total: Number(total), delivered: Number(delivered), requests: Number(requests), idleMs: Number(idleMs), gets: Number(gets), asked: Number(asked) };
      });
    }

    async function remove(token) {
      if (!config) return;
      try {
        await call("remove", `${token}\n`);
      } catch {
      }
    }

    return { ensure, add, stats, remove, alive };
  }

export { createPkgHelper, fields };
