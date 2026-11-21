// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Babel plugin: `className` on any JSX element and `tw` templates from '@ps5-react/core' become
// literal style objects. Conditional classes become conditional style entries; state variants read
// the element's prop of the same name, except focused/pressed on a focusable element without that
// prop, which read its own focus state through a style function. Animation classes turn a core
// View/Text/Image into its motion component with literal motion props. Nothing class-related
// survives into the bundle.
import {ClassError} from './compile.mjs';
import {byPriority, motionProps, splitTarget} from './motion.mjs';
import {UtilityError} from './utilities.mjs';

const CORE = '@ps5-react/core';
const MOTION = '__ps5Motion';
const MOTION_PROPS = ['initial', 'animate', 'exit', 'transition'];
const WHILE = {focused: 'whileFocus', pressed: 'whilePress'};

export class TailwindError extends Error {
  constructor(message, node, token) {
    super(message);
    this.reason = message;
    this.loc = locate(node, token);
  }
}

/** Line/column of `token` inside a single-line string, else of the node itself. */
function locate(node, token) {
  if (!node?.loc) return null;
  const {line, column} = node.loc.start;
  const text = node.type === 'TemplateElement' ? node.value.raw : node.value;
  const offset = typeof text === 'string' && token ? text.indexOf(token) : -1;
  const sameLine = offset >= 0 && !text.slice(0, offset).includes('\n');
  return {line, column: sameLine ? column + (node.type === 'StringLiteral' ? 1 : 0) + offset : column};
}

const PURE = {
  Identifier: () => true,
  StringLiteral: () => true, NumericLiteral: () => true, BooleanLiteral: () => true, NullLiteral: () => true,
  MemberExpression: (n, pure) => pure(n.object) && (!n.computed || pure(n.property)),
  UnaryExpression: (n, pure) => n.operator !== 'delete' && pure(n.argument),
  BinaryExpression: (n, pure) => pure(n.left) && pure(n.right),
  LogicalExpression: (n, pure) => pure(n.left) && pure(n.right),
  ConditionalExpression: (n, pure) => pure(n.test) && pure(n.consequent) && pure(n.alternate),
  TemplateLiteral: (n, pure) => n.expressions.every(pure),
};
const isPure = node => PURE[node.type]?.(node, isPure) ?? false;
const isPlainStyle = node => node.type === 'ObjectExpression' || node.type === 'ArrayExpression' ||
  node.type.endsWith('Literal');

