/**
 * What a component owns and what a plain `def` may not: the `using` a
 * construction section has no scope to release at, the component element a
 * helper answers with but cannot build, and the reactive declaration that makes
 * a markup helper a component in a function's clothes.
 *
 * D115 P4 R3c. The three are one module because each of them is the same
 * question asked from a different side — who owns the value this position
 * produces — and each answers it from the component depths.
 */
import { type Statement } from "@velarscript/compiler/extension";
import { bodyReturnsJsx, carriesWebNode, componentSpelling, firstReactiveDeclaration, returnedMarkupRoots } from "../jsx-detection.ts";
import { diagnostic } from "../web-types.ts";
import { type ComponentAnalysisHost } from "./host.ts";

type FunctionDeclaration = Extract<Statement, { readonly kind: "FunctionDeclaration" }>;

/**
 * D43 item 69: a component body is a construction section, not a scope with
 * an exit — its resources live until unmount. Ownership belongs to the
 * lifecycle hook or to a function inside the component, so the setup section
 * says so instead of releasing at the wrong moment.
 *
 * Null means this position has nothing of its own to say, and the base
 * analyzer's own answer stands.
 */
export function ownershipScopeRejection(host: ComponentAnalysisHost): string | null {
  if (host.componentStates !== null && host.mountedDepth === 0 && host.cleanupDepth === 0 && host.watchBodyDepth === 0
    && host.inComponentSetupPosition()) {
    return "A component body builds the component and does not end, so a 'using' here has no scope to release at; own the resource inside an action, a method, or the cleanup hook";
  }
  return null;
}

/**
 * P2b-5: a `def` that answers markup and answers it with a component element.
 *
 * Everything about the shape is legal one step out. A component element is a
 * legal module-level expression — `const root = <App />` is the instantiation
 * site D90 R4-b rules on, and `mount` takes exactly the instance it evaluates
 * to. A `def` answering markup is a legal markup helper — dispatch over a
 * closed vocabulary is what the P2b wave was writing. The defect is only
 * where the two meet, and it is a representation split the type does not
 * carry: a component element in a *child* position lowers to `__velarChild`,
 * which owns a scope and answers a DOM node, while the same element standing
 * alone lowers to `__velarInstantiate`, which answers an instance. Both are
 * typed `WebNode`; only one is one. Returned from a helper and handed to a
 * render, the instance reaches `__velarAppend` and takes the whole subtree
 * down with "JSX can render only text, finite numbers, bool, enums, WebNode
 * values, and Lists of those values" — the check-green, runtime-dead shape.
 *
 * The walk stops at every JSX element, which is exactly where the emitter
 * stops: inside one, every position is a child position and every component
 * element there is already correct — `return <div><Badge /></div>` and an
 * interpolated `{cond ? <Badge /> : ...}` both work today and must keep
 * working. Only a component element the returned markup *starts* with is the
 * defect, including one reached through a `.map(...)` answering a row per
 * item, which fails the same way for the same reason.
 */
export function rejectUnownedComponentElement(host: ComponentAnalysisHost, statement: FunctionDeclaration): void {
  // A helper nested in a component body is emitted with that component's
  // scope in hand, so its component elements are `__velarChild` and answer
  // nodes. Only a helper standing outside every component body has nowhere
  // for the emitter to put them.
  if (host.componentBodyDepth > 0) return;
  const answersMarkup = statement.returnType
    ? carriesWebNode(host.resolveAnnotation(statement.returnType))
    : bodyReturnsJsx(statement.body);
  if (!answersMarkup) return;
  for (const element of returnedMarkupRoots(statement.body)) {
    if (!/^[A-Z]/u.test(element.tag)) continue;
    host.diagnostics.push(diagnostic(
      "VEL5075",
      `'${statement.name}' answers markup with the component element '<${element.tag} />', and a component element standing on its own is an instance rather than a node: it is built by the position that shows it, and a 'def' is not one, so what this returns fails the moment JSX tries to render it. Write '<${element.tag} />' where it is rendered — a component's own body, or a child position inside markup this returns such as '<div><${element.tag} ... /></div>' — and keep the helper for the native elements it builds.`,
      element.span,
    ));
  }
}

/**
 * The audit's seventh root cause: a `def` that declares reactive state and
 * answers `WebNode` is a component wearing a function's clothes, and calling
 * it bypasses exactly what the charter already refuses `View(...)` for. Two
 * things follow from the call, both reproduced: every call runs the `state`
 * declaration again, so the value resets on every re-render; and the
 * observers the returned markup registers bind to whatever scope the call
 * site was building — at module scope the global one, which is never
 * destroyed, so they are never cleaned up.
 *
 * Only DECLARATION is refused. A `def -> WebNode` that merely reads state or a
 * prop is a legitimate markup helper — examples/app has two — and a `def`
 * nested inside a component binds its observers to that component's scope, so
 * nothing about reading is defective.
 *
 * What answers "this `def` returns markup" is the sink, not one spelling of
 * it: `-> WebNode?` and `-> List<WebNode>` are the shapes markup travels in,
 * and a `def` may carry no return type at all — all three reached the same
 * defect with the same body while only the bare annotation was read.
 */
export function rejectStatefulWebNodeFunction(host: ComponentAnalysisHost, statement: FunctionDeclaration): void {
  const answersMarkup = statement.returnType
    ? carriesWebNode(host.resolveAnnotation(statement.returnType))
    : bodyReturnsJsx(statement.body);
  if (!answersMarkup) return;
  const declaration = firstReactiveDeclaration(statement.body);
  if (!declaration) return;
  const component = componentSpelling(statement.name);
  host.diagnostics.push(diagnostic(
    "VEL5074",
    `'${statement.name}' declares ${declaration.label} and returns WebNode, so calling it bypasses JSX ownership, prop cells, and lifecycle: every call declares the value again, so it resets on each render, and the observers its markup registers belong to whatever scope the call site was building rather than to this value. Write it as a component — 'component ${component}(...)' rendered as '<${component} />'; a 'def' that returns WebNode is a markup helper and may only read.`,
    declaration.span,
  ));
}
