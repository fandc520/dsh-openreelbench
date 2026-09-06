/**
 * A dependency-free renderer for asserting what a client component emits.
 *
 * `react-dom` is not a dependency here and should not become one: the plugin
 * ships a bundle that may import nothing but `react`, and a test-only DOM would
 * be a second React runtime to keep in step for no gain. What these tests need
 * is not a DOM — it is the answer to "which element type did this branch pick",
 * and that is decided before any DOM exists.
 *
 * So this calls the component function directly with React's hook dispatcher
 * stubbed out. Hooks return their initial values and effects never fire, which
 * is exactly a first render: enough to see which branch a prop selects, and
 * honest about being nothing more than that.
 */
import React from 'react'

const INTERNALS = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

const DISPATCHER = {
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useReducer: (_reduce, initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useInsertionEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useContext: () => undefined,
  useDebugValue: () => {},
  useId: () => ':r0:',
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useImperativeHandle: () => {},
  useTransition: () => [false, (fn) => fn()],
  useDeferredValue: (value) => value,
}

const MEMO = Symbol.for('react.memo')
const FORWARD_REF = Symbol.for('react.forward_ref')

function unwrap(type) {
  if (typeof type === 'object' && type !== null) {
    if (type.$$typeof === MEMO) return unwrap(type.type)
    if (type.$$typeof === FORWARD_REF) return type.render
  }
  return type
}

/** One node of the rendered tree: a host tag plus its rendered children. */
function walk(node, depth) {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [{ tag: '#text', text: String(node), props: {}, children: [] }]
  if (Array.isArray(node)) return node.flatMap((child) => walk(child, depth))
  if (depth > 40) throw new Error('render went 40 deep; component is probably recursing')

  const type = unwrap(node.type)
  if (typeof type === 'function') {
    // A class component would need an instance; none exist in this plugin, and
    // failing loudly beats silently rendering nothing.
    if (type.prototype?.isReactComponent === true) throw new Error('class components are not supported')
    return walk(type(node.props), depth + 1)
  }
  if (typeof type !== 'string') {
    // Fragment, Suspense and friends: transparent, so recurse into children.
    return walk(node.props?.children, depth + 1)
  }
  const { children, ...props } = node.props ?? {}
  return [{ tag: type, props, children: walk(children, depth + 1) }]
}

/** Render one element to a plain tree, with hooks stubbed at their initial values. */
export function render(element) {
  const previous = INTERNALS.ReactCurrentDispatcher.current
  INTERNALS.ReactCurrentDispatcher.current = DISPATCHER
  try {
    return walk(element, 0)
  } finally {
    INTERNALS.ReactCurrentDispatcher.current = previous
  }
}

/** Every node in the tree, depth-first, so a test can ask what got emitted. */
export function flatten(tree) {
  return tree.flatMap((node) => [node, ...flatten(node.children)])
}

/** The tags a render produced, in order — the shape most assertions want. */
export function tags(element) {
  return flatten(render(element)).map((node) => node.tag).filter((tag) => tag !== '#text')
}