export default function tailwindPlugin({types: t}, {compiler}) {
  const ownStates = new WeakMap();

  /**
   * For a focusable element: the focus props it leaves to its own state, and the style function's
   * parameter that holds that state. Null for other elements.
   */
  function ownState(element) {
    if (ownStates.has(element.node)) return ownStates.get(element.node);
    const attribute = name => element.node.attributes.find(a => t.isJSXAttribute(a) && a.name.name === name);
    const focusable = attribute('focusable');
    const name = element.node.name;
    const own = (focusable && !t.isBooleanLiteral(focusable.value?.expression, {value: false})) ||
      attribute('onPress') || (t.isJSXIdentifier(name) && coreImport(element.scope, name.name) === 'Pressable')
      ? {props: new Set(Object.keys(WHILE).filter(prop => !attribute(prop))),
        param: element.scope.generateUidIdentifier('state')}
      : null;
    ownStates.set(element.node, own);
    return own;
  }

  const reads = (node, id) => {
    let found = false;
    t.traverseFast(node, n => { found ||= t.isIdentifier(n, {name: id.name}); });
    return found;
  };

  /** `state => [...compiled, style]`, calling the explicit style when it is (or may be) a function. */
  function stateStyle(style, current, param) {
    const state = () => t.cloneNode(param);
    let user = current;
    if (current && t.isFunction(current)) user = t.callExpression(current, [state()]);
    else if (current && !isPlainStyle(current)) {
      if (!isPure(current)) throw new TailwindError('the style prop is read inside the style function ' +
        'that focus classes compile to; move the expression into a variable first', current);
      user = t.conditionalExpression(t.binaryExpression('===', t.unaryExpression('typeof', current),
        t.stringLiteral('function')), t.callExpression(t.cloneNode(current, true), [state()]),
      t.cloneNode(current, true));
    }
    const entries = [...t.isArrayExpression(style) ? style.elements : t.isNullLiteral(style) ? [] : [style],
      ...user ? [user] : []];
    return t.arrowFunctionExpression([state()],
      entries.length === 1 ? entries[0] : t.arrayExpression(entries));
  }

  /** Class expression → segments: strings (with their node) and `{test, consequent, alternate}`. */
  function collect(path, seen = new Set()) {
    const node = path.node;
    if (path.isStringLiteral()) return [{classes: node.value, node}];
    if (path.isNullLiteral() || path.isIdentifier({name: 'undefined'}) ||
      path.isBooleanLiteral({value: false})) return [];
    if (path.isTemplateLiteral()) {
      const quasis = path.get('quasis');
      return quasis.flatMap((quasi, i) => {
        const text = quasi.node.value.cooked;
        const expression = path.get('expressions')[i];
        if (expression && ((text && !/\s$/.test(text)) ||
          /^\S/.test(quasis[i + 1].node.value.cooked))) {
          throw new TailwindError('class names must be whole words; `bg-${...}` cannot be compiled. ' +
            'Write complete classes, e.g. ${active ? "bg-sky-800" : "bg-slate-800"}', quasi.node);
        }
        return [{classes: text, node: quasi.node}, ...(expression ? collect(expression, seen) : [])];
      });
    }
    if (path.isConditionalExpression()) return [{test: node.test,
      consequent: collect(path.get('consequent'), seen), alternate: collect(path.get('alternate'), seen)}];
    if (path.isLogicalExpression({operator: '&&'}))
      return [{test: node.left, consequent: collect(path.get('right'), seen), alternate: []}];
    if (path.isIdentifier()) {
      const binding = path.scope.getBinding(node.name);
      const init = binding?.path.isVariableDeclarator() && binding.kind === 'const' && binding.path.get('init');
      if (init?.node && !seen.has(binding)) return collect(init, new Set(seen).add(binding));
    }
    throw new TailwindError('className must be known at build time: a string, a template literal, ' +
      '`cond ? "a" : "b"`, `cond && "a"`, or a const holding one of these', node);
  }

  function parse(segments) {
    const statics = segments.filter(s => 'classes' in s);
    for (const {classes, node} of statics) {
      try {
        compiler.parse(classes);
      } catch (error) {
        if (error instanceof ClassError) throw new TailwindError(error.message, node, error.token);
        throw error;
      }
    }
    return compiler.parse(statics.map(s => s.classes).join(' '));
  }

  function finalize(fragment, context, node) {
    try {
      return compiler.finalize(fragment, context);
    } catch (error) {
      if (error instanceof ClassError) throw new TailwindError(error.message, node);
      throw error;
    }
  }

  /**
   * Builds the style expression for segments; `context` is the enclosing static fragment. When
   * `animated`, opacity and transforms leave the style for a motion target: the static part, the
   * layers that conditions and variants spread over it, and the keys those layers change.
   */
  function build(segments, element, imports, node, context = {}, animated = false) {
    const {base, variants, imports: fonts, motion} = parse(segments);
    fonts.forEach(path => imports.add(path));
    const scope = {...context, ...base, $transform: {...context.$transform, ...base.$transform},
      $gradient: {...context.$gradient, ...base.$gradient}};
    const entries = [];
    const [target, rest] = animated ? splitTarget(base) : [{}, base];
    const layers = [];
    const dynamic = new Set();
    const style = finalize(rest, scope, node);
    if (Object.keys(style).length) entries.push(t.valueToNode(style));
    for (const segment of segments.filter(s => 'test' in s)) {
      const [yes, no] = [segment.consequent, segment.alternate].map(s => {
        const result = s.length ? build(s, element, imports, node, scope, animated) : null;
        if (result?.motion) throw new TailwindError('animation classes must be static; ' +
          'move them out of the conditional part of className', node);
        [...result?.dynamic ?? [], ...Object.keys(result?.target ?? {})].forEach(key => dynamic.add(key));
        return result;
      });
      const [consequent, alternate] = [yes, no].map(r => r?.style ?? t.nullLiteral());
      if (!t.isNullLiteral(consequent) || !t.isNullLiteral(alternate))
        entries.push(t.conditionalExpression(segment.test, consequent, alternate));
      const [a, b] = [yes, no].map(r => r && targetExpression(r.target, r.layers));
      if (a || b) layers.push({expression: t.conditionalExpression(t.cloneNode(segment.test, true),
        a ?? t.nullLiteral(), b ?? t.nullLiteral())});
    }
    const variantLayers = [];
    for (const {props, fragment} of variants) {
      if (!element) throw new TailwindError(`variants such as ${props[0]}: need a JSX element prop; ` +
        'tw templates take base classes only', node);
      const tests = props.map(prop => variantTest(element, prop, node));
      const test = tests.reduce((a, b) => t.logicalExpression('&&', a, b));
      const [values, styles] = animated ? splitTarget(fragment) : [{}, fragment];
      const variantStyle = finalize(styles, scope, node);
      if (Object.keys(variantStyle).length)
        entries.push(t.conditionalExpression(test, t.valueToNode(variantStyle), t.nullLiteral()));
      if (Object.keys(values).length) variantLayers.push({props, test, values});
    }
    for (const layer of variantLayers.sort(byPriority)) {
      Object.keys(layer.values).forEach(key => dynamic.add(key));
      layers.push(layer);
    }
    const expression = !entries.length ? t.nullLiteral()
      : entries.length === 1 ? entries[0] : t.arrayExpression(entries);
    return {style: expression, base, target, layers, dynamic, motion};
  }

  /** The static target with its layers spread over it; null when there is nothing to animate. */
  function targetExpression(target, layers) {
    const literal = t.valueToNode(target);
    if (!layers.length) return Object.keys(target).length ? literal : null;
    const [first] = layers;
    if (layers.length === 1 && first.values) return t.conditionalExpression(t.cloneNode(first.test, true),
      t.valueToNode({...target, ...first.values}), literal);
    return t.objectExpression([...literal.properties, ...layers.map(layer => t.spreadElement(
      layer.expression ??
        t.conditionalExpression(t.cloneNode(layer.test, true), t.valueToNode(layer.values), t.nullLiteral())))]);
  }

  function variantTest(element, prop, node) {
    const attribute = element.node.attributes.find(a => t.isJSXAttribute(a) && a.name.name === prop);
    const own = ownState(element);
    if (!attribute && own?.props.has(prop)) return t.memberExpression(t.cloneNode(own.param), t.identifier(prop));
    if (!attribute) throw new TailwindError(`${prop}: variant needs a ${prop}={...} prop on this element` +
      (prop in WHILE ? ' or a focusable element (focusable, onPress, or Pressable)' : ''), node);
    if (attribute.value === null) return t.booleanLiteral(true);
    const value = t.isJSXExpressionContainer(attribute.value) ? attribute.value.expression : attribute.value;
    if (!isPure(value)) throw new TailwindError(`the ${prop} prop is read twice by ${prop}: classes; ` +
      'move the expression into a variable first', value);
    return t.cloneNode(value, true);
  }

  /** The name a binding imports from '@ps5-react/core', or null. */
  function coreImport(scope, name) {
    const binding = scope.getBinding(name);
    if (binding?.kind !== 'module' || binding.path.parent.source.value !== CORE) return null;
    return binding.path.node.imported?.name ?? null;
  }

  /** Rebuilds `segments` with motion targets; null when the animation classes animate nothing. */
  function animate(segments, element, imports, node, scale) {
    const result = build(segments, element, imports, node, {}, true);
    const {height} = result.base;
    let props;
    try {
      props = motionProps(result.motion, {target: result.target, dynamic: result.dynamic,
        height: typeof height === 'number' ? height / scale : undefined});
    } catch (error) {
      if (!(error instanceof UtilityError)) throw error;
      const segment = segments.find(s => s.classes?.split(/\s+/).includes(error.token));
      throw new TailwindError(`${error.token}: ${error.message}`, segment?.node ?? node, error.token);
    }
    if (!props) return null;
    const name = element.node.name;
    const primitive = t.isJSXIdentifier(name) && coreImport(element.scope, name.name);
    if (!['View', 'Text', 'Image'].includes(primitive)) throw new TailwindError('animation classes ' +
      `need View, Text or Image from ${CORE}; for your component use motion.create`, node);
    // A layer of focus state alone becomes whileFocus/whilePress, which the motion element resolves.
    const own = ownState(element);
    const whiles = {};
    const layers = result.layers.filter(layer => {
      const prop = layer.props?.length === 1 && own?.props.has(layer.props[0]) && layer.props[0];
      if (prop) whiles[WHILE[prop]] = layer.values;
      return !prop;
    });
    const animateTarget = targetExpression(props.animate, layers);
    if (own && animateTarget && reads(animateTarget, own.param)) throw new TailwindError('focused: and ' +
      'pressed: animation classes stacked with other variants or inside conditional classes need ' +
      'an explicit focused={...} or pressed={...} prop', node);
    const reserved = [...MOTION_PROPS, ...Object.keys(whiles)];
    for (const attribute of element.node.attributes) {
      if (t.isJSXAttribute(attribute) && reserved.includes(attribute.name.name))
        throw new TailwindError(`the ${attribute.name.name} prop conflicts with animation classes; ` +
          'use motion props or classes, not both', attribute);
    }
    const motionName = t.jsxMemberExpression(t.jsxIdentifier(MOTION), t.jsxIdentifier(primitive));
    element.node.name = motionName;
    const closing = element.parent.closingElement;
    if (closing) closing.name = t.cloneNode(motionName);
    const values = {...props, animate: animateTarget ?? undefined, ...whiles};
    for (const key of reserved.filter(key => values[key] !== undefined)) {
      const value = t.isNode(values[key]) ? values[key] : t.valueToNode(values[key]);
      element.node.attributes.push(t.jsxAttribute(t.jsxIdentifier(key), t.jsxExpressionContainer(value)));
    }
    return result.style;
  }

  return {
    name: 'ps5-react-tailwind',
    visitor: {
      Program: {
        enter(_, state) {
          state.fontImports = new Set();
          state.motion = false;
        },
        exit(path, state) {
          for (const font of state.fontImports)
            path.unshiftContainer('body', t.importDeclaration([], t.stringLiteral(font)));
          if (state.motion) path.unshiftContainer('body', t.importDeclaration([t.importSpecifier(
            t.identifier(MOTION), t.identifier('motion'))], t.stringLiteral(CORE)));
        },
      },
      JSXAttribute(path, state) {
        if (path.node.name.name !== 'className') return;
        const element = path.parentPath;
        const value = path.get('value');
        const expression = value.isJSXExpressionContainer() ? value.get('expression') : value;
        const segments = collect(expression);
        const plain = build(segments, element, state.fontImports, path.node);
        const animated = plain.motion &&
          animate(segments, element, state.fontImports, path.node, compiler.scale);
        state.motion ||= Boolean(animated);
        const existing = element.get('attributes').find(a => a.isJSXAttribute() && a.node.name.name === 'style');
        const current = existing && (existing.node.value.expression ?? existing.node.value);
        const own = ownState(element);
        let style = animated ?? plain.style;
        if (own && (reads(style, own.param) || (current && !isPlainStyle(current))))
          style = stateStyle(style, current, own.param);
        else if (current) style = t.arrayExpression([style, current]);
        if (existing) {
          existing.node.value = t.jsxExpressionContainer(style);
          path.remove();
        } else if (t.isNullLiteral(style)) {
          path.remove();
        } else {
          path.replaceWith(t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(style)));
        }
      },
      TaggedTemplateExpression(path, state) {
        const tag = path.get('tag');
        if (!tag.isIdentifier()) return;
        if (coreImport(path.scope, tag.node.name) !== 'tw') return;
        const {style, motion} = build(collect(path.get('quasi')), null, state.fontImports, path.node);
        if (motion) throw new TailwindError('animation classes need a JSX element; ' +
          'tw templates take style classes only', path.node);
        path.replaceWith(t.isNullLiteral(style) ? t.objectExpression([]) : style);
      },
    },
  };
}
