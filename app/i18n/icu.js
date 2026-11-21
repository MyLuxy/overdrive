// ../pub-game-store/native/i18n/icu.js
// reconstructed from the esbuild bundle in eboot.bin

import { formatNumber, formatPercent } from './format.js';
import { pluralCategory } from './plural.js';

  function compile(message) {
    let at = 0;
    const fail = (what) => {
      throw new SyntaxError(`${what} at ${at} in "${message}"`);
    };
    const space = () => {
      while (/\s/.test(message[at] ?? "")) at++;
    };
    const word = () => {
      space();
      const start = at;
      while (at < message.length && !/[\s,{}]/.test(message[at])) at++;
      if (start === at) fail("Expected a name");
      return message.slice(start, at);
    };
    function parts(inPlural) {
      const out = [];
      let text = "";
      const flush = () => {
        if (text) out.push(text);
        text = "";
      };
      while (at < message.length) {
        const char = message[at];
        if (char === "'") {
          const next = message[at + 1];
          if (next === "'") {
            text += "'";
            at += 2;
            continue;
          }
          if (next === "{" || next === "}" || inPlural && next === "#") {
            at++;
            while (at < message.length) {
              if (message[at] === "'") {
                if (message[at + 1] === "'") {
                  text += "'";
                  at += 2;
                  continue;
                }
                at++;
                break;
              }
              text += message[at++];
            }
            continue;
          }
          text += char;
          at++;
        } else if (char === "{") {
          flush();
          at++;
          out.push(argument());
        } else if (char === "}") {
          break;
        } else if (char === "#" && inPlural) {
          flush();
          out.push({ type: "pound" });
          at++;
        } else {
          text += char;
          at++;
        }
      }
      flush();
      return out;
    }
    function options(inPlural) {
      const cases = {};
      let offset = 0;
      for (; ; ) {
        space();
        if (message[at] === "}") break;
        const key = word();
        if (key.startsWith("offset:")) {
          offset = Number(key.slice(7) || word());
          continue;
        }
        space();
        if (message[at] !== "{") fail(`Expected { after "${key}"`);
        at++;
        cases[key] = parts(inPlural);
        if (message[at] !== "}") fail("Unclosed case");
        at++;
      }
      if (!cases.other) fail("Missing other case");
      return { cases, offset };
    }
    function argument() {
      const name = word();
      space();
      let node = { type: "arg", name };
      if (message[at] === ",") {
        at++;
        const type = word();
        space();
        if (type === "plural") {
          if (message[at++] !== ",") fail("Expected , after plural");
          node = { type, name, ...options(true) };
        } else if (type === "select") {
          if (message[at++] !== ",") fail("Expected , after select");
          node = { type, name, cases: options(false).cases };
        } else if (type === "number") {
          let style = "";
          if (message[at] === ",") {
            at++;
            style = word();
            space();
          }
          node = { type, name, style };
        } else {
          fail(`Unsupported argument type "${type}"`);
        }
      }
      space();
      if (message[at] !== "}") fail("Expected }");
      at++;
      return node;
    }
    const result = parts(false);
    if (at < message.length) fail("Unexpected }");
    return result;
  }
  var number = (locale2, value, style) => {
    if (style === "percent") return formatPercent(locale2, value * 100);
    return formatNumber(locale2, value, { maximumFractionDigits: style === "integer" ? 0 : 3 });
  };
  function format(parts, params, locale2, pound = null) {
    let out = "";
    for (const part of parts) {
      if (typeof part === "string") {
        out += part;
        continue;
      }
      if (part.type === "pound") {
        out += number(locale2, pound);
        continue;
      }
      const value = params?.[part.name];
      if (value === void 0) {
        out += `{${part.name}}`;
        continue;
      }
      if (part.type === "arg") out += typeof value === "number" ? number(locale2, value) : String(value);
      else if (part.type === "number") out += number(locale2, Number(value), part.style);
      else if (part.type === "select") out += format(part.cases[String(value)] ?? part.cases.other, params, locale2, pound);
      else {
        const n = Number(value);
        const cases = part.cases[`=${n}`] ?? part.cases[pluralCategory(locale2, n - part.offset)] ?? part.cases.other;
        out += format(cases, params, locale2, n - part.offset);
      }
    }
    return out;
  }

export { compile, format };
