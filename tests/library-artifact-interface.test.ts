import assert from "node:assert/strict";
import test from "node:test";
import {
  genericApplicationIdentity,
  genericApplicationType,
  type ClassInfo,
  type ModuleInterface,
  type ValueType,
} from "@velarscript/compiler";
import { decodeVelarLibraryInterface } from "../packages/cli/src/library-artifact.ts";

const numberType = { kind: "number" } as const;

function emptyInterface(): ModuleInterface {
  return {
    exports: new Map(),
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes: new Map(),
    namedTypeIdentities: new Map(),
    typeAliases: new Map(),
    enums: new Map(),
    classes: new Map(),
    tests: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  };
}

function classInfo(overrides: Partial<ClassInfo> = {}): ClassInfo {
  return {
    parameters: [],
    requiredParameters: 0,
    base: null,
    abstract: false,
    fields: new Map(),
    getters: new Set(),
    abstractGetters: new Set(),
    methods: new Map(),
    abstractMethods: new Set(),
    staticFields: new Map(),
    staticGetters: new Set(),
    staticMethods: new Map(),
    ...overrides,
  };
}

function uncheckedWire(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return { tag: "array", value: value.map(uncheckedWire) };
  if (value instanceof Map) {
    return { tag: "map", value: [...value].map(([key, item]) => [uncheckedWire(key), uncheckedWire(item)]) };
  }
  if (value instanceof Set) return { tag: "set", value: [...value].map(uncheckedWire) };
  if (value && typeof value === "object") {
    return {
      tag: "object",
      value: Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, uncheckedWire(item)]),
    };
  }
  throw new TypeError(`unsupported unchecked wire value ${String(value)}`);
}

function untrustedInterfaceText(interface_: ModuleInterface): string {
  return JSON.stringify({ formatVersion: 1, abiVersion: 1, interface: uncheckedWire(interface_) });
}

test("the frozen ABI rejects malformed generic and callable correlations before analysis", () => {
  const genericDeclaration = {
    identity: "schema#Box",
    name: "Box",
    parameterNames: ["T"],
    parameterBounds: [null],
    fields: new Map<string, ValueType>(),
  } as const;
  const genericClass = classInfo({
    identity: "schema#Crate",
    typeParameterNames: ["T"],
    typeParameterBounds: [null],
  });
  const application = {
    declaration: genericDeclaration.identity,
    name: genericDeclaration.name,
    arguments: [numberType],
  } as const;
  const cases: readonly {
    readonly name: string;
    readonly interface_: ModuleInterface;
    readonly expected: RegExp;
  }[] = [
    {
      name: "generic record bounds",
      interface_: {
        ...emptyInterface(),
        genericTypes: new Map([["Box", { ...genericDeclaration, parameterBounds: [] }]]),
      },
      expected: /parameterBounds must contain one entry for every parameterNames item/u,
    },
    {
      name: "generic class bounds",
      interface_: {
        ...emptyInterface(),
        classes: new Map([["Crate", { ...genericClass, typeParameterBounds: [] }]]),
      },
      expected: /typeParameterBounds must contain one entry for every typeParameterNames item/u,
    },
    {
      name: "generic class identity",
      interface_: {
        ...emptyInterface(),
        classes: new Map([["Crate", classInfo({ typeParameterNames: ["T"], typeParameterBounds: [null] })]]),
      },
      expected: /identity is required for a generic class declaration/u,
    },
    {
      name: "callable bounds without names",
      interface_: {
        ...emptyInterface(),
        exports: new Map([["bad", {
          kind: "function", typeParameterBounds: [null], parameters: [], requiredParameters: 0, result: numberType,
        }]]),
      },
      expected: /typeParameterBounds requires .*typeParameterNames/u,
    },
    {
      name: "callable parameter names",
      interface_: {
        ...emptyInterface(),
        exports: new Map([["bad", {
          kind: "function", parameters: [numberType], parameterNames: [], requiredParameters: 1, result: numberType,
        }]]),
      },
      expected: /parameterNames must match .*parameters length/u,
    },
    {
      name: "callable required count",
      interface_: {
        ...emptyInterface(),
        exports: new Map([["bad", {
          kind: "function", parameters: [numberType], requiredParameters: 2, result: numberType,
        }]]),
      },
      expected: /requiredParameters cannot exceed .*parameters length/u,
    },
    {
      name: "application identity",
      interface_: {
        ...emptyInterface(),
        exports: new Map([["bad", {
          ...genericApplicationType(application.declaration, application.name, application.arguments),
          identity: "schema#wrong",
        }]]),
      },
      expected: /identity must match its generic application identity/u,
    },
    {
      name: "known declaration arity",
      interface_: {
        ...emptyInterface(),
        genericTypes: new Map([["Box", genericDeclaration]]),
        exports: new Map([["bad", genericApplicationType(genericDeclaration.identity, genericDeclaration.name, [])]]),
      },
      expected: /arguments must contain 1 item for 'schema#Box'/u,
    },
    {
      name: "class declaration and application",
      interface_: {
        ...emptyInterface(),
        classes: new Map([["Crate", { ...genericClass, application: {
          declaration: genericClass.identity!, name: "Crate", arguments: [numberType],
        } }]]),
      },
      expected: /cannot be both a generic class declaration and an application/u,
    },
    {
      name: "generic base identity",
      interface_: {
        ...emptyInterface(),
        classes: new Map([
          ["Crate", genericClass],
          ["Derived", classInfo({
            identity: "schema#Derived",
            base: "schema#wrong",
            baseApplication: { declaration: genericClass.identity!, name: "Crate", arguments: [numberType] },
          })],
        ]),
      },
      expected: /base must match its generic base application identity/u,
    },
  ];

  for (const fixture of cases) {
    assert.throws(
      () => decodeVelarLibraryInterface(untrustedInterfaceText(fixture.interface_)),
      fixture.expected,
      fixture.name,
    );
  }
  assert.equal(genericApplicationIdentity(application.declaration, application.arguments), "schema#Box<6:number>");
});
