/**
 * Where inside a component the walk stands, and what that position refuses: a
 * `return` nested in a body that has no function frame, and an `await` in one of
 * the three synchronous positions.
 *
 * D115 P4 R3c. All three are readings of the depths and of nothing else, which
 * is why they are one module: a change to what counts as "inside the body" has
 * to move all three together or the three answers stop agreeing.
 */
import { type ComponentAnalysisHost } from "./host.ts";

/**
 * D114 0.29.0 JX-I2: a component body has no function frame, so a `return` nested
 * inside it — in a `match` arm, an `if`, a `for` — used to earn VEL3003 next to
 * VEL5008 ("exactly one top-level return"), two rules its author can only read as
 * contradicting each other. A lifecycle hook and a watch body are inside the same
 * component and are *not* it: neither returns anything, so a `return` there keeps
 * VEL3003.
 */
export function extensionOwnsFunctionlessReturn(host: ComponentAnalysisHost): boolean {
  return host.componentBodyDepth > 0 && host.mountedDepth === 0 && host.cleanupDepth === 0 && host.watchBodyDepth === 0;
}

export function invalidExtensionAwaitContext(host: ComponentAnalysisHost): boolean {
  return host.synchronousReactiveDepth > 0 || host.jsxDepth > 0
    || (host.componentStates !== null && host.mountedDepth === 0);
}

export function invalidExtensionAwaitMessage(host: ComponentAnalysisHost): string | null {
  if (host.jsxDepth > 0) return "JSX rendering is synchronous; load async component data with a resource or await before constructing JSX";
  if (host.synchronousReactiveDepth > 0) return "Computed callbacks and watch blocks are synchronous; use resource, action, or mounted for async work";
  return "Component setup and cleanup are synchronous; use resource, action, or mounted for async work";
}
