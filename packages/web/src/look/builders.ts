/**
 * The `velar/look` builders: the shape of every call, the numeric domains their
 * arguments hold to, and the two rosters derived from that one table.
 */
/** Builders that compose lengths: a unitless argument other than 0 is dead CSS. */
export const LOOK_LENGTH_BUILDERS = new Set(["spacing", "tracks", "minmax", "min", "max", "clamp", "border", "shadow", "blur", "dropShadow"]);

/**
 * The numeric domains the velar/look builders enforce at run time: name, bounds,
 * and the unit the value is written in (LK-I3: hsl's are the language's own `%`).
 * A literal argument is checked the same way while the module compiles (LOK-U8).
 */
export const LOOK_BUILDER_NUMERIC_RANGES: ReadonlyMap<string, readonly (readonly [string, number, number, "%"?] | null)[]> = new Map([
  ["rgb", [["RGB channel 1", 0, 255], ["RGB channel 2", 0, 255], ["RGB channel 3", 0, 255]]],
  ["rgba", [["RGB channel 1", 0, 255], ["RGB channel 2", 0, 255], ["RGB channel 3", 0, 255], ["RGB alpha", 0, 1]]],
  ["hsl", [null, ["HSL saturation", 0, 100, "%"], ["HSL lightness", 0, 100, "%"]]],
  ["alpha", [null, ["Color opacity", 0, 1]]],
  ["lighten", [null, ["Color amount", 0, 1]]],
  ["darken", [null, ["Color amount", 0, 1]]],
  ["brightness", [["Filter brightness", 0, 1_000_000]]],
  ["contrast", [["Filter contrast", 0, 1_000_000]]],
  ["grayscale", [["Filter grayscale", 0, 1]]],
  ["invert", [["Filter inversion", 0, 1]]],
  ["filterOpacity", [["Filter opacity", 0, 1]]],
  ["saturate", [["Filter saturation", 0, 1_000_000]]],
  ["sepia", [["Filter sepia", 0, 1]]],
]);

/** The border styles the border builder accepts, mirroring its runtime guard. */
export const LOOK_BORDER_STYLE_NAMES = new Set(["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"]);

export interface LookBuilderSignature {
  /** Parameter names, in declaration order. */
  readonly parameters: readonly string[];
  /** How many leading parameters a call must supply. */
  readonly required: number;
  /** Whether the final parameter collects the remaining arguments. */
  readonly rest?: boolean;
  /** The visual value produced by this builder, used by type and editor contexts. */
  readonly result: LookBuilderResultKind;
}

export type LookBuilderResultKind = "animation" | "border" | "color" | "filter" | "image" | "length" | "length-percentage" | "shadow" | "spacing" | "string" | "track" | "track-list" | "transition";

/**
 * Every velar/look builder and the shape of its call. Three consumers read this
 * one table — the published module interface, the named-argument check, and the
 * static lowering that has to put a named argument back at its position when a
 * builder call appears inside a `keyframes:` stop. D57 rule 134: a list two
 * places need is written once and derived from.
 */
export const LOOK_BUILDER_SIGNATURES: ReadonlyMap<string, LookBuilderSignature> = new Map<string, LookBuilderSignature>([
  // D103: the design-system reference. One parameter and no second one — see
  // LOOK_TOKEN_NO_FALLBACK_GUIDANCE for why a fallback is not a parameter.
  ["token", { parameters: ["name"], required: 1, result: "string" }],
  ["color", { parameters: ["value"], required: 1, result: "color" }],
  ["rgb", { parameters: ["red", "green", "blue"], required: 3, result: "color" }],
  ["rgba", { parameters: ["red", "green", "blue", "alpha"], required: 4, result: "color" }],
  ["hsl", { parameters: ["hue", "saturation", "lightness"], required: 3, result: "color" }],
  ["alpha", { parameters: ["color", "opacity"], required: 2, result: "color" }],
  ["lighten", { parameters: ["color", "amount"], required: 2, result: "color" }],
  ["darken", { parameters: ["color", "amount"], required: 2, result: "color" }],
  ["border", { parameters: ["width", "color", "style"], required: 2, result: "border" }],
  ["shadow", { parameters: ["x", "y", "blur", "color", "spread", "inset"], required: 4, result: "shadow" }],
  ["blur", { parameters: ["radius"], required: 1, result: "filter" }],
  ["brightness", { parameters: ["amount"], required: 1, result: "filter" }],
  ["contrast", { parameters: ["amount"], required: 1, result: "filter" }],
  ["dropShadow", { parameters: ["x", "y", "blur", "color"], required: 4, result: "filter" }],
  ["grayscale", { parameters: ["amount"], required: 1, result: "filter" }],
  ["hueRotate", { parameters: ["angle"], required: 1, result: "filter" }],
  ["invert", { parameters: ["amount"], required: 1, result: "filter" }],
  ["filterOpacity", { parameters: ["amount"], required: 1, result: "filter" }],
  ["saturate", { parameters: ["amount"], required: 1, result: "filter" }],
  ["sepia", { parameters: ["amount"], required: 1, result: "filter" }],
  ["filters", { parameters: ["first"], required: 1, rest: true, result: "filter" }],
  ["linearGradient", { parameters: ["angle", "start", "end"], required: 3, result: "image" }],
  ["asset", { parameters: ["path"], required: 1, result: "image" }],
  ["minmax", { parameters: ["minimum", "maximum"], required: 2, result: "track" }],
  ["repeat", { parameters: ["count", "size"], required: 2, result: "track-list" }],
  ["tracks", { parameters: ["first"], required: 1, rest: true, result: "track-list" }],
  ["transition", { parameters: ["property", "duration", "easing", "delay"], required: 2, result: "transition" }],
  ["spacing", { parameters: ["first", "second", "third", "fourth"], required: 1, result: "spacing" }],
  // LK-C3: a length-percentage result, because mixing `%` with `px` is what these three exist for; an all-one-kind call folds back to that kind in the analyzer.
  ["min", { parameters: ["first", "second"], required: 2, result: "length-percentage" }],
  ["max", { parameters: ["first", "second"], required: 2, result: "length-percentage" }],
  ["clamp", { parameters: ["minimum", "preferred", "maximum"], required: 3, result: "length-percentage" }],
  ["animate", { parameters: ["frames", "duration", "easing", "delay", "count", "loop", "direction", "fill"], required: 2, result: "animation" }],
]);

export const LOOK_BUILDERS = new Set(LOOK_BUILDER_SIGNATURES.keys());
