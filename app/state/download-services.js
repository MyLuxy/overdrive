// The services a pasted link or magnet can be handed to (issues #20 and #89): TorBox's, Real-Debrid's
// and Premiumize's debrid APIs, and a qBittorrent WebUI on the home network. Each needs the user's
// own credentials, entered once on the console and kept in settings.json beside the speed limit.
// Nothing here has a default: an empty field means the service is not set up, and the Downloads page
// offers the setup instead. settings.json sits in the app's data folder, outside the app image, so a
// key or a phone login stays through closing, restarting and updating Overdrive.

import { useEffect, useState } from 'react';
import { loadList, saveList } from './saved.js';

  var SETTINGS = "settings.json";
  var FIELDS = {
    torbox: "torboxKey", realdebrid: "realdebridToken", premiumize: "premiumizeKey",
    address: "qbittorrentAddress", user: "qbittorrentUser", password: "qbittorrentPassword",
    // A Real-Debrid phone login (device-login.js): its token lasts hours, these renew it.
    realdebridRefresh: "realdebridRefresh", realdebridClient: "realdebridClient", realdebridSecret: "realdebridSecret",
    realdebridExpires: "realdebridExpires"
  };
  // What a typed Real-Debrid token replaces: a private API token never expires and needs none of it.
  var REALDEBRID_LOGIN = ["realdebridRefresh", "realdebridClient", "realdebridSecret", "realdebridExpires"];

  // "192.168.1.10:8080", "http://192.168.1.10:8080/" and "https://host/qbittorrent" are all an
  // address; what is not one (no host, a space) is refused before it is saved.
  function serviceAddress(value) {
    let text = String(value ?? "").trim();
    if (!text) return "";
    if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
    text = text.replace(/\/+$/, "");
    if (!/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[a-z0-9._~%!$&'()*+,;=:@/-]*)?$/i.test(text))
      throw new Error("Enter the WebUI address as host:port, for example 192.168.1.10:8080.");
    return text;
  }

  function read2() {
    const settings = loadList(SETTINGS, "settings");
    const text = (key) => typeof settings[key] === "string" ? settings[key] : "";
    return {
      torbox: text(FIELDS.torbox).trim(), realdebrid: text(FIELDS.realdebrid).trim(), premiumize: text(FIELDS.premiumize).trim(),
      address: text(FIELDS.address).trim(), user: text(FIELDS.user).trim(), password: text(FIELDS.password),
      ...Object.fromEntries(REALDEBRID_LOGIN.map((field) => [field, text(FIELDS[field]).trim()]))
    };
  }

  var current = read2();
  var listeners = new Set();

  function services() {
    return current;
  }

  /** Saves several fields at once, as one write ({ field: value }); null or "" clears one. */
  function setServices(values) {
    const settings = { ...loadList(SETTINGS, "settings") };
    const next = { ...current };
    for (const [field, value] of Object.entries(values)) {
      if (!(field in FIELDS)) throw new Error("Unknown download service field.");
      let text = field === "address" ? serviceAddress(value) : String(value ?? "").trim();
      if (field === "password") text = String(value ?? "");
      if (text) settings[FIELDS[field]] = text;
      else delete settings[FIELDS[field]];
      next[field] = text;
    }
    if (Object.keys(next).every((field) => next[field] === current[field])) return;
    saveList(SETTINGS, "settings", settings);
    current = next;
    for (const listener of listeners) listener(current);
  }

  /** Saves one service field ("torbox", "address", "user", "password"); null or "" clears it. */
  function setService(field, value) {
    if (!(field in FIELDS)) throw new Error("Unknown download service field.");
    // A token typed by hand is the account's own, which never expires: a phone login's renewal goes.
    if (field === "realdebrid") return setServices({ realdebrid: value, ...Object.fromEntries(REALDEBRID_LOGIN.map((name) => [name, ""])) });
    setServices({ [field]: value });
  }

  /** A qBittorrent is set up with an address; a user and password only when its WebUI asks. */
  function qbittorrent() {
    if (!current.address) return null;
    return { address: current.address, username: current.user, password: current.password };
  }

  function torbox() {
    return current.torbox || null;
  }

  function realdebrid() {
    return current.realdebrid || null;
  }

  function premiumize() {
    return current.premiumize || null;
  }

  function useServices() {
    const [state, setState] = useState(current);
    useEffect(() => {
      const listener = (next) => setState(next);
      listeners.add(listener);
      setState(current);
      return () => {
        listeners.delete(listener);
      };
    }, []);
    return state;
  }

export { premiumize, qbittorrent, realdebrid, serviceAddress, services, setService, setServices, torbox, useServices };
