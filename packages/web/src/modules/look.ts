/**
 * `velar/look` — the builders and public visual type names the module publishes.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { LOOK_PUBLIC_TYPE_NAMES } from "../look.ts";
import { webLengthPercentageInput } from "../types.ts";
import {
  angleType,
  boolType,
  colorInputType,
  durationType,
  filterType,
  keyframesType,
  lengthType,
  lookBuilder,
  lookScalarType,
  moduleInterface,
  numberType,
  percentageType,
  repeatCountType,
  stringType,
  trackInputType,
} from "./types.ts";

const lookModuleExports = new Map<string, ValueType>([
  ...LOOK_PUBLIC_TYPE_NAMES.map((name) => [name, { kind: "typeObject", name, value: { kind: "named", name } } as ValueType] as const),
  // D103: a token reference has no visual kind of its own, because the design
  // system owns the value and the compiler cannot see it. `string` is the type
  // every checked Look property kind already admits alongside its own visual
  // type, which is what makes one spelling legal in all of them; the kinds keep
  // their D37 keyword tables, which read literals and folded keywords and so
  // never see a call.
  ["token", lookBuilder("token", [stringType])],
  ["color", lookBuilder("color", [stringType])],
  ["rgb", lookBuilder("rgb", [numberType, numberType, numberType])],
  ["rgba", lookBuilder("rgba", [numberType, numberType, numberType, numberType])],
  ["hsl", lookBuilder("hsl", [numberType, percentageType, percentageType])], // LK-I3: CSS spells those two slots as percentages and so does this language.
  ["alpha", lookBuilder("alpha", [colorInputType, numberType])],
  ["lighten", lookBuilder("lighten", [colorInputType, numberType])],
  ["darken", lookBuilder("darken", [colorInputType, numberType])],
  ["border", lookBuilder("border", [lengthType, colorInputType, stringType])],
  ["shadow", lookBuilder("shadow", [lengthType, lengthType, lengthType, colorInputType, lengthType, boolType])],
  ["blur", lookBuilder("blur", [lengthType])],
  ["brightness", lookBuilder("brightness", [numberType])],
  ["contrast", lookBuilder("contrast", [numberType])],
  ["dropShadow", lookBuilder("dropShadow", [lengthType, lengthType, lengthType, colorInputType])],
  ["grayscale", lookBuilder("grayscale", [numberType])],
  ["hueRotate", lookBuilder("hueRotate", [angleType])],
  ["invert", lookBuilder("invert", [numberType])],
  ["filterOpacity", lookBuilder("filterOpacity", [numberType])],
  ["saturate", lookBuilder("saturate", [numberType])],
  ["sepia", lookBuilder("sepia", [numberType])],
  ["filters", lookBuilder("filters", [filterType], filterType)],
  ["linearGradient", lookBuilder("linearGradient", [angleType, colorInputType, colorInputType])],
  ["asset", lookBuilder("asset", [stringType])],
  ["minmax", lookBuilder("minmax", [trackInputType, trackInputType])],
  ["repeat", lookBuilder("repeat", [repeatCountType, trackInputType])],
  ["tracks", lookBuilder("tracks", [trackInputType], trackInputType)],
  ["transition", lookBuilder("transition", [stringType, durationType, stringType, durationType])],
  ["spacing", lookBuilder("spacing", [lookScalarType, lookScalarType, lookScalarType, lookScalarType])],
  ["min", lookBuilder("min", [webLengthPercentageInput, webLengthPercentageInput])],
  ["max", lookBuilder("max", [webLengthPercentageInput, webLengthPercentageInput])],
  ["clamp", lookBuilder("clamp", [webLengthPercentageInput, webLengthPercentageInput, webLengthPercentageInput])],
  ["animate", lookBuilder(
    "animate",
    [keyframesType, durationType, stringType, durationType, numberType, boolType, stringType, stringType],
  )],
]);

// D52 rule 114: `Look.` is gone. JavaScript has no `Look` global, so the
// prefix was ours to invent and ours to withdraw — and a look block is the
// densest run of calls in the language, which is the worst place to spend four
// characters per call on a word that adds nothing. The builders are named
// imports again; `Look` survives only as the type of a look value.

export const velarLookModuleEntry: readonly [string, ModuleInterface] = ["velar/look", moduleInterface(lookModuleExports)];
