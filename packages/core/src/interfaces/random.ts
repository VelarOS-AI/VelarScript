import type { ModuleInterface, ValueType } from "@velarscript/compiler";
import { stringType, numberType, boolType, apiFunction, moduleInterface } from "./types.ts";

const randomIdentity = "velar/random#type:Random";
const randomType: ValueType = { kind: "named", name: "Random", identity: randomIdentity };
const randomSeedType: ValueType = { kind: "union", members: [stringType, numberType] };
const randomElementType: ValueType = { kind: "parameter", name: "T", index: 0 };

const randomNamedTypes = new Map([
  ["Random", new Map([
    ["number", apiFunction([], [], numberType)],
    ["int", apiFunction(["start", "end"], [numberType, numberType], numberType, 1)],
    ["bool", apiFunction(["probability"], [numberType], boolType, 0)],
    ["pick", { kind: "function", typeParameterNames: ["T"], parameters: [{ kind: "list", element: randomElementType }], parameterNames: ["values"], requiredParameters: 1, result: randomElementType } satisfies ValueType],
    ["shuffle", { kind: "function", typeParameterNames: ["T"], parameters: [{ kind: "list", element: randomElementType }], parameterNames: ["values"], requiredParameters: 1, result: { kind: "list", element: randomElementType } } satisfies ValueType],
    ["fork", apiFunction(["label"], [stringType], randomType)],
  ])],
]);
const randomReadonlyFields = new Map([["Random", new Set(["number", "int", "bool", "pick", "shuffle", "fork"])]]);

/** `velar/random`: the seeded generator and what it can be asked for. */
export const randomModuleInterface: ModuleInterface = moduleInterface(
  new Map([
    ["Random", { kind: "typeObject", name: "Random", value: randomType }],
    ["random", apiFunction(["seed"], [randomSeedType], randomType)],
  ]),
  new Map(),
  randomNamedTypes,
  new Map(),
  randomReadonlyFields,
  new Map([["Random", randomIdentity]]),
);
