import fs from 'node:fs';

// Run production hooks against lightweight host adapters.
export function evaluateModule(file, bindings, exports) {
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import\s[\s\S]*?;\r?$/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
  return Function(...Object.keys(bindings), `${source}\nreturn { ${exports.join(', ')} };`)(...Object.values(bindings));
}

export function createHookHarness() {
  const slots = [];
  let cursor = 0, dirty = false, component, output;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: typeof initial === 'function' ? initial() : initial };
        slot.set = (update) => {
          const next = typeof update === 'function' ? update(slot.value) : update;
          if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; }
        };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) {
      const index = cursor++;
      return (slots[index] ??= { current: initial });
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const slot = slots[index] ??= {};
      if (!same(slot.deps, deps)) {
        slot.deps = deps;
        slot.pending = effect;
      }
    },
    useMemo(factory, deps) {
      const index = cursor++;
      const slot = slots[index] ??= {};
      if (!same(slot.deps, deps)) { slot.deps = deps; slot.value = factory(); }
      return slot.value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
  };
  return {
    hooks,
    render(next = component) {
      component = next;
      cursor = 0;
      dirty = false;
      output = component();
      return output;
    },
    flushEffects() {
      for (const slot of slots) {
        if (!slot.pending) continue;
        const effect = slot.pending;
        slot.pending = null;
        slot.cleanup?.();
        slot.cleanup = effect();
      }
    },
    settle(next = component) {
      this.render(next);
      for (let pass = 0; pass < 20; pass++) {
        this.flushEffects();
        if (!dirty) return output;
        this.render();
      }
      throw new Error('Hook harness did not settle');
    },
    cleanup() { for (const slot of slots) slot.cleanup?.(); },
  };
}
