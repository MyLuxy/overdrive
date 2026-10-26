// The setup of TorBox and Real-Debrid: a QR code first, so the account is linked from the phone in
// a few seconds, and the typed key beside it as before. The code is asked for as the dialog opens and
// renewed by itself when it runs out; once the player approves it on the phone, the token is saved
// like a typed key (settings.json, kept through restarts and updates) and the dialog goes on.

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.js';
import { setServices, useServices } from '../state/download-services.js';
import { Expired, accountOf, createDeviceLogin } from '../state/device-login.js';
import { cancellation } from '../state/download-sources.js';
import { QRCode } from '../ui/QRCode.jsx';
import { Button2 } from '../ui/Button.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { Icon } from '../ui/Icon.jsx';
import { colors } from '../ui/colors.js';
import { FocusScope, Http, Text, View } from '@ps5-react/core';

  // The phone login's life: a code is asked for, shown until the player approves it or it runs out
  // (then the next one is asked for), and the token saved. `retry` starts over after a failure.
  function usePhoneLogin(service, onLinked) {
    const [state, setState] = (0, useState)({ phase: "starting" });
    const [attempt, setAttempt] = (0, useState)(0);
    (0, useEffect)(() => {
      const cancel = cancellation();
      let live = true, after = null;
      const login = createDeviceLogin({ http: Http, service });
      void (async () => {
        for (;;) {
          let session;
          try {
            session = await login.start({ signal: cancel.signal });
          } catch (error) {
            console.log(`[device-login] ${service}: no code: ${error.message}`);
            if (live) setState({ phase: "error", error: error.message });
            return;
          }
          if (!live) return;
          console.log(`[device-login] ${service}: code shown, valid ${Math.round((session.expiresAt - Date.now()) / 1e3)} s`);
          setState({ phase: "waiting", session });
          let values;
          try {
            values = await login.approved(session, { signal: cancel.signal });
          } catch (error) {
            if (!live) return;
            if (error instanceof Expired) {
              console.log(`[device-login] ${service}: the code ran out; asking for a new one`);
              continue;
            }
            setState({ phase: "error", error: error.message });
            return;
          }
          if (!live) return;
          setServices(values);
          console.log(`[device-login] ${service}: linked from the phone`);
          setState({ phase: "linked" });
          const account = await accountOf({ http: Http, service, key: values[service], signal: cancel.signal });
          if (!live) return;
          if (account) setState({ phase: "linked", account });
          // A moment to read "Linked" and whose account it is, then the dialog goes on by itself.
          after = setTimeout(onLinked, 1800);
          return;
        }
      })();
      return () => {
        live = false;
        clearTimeout(after);
        cancel.cancel();
      };
    }, [service, attempt]);
    return { state, retry: () => setAttempt((value) => value + 1) };
  }

  // "8:21": what is left of the code, ticking once a second while it shows.
  function useRemaining(expiresAt) {
    const [now, setNow] = (0, useState)(Date.now());
    (0, useEffect)(() => {
      if (!expiresAt) return void 0;
      const timer = setInterval(() => setNow(Date.now()), 1e3);
      return () => clearInterval(timer);
    }, [expiresAt]);
    const left = Math.max(0, Math.round(((expiresAt || 0) - now) / 1e3));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }

  var TEXT = { fontFamily: "Inter-Regular", color: colors.fg };
  var QR_SIZE = 380;

  // The square on the left: the code once there is one, a plain panel saying why there is none yet.
  function CodePanel({ state, service, t2 }) {
    const session = state.session;
    const remaining = useRemaining(session?.expiresAt);
    if (state.phase === "linked") {
      return /* @__PURE__ */ (0, jsxs)(View, { style: { width: QR_SIZE, height: QR_SIZE, borderRadius: 18, alignItems: "center", justifyContent: "center", gap: 18, backgroundColor: colors.surface2 }, children: [
        /* @__PURE__ */ (0, jsx)(Icon, { name: "circleCheck", size: 96, color: colors.ok }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 30, fontWeight: 600, color: colors.ok }, children: t2("add.phone.linked") })
      ] });
    }
    if (!session) {
      return /* @__PURE__ */ (0, jsx)(View, { style: { width: QR_SIZE, height: QR_SIZE, borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 30, backgroundColor: colors.surface2 }, children: /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 22, color: colors.muted, lineHeight: 32, textAlign: "center" }, children: state.phase === "error" ? t2("add.phone.failed") : t2("add.phone.starting", { service }) }) });
    }
    return /* @__PURE__ */ (0, jsxs)(View, { style: { width: QR_SIZE, gap: 14, alignItems: "center" }, children: [
      /* @__PURE__ */ (0, jsx)(QRCode, { text: session.qr, size: QR_SIZE }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 19, color: colors.subtle }, children: t2("add.phone.expires", { time: remaining }) })
    ] });
  }

  function PhoneSetup({ service, onField, onDone, onCancel }) {
    const t2 = useT();
    const services = useServices();
    const name = t2(`add.${service}Name`);
    const { state, retry } = usePhoneLogin(service, onDone);
    const session = state.session;
    const account = state.account;
    const status = state.phase === "linked"
      ? [account?.name, account?.plan, account?.until ? t2("add.phone.until", { date: account.until }) : ""].filter(Boolean).join(" · ") || t2("add.phone.linkedBody")
      : state.phase === "error" ? state.error : state.phase === "waiting" ? t2("add.phone.waiting") : "";
    const key = services[service];
    return /* @__PURE__ */ (0, jsx)(FocusScope, {
      trap: true, autoFocus: true,
      onBack: () => {
        onCancel();
        return true;
      },
      children: /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, alignItems: "center", justifyContent: "center", backgroundColor: "#000000f2" }, children: /* @__PURE__ */ (0, jsxs)(View, { style: { width: 1320, gap: 30, borderRadius: 18, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface, padding: 48 }, children: [
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 18 }, children: [
          /* @__PURE__ */ (0, jsx)(Icon, { name: service, size: 44, color: colors.fg }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 34, fontWeight: 600 }, children: t2("add.setupTitle", { service: name }) })
        ] }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 48 }, children: [
          /* @__PURE__ */ (0, jsx)(CodePanel, { state, service: name, t2 }),
          /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 18 }, children: [
            /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 30, fontWeight: 600 }, children: t2("add.phone.title") }),
            /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 22, color: colors.muted, lineHeight: 32 }, children: t2("add.phone.step1") }),
            /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 22, color: colors.muted, lineHeight: 32 }, children: t2("add.phone.step2", { service: name }) }),
            session && state.phase !== "linked" ? /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 6 }, children: [
              /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 20, color: colors.subtle, lineHeight: 28 }, children: t2("add.phone.manual", { page: session.page }) }),
              /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 58, fontWeight: 600, letterSpacing: 10, lineHeight: 72 }, children: session.code })
            ] }) : null,
            status ? /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 21, color: state.phase === "linked" ? colors.ok : state.phase === "error" ? colors.warn : colors.info, lineHeight: 30, numberOfLines: 3 }, children: status }) : null,
            state.phase === "error" ? /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row" }, children: /* @__PURE__ */ (0, jsx)(Button2, { label: t2("add.phone.retry"), icon: "download", variant: "outline", onPress: retry }) }) : null,
            /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 19, color: colors.subtle, paddingTop: 6 }, children: t2("add.phone.or") }),
            /* @__PURE__ */ (0, jsxs)(View, {
              focusKey: `downloads:setup:${service}`,
              onPress: () => onField(service),
              style: (focus) => [{ flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 12, paddingHorizontal: 16, height: 64, backgroundColor: colors.surface2 }, focus.focused ? { backgroundColor: colors.surface3 } : null],
              children: [
                /* @__PURE__ */ (0, jsx)(FocusRing, {}),
                /* @__PURE__ */ (0, jsx)(Icon, { name: "link", size: 20, color: colors.muted }),
                /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, flex: 1, fontSize: 22 }, children: t2(`add.field.${service}`) }),
                /* @__PURE__ */ (0, jsx)(Text, { style: { ...TEXT, fontSize: 20, color: key ? colors.fg : colors.subtle, numberOfLines: 1, ellipsizeMode: "head" }, children: key ? `••••${key.slice(-4)}` : t2("add.notSet") })
              ]
            })
          ] })
        ] }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 12 }, children: [
          /* @__PURE__ */ (0, jsx)(Button2, { label: t2("add.continue"), focusKey: "downloads:setup:done", autoFocus: true, onPress: onDone }),
          /* @__PURE__ */ (0, jsx)(Button2, { label: t2("add.cancel"), variant: "outline", onPress: onCancel })
        ] })
      ] }) })
    });
  }

export { PhoneSetup };
