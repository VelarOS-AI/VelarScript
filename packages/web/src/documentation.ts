/**
 * The three editor-documentation tables the Web extension publishes: one entry
 * per Look hook, one per Look target, and one per Web keyword and JSX
 * directive.
 *
 * D115 P4 R3e: `compiler.ts` is the composition root, so the prose it hands the
 * editor is written here and reaches the frozen extension literal as one name.
 */
import { LOOK_HOOKS, LOOK_TARGETS } from "./look.ts";
import { webLookPropertyDocumentation } from "./editor.ts";

const webLookHookDocumentation = Object.fromEntries([...LOOK_HOOKS].map((name) => [
  `@${name}`,
  [
    `Matches the element's compiler-owned \`${name}\` state inside a \`look:\` condition. It is not a decorator, variable, or runtime callback.`,
    "",
    "```velar",
    `if @${name}:`,
    "    color = \"blue\"",
    "```",
    "",
    "The condition lowers to the corresponding live CSS state. A Look literal cannot read reactive application state; apply a different Look from JSX for that.",
  ].join("\n"),
]));

const webLookTargetDocumentation = Object.fromEntries([...LOOK_TARGETS].map((name) => [
  `@${name}`,
  [
    `Selects the compiler-owned \`::${name}\` visual target inside a \`look:\` value. It is not a decorator or user-defined nested selector.`,
    "",
    "```velar",
    `@${name}:`,
    "    content = \"\"",
    "```",
    "",
    "Only the closed target vocabulary accepted by the Web compiler is available, and every nested property remains checked by Look.",
  ].join("\n"),
]));

export const webKeywordDocumentation = Object.freeze({
  component: "Declares a compiler-managed Web component. Props are its parameters, the body initializes once per mounted instance, and JSX is returned directly.\n\n```velar\ncomponent Greeting(name: string):\n    return <p>Hello {name}</p>\n```",
  state: "Declares writable reactive state. Reading it records a dependency and assigning it schedules the owning Web update.\n\n```velar\nstate count = 0\n```",
  computed: "Declares a read-only reactive value derived synchronously from what its initializer reads. Read the value directly; it is not a function.\n\n```velar\ncomputed doubled = count * 2\n```",
  resource: "Declares component-owned asynchronous data with reactive `value`, `loading`, `ready`, `error`, and `reload` fields.\n\n```velar\nresource article: Article = loadArticle(id)\n```",
  action: "Declares an asynchronous user operation with reactive `pending` and `error` fields.\n\n```velar\naction save():\n    await saveDraft(draft)\n```",
  watch: "Runs after the watched reactive path changes and the corresponding DOM update commits. Watch a state/computed path, not an arbitrary effectful expression.\n\n```velar\nwatch query as current, previous:\n    print(f\"{previous} -> {current}\")\n```",
  "@mounted": "Runs once after the component DOM has been inserted. It is a compiler-owned component lifecycle role, not a decorator or callable hook, and its body may `await`.\n\n```velar\n@mounted:\n    await focusInitialField()\n```",
  "@cleanup": "Runs once before the component and its owned resources are destroyed. It is a compiler-owned component lifecycle role, not a decorator or callable hook, and cleanup is synchronous.\n\n```velar\n@cleanup:\n    subscription.close()\n```",
  exposes: "Declares the explicit typed Handle a component permits a parent to receive through JSX `ref`.\n\n```velar\ncomponent Dialog() exposes DialogHandle:\n```",
  expose: "Provides the Handle value promised by the component's `exposes` clause.\n\n```velar\nexpose {open, close}\n```",
  look: "Builds a typed, composable Web appearance value. Properties, units, conditions, targets, and imported `velar/look` builders are checked by the compiler.\n\n```velar\nconst card = look:\n    padding = 16px\n    if @hover:\n        color = \"blue\"\n```",
  keyframes: "Builds checked animation stops as a first-class `Keyframes` value for the `animate` builder.\n\n```velar\nconst spin = keyframes:\n    from:\n        rotate = 0deg\n    to:\n        rotate = 1turn\n```",
  css: "Marks an explicit unsafe native CSS import or raw block. Prefer Look; when CSS is necessary, its order before or after generated Look output must be stated in source.",
  "jsx:on:*": "Attaches a checked DOM event handler. Write `on:event` and optional `.prevent`, `.stop`, `.once`, `.capture`, or `.self` modifiers.\n\n```velar\n<button on:click.prevent={save}>Save</button>\n```",
  "jsx:bind:value": "Two-way binds the value of an input, textarea, or select to writable state.\n\n```velar\n<input bind:value={name} />\n```",
  "jsx:bind:checked": "Two-way binds an input's checked flag to writable bool state.\n\n```velar\n<input type=\"checkbox\" bind:checked={enabled} />\n```",
  "jsx:bind:group": "Binds a radio choice or checkbox group to writable group state using the element's checked value contract.",
  "jsx:class:*": "Adds or removes one CSS class from a bool expression. The suffix is the class name.\n\n```velar\n<section class:active={selected}></section>\n```",
  "jsx:look": "Applies a `Look`, optional Look, or ordered list of Look values to this JSX element.\n\n```velar\n<article look={cardLook}></article>\n```",
  "jsx:look:*": "Applies one checked Look property as a normal-priority JSX visual directive. Prefer a named Look for conditions, targets, or several properties.",
  "jsx:style:*": "Applies one checked high-priority inline visual override. Prefer Look for ordinary styling.",
  "jsx:ref": "Stores the mounted native element or exposed component Handle in a mutable optional `let` binding, then restores `null` during cleanup.",
  "jsx:key": "Gives a repeated JSX child stable identity. Keys must be strings, numbers, or string-backed enum values and must be stable across renders.",
  "jsx:host": "Marks the one native element that receives a component's forwarded host attributes and events.",
  "jsx:unsafe:html": "Writes explicitly unsafe HTML text into a native element. The value must be string or string?; use ordinary JSX for trusted structured content.",
  ...webLookHookDocumentation,
  ...webLookTargetDocumentation,
  ...webLookPropertyDocumentation,
});

