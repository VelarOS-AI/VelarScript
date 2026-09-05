/**
 * How a type is written down: the text `describeType` puts in a diagnostic.
 *
 * The two generic application constructors are here rather than in `model.ts`
 * for the reason their own comments give — an application's identity and its
 * display text are built by the same call so they cannot diverge — and the
 * display half is `describeType`. `model.ts` keeps `genericApplicationIdentity`,
 * which needs nothing from this module.
 */
import { genericApplicationIdentity, type ValueType } from "./model.ts";

/** The display text of one instantiation — `Box<string>`. */
export function genericApplicationName(name: string, arguments_: readonly ValueType[]): string {
  return `${name}<${arguments_.map(describeType).join(", ")}>`;
}

/** The one constructor for a resolved application, so identity and text never diverge. */
export function genericApplicationType(
  declaration: string,
  name: string,
  arguments_: readonly ValueType[],
  readonlyView = false,
): Extract<ValueType, { kind: "named" }> {
  return {
    kind: "named",
    name: genericApplicationName(name, arguments_),
    identity: genericApplicationIdentity(declaration, arguments_),
    application: { declaration, name, arguments: arguments_ },
    ...(readonlyView ? { readonlyView: true as const } : {}),
  };
}

/**
 * D55 rule 120 layer two: the one constructor for a resolved class
 * instantiation, so its identity and its display text never diverge — and so
 * they are computed by the same two functions a generic record's are.
 */
export function classApplicationType(
  declaration: string,
  name: string,
  arguments_: readonly ValueType[],
): Extract<ValueType, { kind: "class" }> {
  return {
    kind: "class",
    name: genericApplicationName(name, arguments_),
    identity: genericApplicationIdentity(declaration, arguments_),
    application: { declaration, name, arguments: arguments_ },
  };
}

export function describeType(type: ValueType): string {
  switch (type.kind) {
    case "any":
      return type.textConvertible ? "string | number | bool | enum | null" : "any";
    case "unknown":
    case "null":
    case "string":
    case "number":
    case "bool":
      return type.kind;
    case "optional":
      return `${["function", "action", "intrinsic", "union"].includes(type.inner.kind) ? `(${describeType(type.inner)})` : describeType(type.inner)}?`;
    case "list":
      return `${type.readonlyView ? "readonly " : ""}List<${describeType(type.element)}>`;
    case "set":
      return `${type.readonlyView ? "readonly " : ""}Set<${describeType(type.element)}>`;
    case "map":
      return `${type.readonlyView ? "readonly " : ""}Map<${describeType(type.key)}, ${describeType(type.value)}>`;
    case "record":
      return `${type.readonlyView ? "readonly " : ""}Record<${describeType(type.value)}>`;
    case "promise":
      return `Promise<${describeType(type.value)}>`;
    case "runtimeType":
      return `Type<${describeType(type.value)}>`;
    case "object":
      return `${type.readonlyView ? "readonly " : ""}{ ${[...type.fields].map(([name, value]) => `${type.readonlyFields?.has(name) ? "readonly " : ""}${name}${type.optionalFields?.has(name) ? "?" : ""}: ${describeType(value)}`).join(", ")} }`;
    case "named":
      return `${type.readonlyView ? "readonly " : ""}${type.name}`;
    case "parameter":
    case "class":
    case "enum":
      return type.name;
    case "enumMember":
      return `${type.name}.${type.member}`;
    case "typeObject":
    case "classConstructor":
      return type.name;
    case "enumObject":
      return `enum ${type.name}`;
    case "extension": {
      if (type.display.kind === "named") return type.display.name;
      if (type.display.kind === "constructor") return `${type.display.prefix} ${type.display.name}`;
      const display = type.display;
      const properties = [...type.properties]
        .filter(([name, value]) => {
          if (type.requiredProperties.has(name)) return true;
          const hidden = display.hiddenOptionalProperties?.get(name);
          return hidden === undefined || describeType(value) !== hidden;
        })
        .map(([name, value]) => `${name}${type.requiredProperties.has(name) ? "" : "?"}: ${describeType(value)}`);
      if (properties.length === 0 && type.arguments.length === 0) return display.name;
      return `${display.name}<(${properties.join(", ")}) -> ${display.result}${type.arguments.map((argument) => `, ${describeType(argument)}`).join("")}>`;
    }
    case "function":
    case "action":
    case "intrinsic":
      return `${type.kind === "action" ? "action " : ""}${type.typeParameterNames?.length ? `<${type.typeParameterNames.join(", ")}>` : ""}(${[
        ...type.parameters.map((parameter, index) => {
          const described = describeType(parameter);
          const labeled = type.parameterNames?.[index] ? `${type.parameterNames[index]}: ${described}` : described;
          return index >= type.requiredParameters
            ? `${labeled} = default`
            : labeled;
        }),
        ...(type.rest ? [`...${describeType(type.rest)}`] : []),
      ].join(", ")}) -> ${describeType(type.result)}`;
    case "union":
      return type.members.map(describeType).join(" | ");
  }
}
