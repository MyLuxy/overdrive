// The Downloads page's own section for downloads that do not come from the catalog (issues #107,
// #89, #20): a pasted link, a magnet or ".torrent" link the app's own engine fetches, and links and
// magnets handed to a linked service — TorBox, Real-Debrid, Premiumize, or the user's qBittorrent,
// picked in one dialog so each card stays one thing. A service that has to fetch the file first
// shows its wait in a dialog with Cancel; once it names the file, it joins the normal queue, on the
// drive chosen in Settings. A torrent's own wait is its row's, in the queue below.
//
// The strip scrolls with the list, so it is the screen that places it (useAddDownloads returns it
// beside the dialogs): a fixed strip above the list took the focus with it when the list scrolled.

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.js';
import { useNavActions } from '../state/nav.jsx';
import { downloadQueue, storageRoots } from '../state/downloads.js';
import { downloadRoot } from '../state/download-root.js';
import { qbittorrent as qbittorrentSettings, services as serviceSettings, setService, setServices, useServices } from '../state/download-services.js';
import { refreshRealDebrid } from '../state/device-login.js';
import { cancellation } from '../state/download-sources.js';
import { TORRENT_FILE, addLink, addTorrent, linkInput } from '../state/link-download.js';
import { createTorbox } from '../state/torbox.js';
import { createRealDebrid } from '../state/realdebrid.js';
import { createPremiumize } from '../state/premiumize.js';
import { createQBittorrent } from '../state/qbittorrent.js';
import { URLDialog } from './URLDialog.jsx';
import { PhoneSetup } from './PhoneSetup.jsx';
import { primaryKey } from './DownloadRow.jsx';
import { Button2 } from '../ui/Button.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { Icon } from '../ui/Icon.jsx';
import { colors } from '../ui/colors.js';
import { FocusScope, Http, Text, View } from '@ps5-react/core';

  // Where a pasted file is saved: the drive chosen in Settings, when it is still there.
  function chosenRoot() {
    try {
      const roots = storageRoots();
      const remembered = downloadRoot();
      return remembered && roots.includes(remembered) ? remembered : roots[0] ?? "/data";
    } catch {
      return "/data";
    }
  }

  var CARD = { width: 430, height: 124, flexDirection: "row", alignItems: "center", gap: 18, borderRadius: 16, paddingHorizontal: 20, backgroundColor: colors.surface };
  function AddCard({ icon, title, detail, onPress, focusKey, nextFocusDown }) {
    return /* @__PURE__ */ (0, jsxs)(View, {
      focusKey, onPress, nextFocusDown,
      style: (state) => [CARD, state.focused ? { backgroundColor: colors.surface2 } : null],
      children: [
        /* @__PURE__ */ (0, jsx)(FocusRing, {}),
        /* @__PURE__ */ (0, jsx)(View, { style: { width: 58, height: 58, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.surface2 }, children: /* @__PURE__ */ (0, jsx)(Icon, { name: icon, size: 30, color: colors.fg }) }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 4 }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 24, fontWeight: 600, color: colors.fg, numberOfLines: 1 }, children: title }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 19, color: colors.muted, numberOfLines: 2, lineHeight: 26 }, children: detail })
        ] })
      ]
    });
  }

  // A wait with a bar: the service is fetching the file, or the client is still downloading it.
  function Waiting({ title, detail, progress, error: error2, onCancel, onClose }) {
    const t2 = useT();
    const percent = Math.max(0, Math.min(1, progress));
    return /* @__PURE__ */ (0, jsx)(FocusScope, {
      trap: true, autoFocus: true,
      onBack: () => {
        if (error2) onClose();
        else onCancel();
        return true;
      },
      children: /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, alignItems: "center", justifyContent: "center", backgroundColor: "#000000f2" }, children: /* @__PURE__ */ (0, jsxs)(View, { style: { width: 900, gap: 26, borderRadius: 18, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface, padding: 44 }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 31, fontWeight: 600, color: colors.fg, lineHeight: 42 }, children: title }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 22, color: error2 ? colors.fg : colors.muted, lineHeight: 32 }, children: error2 || detail }),
        error2 ? null : /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 12 }, children: [
          /* @__PURE__ */ (0, jsx)(View, { style: { width: 812, height: 8, borderRadius: 4, backgroundColor: colors.surface3 }, children: /* @__PURE__ */ (0, jsx)(View, { style: { width: Math.round(812 * percent), height: 8, borderRadius: 4, backgroundColor: colors.fg } }) }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, color: colors.muted }, children: t2("add.percent", { percent: String(Math.round(percent * 100)) }) })
        ] }),
        /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", gap: 12 }, children: error2
          ? /* @__PURE__ */ (0, jsx)(Button2, { label: t2("add.close"), onPress: onClose, autoFocus: true })
          : /* @__PURE__ */ (0, jsx)(Button2, { label: t2("add.cancel"), variant: "outline", onPress: onCancel, autoFocus: true }) })
      ] }) })
    });
  }

  // The frame every dialog here shares: a modal over the page, Back leaving it.
  function Dialog({ width = 980, onBack, children }) {
    return /* @__PURE__ */ (0, jsx)(FocusScope, {
      trap: true, autoFocus: true,
      onBack: () => {
        onBack();
        return true;
      },
      children: /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, alignItems: "center", justifyContent: "center", backgroundColor: "#000000f2" }, children: /* @__PURE__ */ (0, jsxs)(View, { style: { width, gap: 20, borderRadius: 18, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface, padding: 44 }, children }) })
    });
  }

  function serviceName(t2, service) {
    return t2(`add.${service}Name`);
  }

  // The debrid services, in the order the dialog lists them. Each has its own key and its own card
  // row, and none is ever used on another's behalf.
  var DEBRID = ["torbox", "realdebrid", "premiumize"];
  // The ones linked from the phone with a QR code (device-login.js); the typed key stays beside it.
  var PHONE = ["torbox", "realdebrid"];
  // Everything the "linked services" dialog lists: the debrid services and the user's own client.
  // qBittorrent is not a debrid service, but it is set up the same way and takes the same kinds.
  var SERVICES = [...DEBRID, "qbittorrent"];

  // The guided setup behind a card: its own service's fields, the first time the card is pressed and
  // whenever the user asks to change them. What is already saved shows as it is; Continue goes on.
  function SetupDialog({ service, onField, onDone, onCancel }) {
    const t2 = useT();
    const services = useServices();
    const rows = DEBRID.includes(service)
      ? [{ field: service, icon: service, title: t2(`add.field.${service}`), value: services[service] }]
      : [
          { field: "address", icon: "globe", title: t2("add.address"), value: services.address },
          { field: "user", icon: "controller", title: t2("add.user"), value: services.user },
          { field: "password", icon: "controller", title: t2("add.password"), value: services.password ? "••••••••" : "" }
        ];
    return /* @__PURE__ */ (0, jsxs)(Dialog, { onBack: onCancel, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 34, fontWeight: 600, color: colors.fg }, children: t2("add.setupTitle", { service: serviceName(t2, service) }) }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 30 }, children: t2("add.setupBody") }),
      // Whoever has no client at all can still send a magnet to TorBox, from its own card.
      service === "qbittorrent" ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, color: colors.subtle, lineHeight: 28 }, children: t2("add.setupClientHint") }) : null,
      rows.map((row) => /* @__PURE__ */ (0, jsxs)(View, {
        focusKey: `downloads:setup:${row.field}`,
        onPress: () => onField(row.field),
        style: (state) => [{ flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 12, paddingHorizontal: 16, height: 64, backgroundColor: colors.surface2 }, state.focused ? { backgroundColor: colors.surface3 } : null],
        children: [
          /* @__PURE__ */ (0, jsx)(FocusRing, {}),
          /* @__PURE__ */ (0, jsx)(Icon, { name: row.icon, size: 20, color: colors.muted }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { flex: 1, fontFamily: "Inter-Regular", fontSize: 22, color: colors.fg }, children: row.title }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, color: row.value ? colors.fg : colors.subtle, numberOfLines: 1, ellipsizeMode: "head" }, children: row.value || t2("add.notSet") })
        ]
      }, row.field)),
      /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 12, paddingTop: 4 }, children: [
        /* @__PURE__ */ (0, jsx)(Button2, { label: t2("add.continue"), focusKey: "downloads:setup:done", autoFocus: true, onPress: onDone }),
        /* @__PURE__ */ (0, jsx)(Button2, { label: t2("add.cancel"), variant: "outline", onPress: onCancel })
      ] })
    ] });
  }

  // A card whose service is already set up asks before touching what is saved.
  function AskDialog({ service, onContinue, onChange, onCancel }) {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsxs)(Dialog, { width: 900, onBack: onCancel, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 32, fontWeight: 600, color: colors.fg }, children: t2("add.configuredTitle", { service: serviceName(t2, service) }) }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 30 }, children: t2("add.configuredBody") }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 12, paddingTop: 4 }, children: [
        /* @__PURE__ */ (0, jsx)(Button2, { label: t2("add.continue"), focusKey: "downloads:ask:continue", autoFocus: true, onPress: onContinue }),
        /* @__PURE__ */ (0, jsx)(Button2, { label: t2("add.modify"), icon: "settings", variant: "outline", onPress: onChange }),
        /* @__PURE__ */ (0, jsx)(Button2, { label: t2("add.cancel"), variant: "ghost", onPress: onCancel })
      ] })
    ] });
  }

  // The linked services, one row each with its own mark and whether it is set: picking one goes on
  // to its question or its setup, exactly as a card of its own would have.
  function ServicesDialog({ services, onPick, onCancel }) {
    const t2 = useT();
    // qBittorrent is ready once its WebUI address is saved; a debrid service, once its key is.
    const ready = (service) => Boolean(service === "qbittorrent" ? services.address : services[service]);
    const status = (service) => ready(service) ? "add.serviceReady" : PHONE.includes(service) ? "add.serviceLink" : service === "qbittorrent" ? "add.notSet" : "add.serviceNeeds";
    return /* @__PURE__ */ (0, jsxs)(Dialog, { width: 1260, onBack: onCancel, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 34, fontWeight: 600, color: colors.fg }, children: t2("settings.group.services") }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 30 }, children: t2("add.servicesBody") }),
      /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", gap: 14 }, children: SERVICES.map((service) => /* @__PURE__ */ (0, jsxs)(View, {
        focusKey: `downloads:service:${service}`,
        onPress: () => onPick(service),
        style: (state) => [{ width: 280, alignItems: "center", gap: 12, borderRadius: 14, paddingVertical: 24, backgroundColor: colors.surface2 }, state.focused ? { backgroundColor: colors.surface3 } : null],
        children: [
          /* @__PURE__ */ (0, jsx)(FocusRing, {}),
          /* @__PURE__ */ (0, jsx)(Icon, { name: service, size: 52, color: colors.fg }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: colors.fg }, children: serviceName(t2, service) }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 18, color: ready(service) ? colors.fg : colors.subtle }, children: t2(status(service)) })
        ]
      }, service)) })
    ] });
  }

  // The client a route names, built around the key saved for it: one debrid service each, or the
  // qBittorrent on the home network.
  function preparer(route, settings) {
    if (route === "torbox") return createTorbox({ http: Http, key: settings.torbox });
    if (route === "realdebrid") {
      // A phone login's token lasts hours and is renewed from what the login saved; a typed one never ends.
      const renew = settings.realdebridRefresh && settings.realdebridClient && settings.realdebridSecret ? async ({ signal }) => {
        const token = await refreshRealDebrid({ http: Http, client: settings.realdebridClient, secret: settings.realdebridSecret, refresh: settings.realdebridRefresh, signal });
        setServices(token);
        return token;
      } : null;
      return createRealDebrid({ http: Http, key: settings.realdebrid, renew, expiresAt: Number(settings.realdebridExpires) || 0 });
    }
    if (route === "premiumize") return createPremiumize({ http: Http, key: settings.premiumize });
    return createQBittorrent({ http: Http, ...qbittorrentSettings() });
  }

  // Hands the link to the service and waits; the file joins the queue as soon as it names one.
  function RunDialog({ route, value, onAdded, onClose }) {
    const t2 = useT();
    const [state, setState] = useState({ progress: 0, error: "" });
    const token = useRef(null);
    (0, useEffect)(() => {
      const cancel = cancellation();
      token.current = cancel;
      let live = true;
      const settings = serviceSettings();
      const progress = (report) => {
        if (live) setState((old) => ({ ...old, progress: report.progress }));
      };
      void (async () => {
        try {
          const prepared = await preparer(route, settings).prepare(value, { onProgress: progress, signal: cancel.signal });
          if (!live) return;
          const id = addLink(downloadQueue(), { ...prepared, title: prepared.filename, root: chosenRoot() });
          live = false;
          onAdded(id);
        } catch (error2) {
          if (live) setState({ progress: 0, error: error2.message });
        }
      })();
      return () => {
        live = false;
        cancel.cancel();
      };
    }, [route, value]);

    const service = serviceName(t2, route);
    return /* @__PURE__ */ (0, jsx)(Waiting, {
      title: t2("add.waitTitle", { service }),
      detail: t2("add.waitDetail", { service }),
      progress: state.progress,
      error: state.error,
      onCancel: () => {
        if (token.current) token.current.cancel();
        onClose();
      },
      onClose
    });
  }

  // The strip and its dialogs. The strip belongs in the page's list, where it scrolls with it, and
  // the dialogs above everything: the screen asks for both.
  function useAddDownloads({ onAdded, down } = {}) {
    const t2 = useT();
    const services = useServices();
    const { focusLater } = useNavActions();
    const [dialog, setDialog] = useState(null);
    // { kind: "link" | "torrent" | "client" | "services" | "debrid" | "setup" | "ask" | "run" | "field", ... }
    // A URL dialog closes itself once its submit returns: a submit that opened the next dialog has
    // already replaced it by then, and this leaves that one alone.
    const closeIf = (kind) => setDialog((current) => current && current.kind === kind ? null : current);

    const add = (file) => {
      const id = addLink(downloadQueue(), { url: file.url, filename: file.filename, headers: file.headers, sizeBytes: file.sizeBytes, title: file.filename, root: chosenRoot() });
      if (onAdded) onAdded(id);
      else focusLater(primaryKey(id));
    };

    // What comes after a setup or a question: the pasted value goes on to its service, and a card
    // pressed on its own opens its own URL dialog.
    const next2 = (next) => {
      if (next.value != null) open(next.kind, next.value, next.service);
      else setDialog({ kind: next.kind, service: next.service });
    };

    // A magnet or a ".torrent" link is the engine's, whichever card it was typed into; a service
    // fetches everything else.
    const open = (kind, value, service) => {
      const parsed = linkInput(value);
      const torrent = parsed.kind === "magnet" || TORRENT_FILE.test(parsed.value);
      if (kind === "link" && torrent) kind = "torrent";
      if (kind === "torrent") {
        // The app's own engine: a magnet, or a .torrent link the queue fetches before starting.
        if (!torrent) throw new Error(t2("add.magnetOnly"));
        const id = addTorrent(downloadQueue(), {
          magnet: parsed.kind === "magnet" ? parsed.value : void 0,
          url: parsed.kind === "magnet" ? void 0 : parsed.value,
          root: chosenRoot()
        });
        if (onAdded) onAdded(id);
        else focusLater(primaryKey(id));
        return;
      }
      if (kind === "client") {
        // The user's qBittorrent: a magnet or a .torrent link, and its own setup the first time.
        if (!torrent) throw new Error(t2("add.magnetOnly"));
        if (!services.address) {
          setDialog({ kind: "setup", service: "qbittorrent", next: { kind: "client", value: parsed.value } });
          return;
        }
        setDialog({ kind: "run", route: "qbittorrent", value: parsed.value });
        return;
      }
      if (kind === "debrid") {
        // A debrid service takes a magnet or a host link; only qBittorrent fetches a .torrent file.
        if (TORRENT_FILE.test(parsed.value) && parsed.kind !== "magnet") throw new Error(t2("add.torrentLinkNeedsClient"));
        if (!services[service]) {
          setDialog({ kind: "setup", service, next: { kind: "debrid", service, value: parsed.value } });
          return;
        }
        setDialog({ kind: "run", route: service, value: parsed.value });
        return;
      }
      // A plain link: the queue fetches it, through the host's own resolver when it knows the host.
      add({ url: parsed.value, filename: parsed.name });
    };

    // One linked service from the dialog: its guided setup the first time, its question after. Each
    // keeps its own account, so none is ever used on another's behalf.
    const pick = (service) => {
      const client3 = service === "qbittorrent";
      const next3 = { kind: client3 ? "client" : "debrid", service };
      const configured = client3 ? services.address : services[service];
      setDialog(configured ? { kind: "ask", service, next: next3 } : { kind: "setup", service, next: next3 });
    };

    // The fields of a service, opened from its setup.
    const field = (name, from) => {
      const values = {
        torbox: services.torbox, realdebrid: services.realdebrid, premiumize: services.premiumize,
        address: services.address, user: services.user, password: services.password
      };
      const service = from?.service ?? (DEBRID.includes(name) ? name : "qbittorrent");
      setDialog({ kind: "field", field: name, value: values[name] || "", service, next: from?.next });
    };

    // Continue from a setup: a service with nothing in it asks for its main field first.
    const setupDone = (service, next3) => {
      const settings = serviceSettings();
      const main = service === "qbittorrent" ? "address" : service;
      if (!settings[main]) return field(main, { service, next: next3 });
      next2(next3);
    };

    const strip = /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 14 }, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { paddingHorizontal: 6, fontFamily: "Inter-Regular", fontSize: 20, fontWeight: 600, color: colors.subtle, letterSpacing: 1 }, children: t2("add.title") }),
      // The focus ring is drawn 7 px outside the card, and the scroll view clips what it has no room
      // for: the first card sat flush with its left edge, so the ring was cut and looked broken.
      // Down goes to the first row of the list, which the D-pad used to pass over for the panel on the
      // right: it was the nearer thing below, not the one the player meant (2026-10-25).
      /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 14, paddingLeft: 12 }, children: [
        /* @__PURE__ */ (0, jsx)(AddCard, { icon: "link", title: t2("add.link"), detail: t2("add.linkDetail"), focusKey: "downloads:add:link", nextFocusDown: down, onPress: () => setDialog({ kind: "link" }) }),
        /* @__PURE__ */ (0, jsx)(AddCard, { icon: "download", title: t2("add.torrent"), detail: t2("add.torrentDetail"), focusKey: "downloads:add:torrent", nextFocusDown: down, onPress: () => setDialog({ kind: "torrent" }) }),
        /* @__PURE__ */ (0, jsx)(AddCard, { icon: "layers", title: t2("add.debrid"), detail: t2("add.debridDetail"), focusKey: "downloads:add:debrid", nextFocusDown: down, onPress: () => setDialog({ kind: "services" }) })
      ] })
    ] });

    const dialogs = /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      dialog && dialog.kind === "link" ? /* @__PURE__ */ (0, jsx)(URLDialog, {
        title: t2("add.linkTitle"), detail: t2("add.linkBody"), initial: "",
        submit: (value) => open("link", value), onClose: () => closeIf("link")
      }) : null,
      dialog && dialog.kind === "torrent" ? /* @__PURE__ */ (0, jsx)(URLDialog, {
        title: t2("add.torrentTitle"), detail: t2("add.torrentBody"), initial: "magnet:?xt=urn:btih:",
        submit: (value) => open("torrent", value), onClose: () => closeIf("torrent")
      }) : null,
      dialog && dialog.kind === "client" ? /* @__PURE__ */ (0, jsx)(URLDialog, {
        title: t2("add.torrentTitle"), detail: t2("add.clientBody"), initial: "magnet:?xt=urn:btih:",
        submit: (value) => open("client", value), onClose: () => closeIf("client")
      }) : null,
      dialog && dialog.kind === "services" ? /* @__PURE__ */ (0, jsx)(ServicesDialog, {
        services,
        onPick: pick,
        onCancel: () => setDialog(null)
      }) : null,
      dialog && dialog.kind === "debrid" ? /* @__PURE__ */ (0, jsx)(URLDialog, {
        title: serviceName(t2, dialog.service),
        detail: t2("add.debridBody", { service: serviceName(t2, dialog.service) }),
        initial: "",
        submit: (value) => open("debrid", value, dialog.service),
        onClose: () => closeIf("debrid")
      }) : null,
      dialog && dialog.kind === "field" ? /* @__PURE__ */ (0, jsx)(URLDialog, {
        title: t2(`add.field.${dialog.field}`), detail: t2(`add.fieldBody.${dialog.field}`), initial: dialog.value,
        // This dialog's own close already goes back to the setup it came from, saved or not.
        submit: (value) => {
          setService(dialog.field, value);
          setDialog({ kind: "setup", service: dialog.service, next: dialog.next });
        },
        onClose: () => setDialog({ kind: "setup", service: dialog.service, next: dialog.next })
      }) : null,
      dialog && dialog.kind === "setup" && PHONE.includes(dialog.service) ? /* @__PURE__ */ (0, jsx)(PhoneSetup, {
        service: dialog.service,
        onField: (name) => field(name, dialog),
        onDone: () => setupDone(dialog.service, dialog.next),
        onCancel: () => setDialog(null)
      }) : null,
      dialog && dialog.kind === "setup" && !PHONE.includes(dialog.service) ? /* @__PURE__ */ (0, jsx)(SetupDialog, {
        service: dialog.service,
        onField: (name) => field(name, dialog),
        onDone: () => setupDone(dialog.service, dialog.next),
        onCancel: () => setDialog(null)
      }) : null,
      dialog && dialog.kind === "ask" ? /* @__PURE__ */ (0, jsx)(AskDialog, {
        service: dialog.service,
        onContinue: () => next2(dialog.next),
        onChange: () => setDialog({ kind: "setup", service: dialog.service, next: dialog.next }),
        onCancel: () => setDialog(null)
      }) : null,
      dialog && dialog.kind === "run" ? /* @__PURE__ */ (0, jsx)(RunDialog, {
        route: dialog.route, value: dialog.value,
        onAdded: (id) => {
          setDialog(null);
          focusLater(primaryKey(id));
        },
        onClose: () => setDialog(null)
      }) : null
    ] });

    return { strip, dialogs };
  }

export { useAddDownloads };
