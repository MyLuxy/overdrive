// Archive.org account (2026-10-25): the collections' restricted items answer HTTP 401 unless the
// request carries the cookies of a signed-in account; HTTP Basic is not accepted there (the node
// answers a bare 401, with no WWW-Authenticate). The sign-in is the one the official `ia` CLI uses,
// POST https://archive.org/services/xauthn/?op=login with the email and the password, whose JSON
// answer holds the two cookies:
//
//     { "success": true, "values": { "cookies": { "logged-in-user": "...", "logged-in-sig": "..." },
//                                    "screenname": "..." } }
//
// The cookies live in memory for this launch; settings.json holds the credentials beside the other
// services' (download-services.js), so a download can sign in without asking again.
//
// They go on the transfer as a `Cookie` header. A custom header turns the runtime's own redirect
// following off (ps5-react docs/NETWORKING.md), so the archival /download/ URL is followed here to
// the node that serves the file, before the download is queued.

import { useEffect, useState } from "react";
import { webURL } from "./download-sources.js";
import { loadList, saveList } from "./saved.js";
import { Http } from "@ps5-react/core";

  var SETTINGS = "settings.json";
  var FIELDS = { user: "archiveUser", password: "archivePassword" };
  var LOGIN = "https://archive.org/services/xauthn/?op=login";
  // One request header value is at most 2048 bytes (docs/NETWORKING.md).
  var MAX_COOKIE = 2000;
  var text = (value) => typeof value === "string" ? value : "";

  function loginMessage(answer) {
    const reason = text(answer?.values?.reason) || text(answer?.error);
    if (reason === "account_not_found") return "Archive.org has no account with that email.";
    if (reason === "account_bad_password") return "Archive.org refused that password.";
    return reason ? `Archive.org refused the sign-in: ${reason}.` : "Archive.org refused the sign-in.";
  }

  function createArchiveAccount({ http, read = () => loadList(SETTINGS, "settings"), write = (settings) => saveList(SETTINGS, "settings", settings), log = console.log } = {}) {
    var stored = read() ?? {};
    var credentials = { user: text(stored[FIELDS.user]).trim(), password: text(stored[FIELDS.password]) };
    // { cookie, screenname, at } while this launch is signed in; the password itself is not kept here.
    var session = null;
    var listeners = /* @__PURE__ */ new Set();

    function snapshot() {
      return { user: credentials.user, passwordSet: Boolean(credentials.password), signedIn: Boolean(session), screenname: session?.screenname || "" };
    }
    function notify() {
      const value = snapshot();
      for (const listener of listeners) listener(value);
    }
    function subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    }
    function enabled() {
      return Boolean(credentials.user && credentials.password);
    }
    // archive.org and the nodes that serve its files (dn123.ca.archive.org, ia456.us.archive.org):
    // the cookies are never sent anywhere else.
    function isArchive(url) {
      try {
        const host = webURL(url).host;
        return host === "archive.org" || host.endsWith(".archive.org");
      } catch {
        return false;
      }
    }
    function setField(field, value) {
      if (!(field in FIELDS)) throw new Error("Unknown Archive.org field.");
      const next = field === "password" ? text(value) : text(value).trim();
      if (next === credentials[field]) return;
      const settings = read() ?? {};
      const { [FIELDS[field]]: _old, ...rest } = settings;
      write(next ? { ...rest, [FIELDS[field]]: next } : rest);
      credentials = { ...credentials, [field]: next };
      // A session belongs to the account it was opened for: a new credential signs in again.
      session = null;
      notify();
    }
    async function login() {
      if (!enabled()) throw new Error("Enter your Archive.org email and password first.");
      const response = await http.request(LOGIN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `email=${encodeURIComponent(credentials.user)}&password=${encodeURIComponent(credentials.password)}`,
        maxBytes: 64 * 1024
      });
      let answer = null;
      try {
        answer = JSON.parse(await response.text());
      } catch {}
      if (!response.ok) throw new Error(`Archive.org answered HTTP ${response.status}.`);
      if (!answer?.success) throw new Error(loginMessage(answer));
      const cookies = answer.values?.cookies ?? {};
      const user = text(cookies["logged-in-user"]);
      const sig = text(cookies["logged-in-sig"]);
      const cookie = `logged-in-user=${user}; logged-in-sig=${sig}`;
      if (!user || !sig || cookie.length > MAX_COOKIE || /[\r\n]/.test(cookie))
        throw new Error("Archive.org did not return a usable session. Try again.");
      session = { cookie, screenname: text(answer.values?.screenname) || credentials.user, at: Date.now() };
      log(`[archive] signed in as ${session.screenname}`);
      return session;
    }
    async function signIn() {
      session = null;
      const opened = await login();
      notify();
      return opened;
    }
    async function signOut() {
      session = null;
      const settings = read() ?? {};
      const next = { ...settings };
      delete next[FIELDS.user];
      delete next[FIELDS.password];
      write(next);
      credentials = { user: "", password: "" };
      notify();
    }
    /** A new session after the old one was refused (Archive.org expires them). */
    async function refresh() {
      session = null;
      const opened = await login();
      notify();
      return opened;
    }
    /** The headers a transfer to this URL needs; {} for a host that is not Archive.org. */
    async function headersFor(url) {
      if (!isArchive(url)) return {};
      if (!session) {
        if (!enabled()) return {};
        await login();
        notify();
      }
      return { Cookie: session.cookie };
    }
    // The archival /download/ URL answers a redirect to the node that holds the file. Custom headers
    // turn the runtime's own redirect following off, so the hops are followed here; the download
    // then starts from the node, with the cookies on every request.
    async function resolve(url, headers, signal) {
      let current = String(url);
      for (let hop = 0; hop < 5; hop++) {
        const response = await http.request(current, { method: "HEAD", headers, maxBytes: 8 * 1024, followRedirects: false, signal });
        const location = text(response.headers?.location);
        if (response.status >= 300 && response.status < 400 && location) {
          const next = location.startsWith("//") ? `https:${location}` : location;
          const origin = /^(https?:\/\/[^/]+)/i.exec(current)?.[1] || "";
          current = next.startsWith("/") ? origin + next : next;
          continue;
        }
        // A refusal here is the account's, not the file's: the queue signs in again and retries once.
        if (response.status === 401 || response.status === 403)
          throw new Error(`Source unavailable: HTTP ${response.status}. Sign in with an account that can download this item.`);
        return current;
      }
      return current;
    }
    return { enabled, headersFor, isArchive, refresh, resolve, setField, signIn, signOut, snapshot, subscribe };
  }

  var archiveAccount = createArchiveAccount({ http: Http });

  function useArchiveAccount() {
    const [state, setState] = useState(archiveAccount.snapshot);
    useEffect(() => archiveAccount.subscribe(setState), []);
    return { ...state, setField: archiveAccount.setField, signIn: archiveAccount.signIn, signOut: archiveAccount.signOut };
  }

export { archiveAccount, createArchiveAccount, useArchiveAccount };

