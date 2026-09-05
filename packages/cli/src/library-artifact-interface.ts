import {
  describeType,
  genericApplicationIdentity,
  type GenericApplication,
  type ModuleInterface,
  type ValueType,
} from "@velarscript/compiler";

const MAX_WIRE_DEPTH = 128;

/** Validates the complete untrusted ABI-1 module-interface schema. */
export function validateVelarLibraryModuleInterface(value: unknown, label: string): asserts value is ModuleInterface {
  const interface_ = record(value, label);
  exactKeys(interface_, [
    "exports", "mutableExports", "reactiveExports", "reExports", "hoistedExports", "namedTypes",
    "namedTypeReadonlyFields", "namedTypeIdentities", "namedTypeBases", "genericTypes", "typeAliases",
    "enums", "classes", "tests", "extensionExports", "extensionData",
  ], label, true);
  stringMap(interface_.exports, `${label}.exports`, validateValueType);
  stringSet(interface_.mutableExports, `${label}.mutableExports`);
  stringMap(interface_.reactiveExports, `${label}.reactiveExports`, (item, itemLabel) => {
    if (item !== "state") throw new Error(`${itemLabel} must be 'state'`);
  });
  stringMap(interface_.reExports, `${label}.reExports`, (item, itemLabel) => {
    const target = record(item, itemLabel);
    exactKeys(target, ["source", "imported"], itemLabel);
    nonEmptyString(target.source, `${itemLabel}.source`);
    nonEmptyString(target.imported, `${itemLabel}.imported`);
  });
  if (interface_.hoistedExports !== undefined) stringSet(interface_.hoistedExports, `${label}.hoistedExports`);
  stringMap(interface_.namedTypes, `${label}.namedTypes`, (item, itemLabel) => stringMap(item, itemLabel, validateValueType));
  if (interface_.namedTypeReadonlyFields !== undefined) stringMap(interface_.namedTypeReadonlyFields, `${label}.namedTypeReadonlyFields`, (item, itemLabel) => stringSet(item, itemLabel));
  stringMap(interface_.namedTypeIdentities, `${label}.namedTypeIdentities`, (item, itemLabel) => nonEmptyString(item, itemLabel));
  if (interface_.namedTypeBases !== undefined) stringMap(interface_.namedTypeBases, `${label}.namedTypeBases`, validateValueType);
  if (interface_.genericTypes !== undefined) stringMap(interface_.genericTypes, `${label}.genericTypes`, validateGenericTypeInfo);
  stringMap(interface_.typeAliases, `${label}.typeAliases`, validateValueType);
  stringMap(interface_.enums, `${label}.enums`, validateEnumInfo);
  stringMap(interface_.classes, `${label}.classes`, validateClassInfo);
  if (!Array.isArray(interface_.tests) || interface_.tests.length > 100_000) throw new Error(`${label}.tests must be a bounded list`);
  for (const [index, item] of interface_.tests.entries()) {
    const test = record(item, `${label}.tests[${index}]`);
    exactKeys(test, ["name", "title"], `${label}.tests[${index}]`);
    nonEmptyString(test.name, `${label}.tests[${index}].name`);
    if (typeof test.title !== "string") throw new Error(`${label}.tests[${index}].title must be a string`);
  }
  stringMap(interface_.extensionExports, `${label}.extensionExports`, (item, itemLabel) => stringMap(item, itemLabel, validatePortableData));
  stringMap(interface_.extensionData, `${label}.extensionData`, validatePortableData);
  validateKnownGenericApplicationArities(interface_ as unknown as ModuleInterface, label);
}

function validateValueType(value: unknown, label: string, depth = 0): void {
  if (depth > MAX_WIRE_DEPTH) throw new RangeError(`${label} exceeds the ABI type nesting limit`);
  const type = record(value, label);
  if (typeof type.kind !== "string") throw new Error(`${label}.kind must be a string`);
  const nested = (item: unknown, itemLabel: string): void => validateValueType(item, itemLabel, depth + 1);
  switch (type.kind) {
    case "unknown":
      exactKeys(type, ["kind", "restricted", "boundary"], label, true);
      trueFlag(type.restricted, `${label}.restricted`);
      trueFlag(type.boundary, `${label}.boundary`);
      return;
    case "any":
      exactKeys(type, ["kind", "textConvertible"], label, true);
      trueFlag(type.textConvertible, `${label}.textConvertible`);
      return;
    case "null": case "string": case "number": case "bool":
      exactKeys(type, ["kind"], label);
      return;
    case "optional":
      exactKeys(type, ["kind", "inner"], label);
      nested(type.inner, `${label}.inner`);
      return;
    case "list": case "set":
      exactKeys(type, ["kind", "element", "readonlyView"], label, true);
      nested(type.element, `${label}.element`);
      trueFlag(type.readonlyView, `${label}.readonlyView`);
      return;
    case "map":
      exactKeys(type, ["kind", "key", "value", "readonlyView"], label, true);
      nested(type.key, `${label}.key`);
      nested(type.value, `${label}.value`);
      trueFlag(type.readonlyView, `${label}.readonlyView`);
      return;
    case "record":
      exactKeys(type, ["kind", "value", "readonlyView"], label, true);
      nested(type.value, `${label}.value`);
      trueFlag(type.readonlyView, `${label}.readonlyView`);
      return;
    case "promise": case "runtimeType":
      exactKeys(type, ["kind", "value"], label);
      nested(type.value, `${label}.value`);
      return;
    case "object":
      exactKeys(type, ["kind", "fields", "readonlyFields", "optionalFields", "readonlyView", "capabilityHandle"], label, true);
      stringMap(type.fields, `${label}.fields`, nested);
      if (type.readonlyFields !== undefined) stringSet(type.readonlyFields, `${label}.readonlyFields`);
      if (type.optionalFields !== undefined) stringSet(type.optionalFields, `${label}.optionalFields`);
      trueFlag(type.readonlyView, `${label}.readonlyView`);
      trueFlag(type.capabilityHandle, `${label}.capabilityHandle`);
      return;
    case "parameter":
      exactKeys(type, ["kind", "name", "index"], label);
      nonEmptyString(type.name, `${label}.name`);
      nonNegativeInteger(type.index, `${label}.index`);
      return;
    case "named": case "class":
      exactKeys(type, type.kind === "named" ? ["kind", "name", "identity", "readonlyView", "application"] : ["kind", "name", "identity", "application"], label, true);
      nonEmptyString(type.name, `${label}.name`);
      optionalString(type.identity, `${label}.identity`);
      if (type.kind === "named") trueFlag(type.readonlyView, `${label}.readonlyView`);
      if (type.application !== undefined) {
        validateGenericApplication(type.application, `${label}.application`, nested);
        validateCanonicalApplicationType(type, label);
      }
      return;
    case "classConstructor":
      exactKeys(type, ["kind", "name", "identity"], label, true);
      nonEmptyString(type.name, `${label}.name`);
      optionalString(type.identity, `${label}.identity`);
      return;
    case "enum":
      exactKeys(type, ["kind", "name", "identity"], label);
      nonEmptyString(type.name, `${label}.name`);
      nonEmptyString(type.identity, `${label}.identity`);
      return;
    case "enumMember":
      exactKeys(type, ["kind", "name", "identity", "member"], label);
      nonEmptyString(type.name, `${label}.name`);
      nonEmptyString(type.identity, `${label}.identity`);
      nonEmptyString(type.member, `${label}.member`);
      return;
    case "enumObject":
      exactKeys(type, ["kind", "name", "identity", "members"], label);
      nonEmptyString(type.name, `${label}.name`);
      nonEmptyString(type.identity, `${label}.identity`);
      stringSet(type.members, `${label}.members`);
      return;
    case "typeObject":
      exactKeys(type, ["kind", "name", "value"], label, true);
      nonEmptyString(type.name, `${label}.name`);
      if (type.value !== undefined) nested(type.value, `${label}.value`);
      return;
    case "function": case "action": case "intrinsic":
      exactKeys(type, ["kind", "name", "typeParameterNames", "typeParameterBounds", "parameters", "parameterNames", "requiredParameters", "rest", "result"], label, true);
      if (type.kind === "intrinsic") nonEmptyString(type.name, `${label}.name`);
      else if (type.name !== undefined) throw new Error(`${label}.name is only valid on an intrinsic type`);
      callableFields(type, label, nested);
      return;
    case "extension":
      exactKeys(type, ["kind", "extensionId", "family", "role", "nominal", "properties", "requiredProperties", "arguments", "metadata", "display"], label, true);
      nonEmptyString(type.extensionId, `${label}.extensionId`);
      nonEmptyString(type.family, `${label}.family`);
      nonEmptyString(type.role, `${label}.role`);
      optionalString(type.nominal, `${label}.nominal`);
      stringMap(type.properties, `${label}.properties`, nested);
      stringSet(type.requiredProperties, `${label}.requiredProperties`);
      valueTypeList(type.arguments, `${label}.arguments`, nested);
      if (type.metadata !== undefined) stringRecord(type.metadata, `${label}.metadata`);
      validateExtensionDisplay(type.display, `${label}.display`);
      return;
    case "union":
      exactKeys(type, ["kind", "members"], label);
      valueTypeList(type.members, `${label}.members`, nested);
      return;
    default:
      throw new Error(`${label}.kind '${type.kind}' is not part of Velar library ABI 1`);
  }
}

function callableFields(type: Record<string, unknown>, label: string, nested: (value: unknown, label: string) => void): void {
  if (type.typeParameterNames !== undefined) stringList(type.typeParameterNames, `${label}.typeParameterNames`);
  if (type.typeParameterBounds !== undefined) boundList(type.typeParameterBounds, `${label}.typeParameterBounds`);
  validateTypeParameterVectors(type.typeParameterNames, type.typeParameterBounds, label);
  valueTypeList(type.parameters, `${label}.parameters`, nested);
  if (type.parameterNames !== undefined) stringList(type.parameterNames, `${label}.parameterNames`, true);
  nonNegativeInteger(type.requiredParameters, `${label}.requiredParameters`);
  validateCallableParameterShape(type.parameters, type.parameterNames, type.requiredParameters, label);
  if (type.rest !== undefined) nested(type.rest, `${label}.rest`);
  nested(type.result, `${label}.result`);
}

function validateGenericApplication(
  value: unknown,
  label: string,
  nested: (value: unknown, label: string) => void,
): asserts value is GenericApplication {
  const application = record(value, label);
  exactKeys(application, ["declaration", "name", "arguments"], label);
  nonEmptyString(application.declaration, `${label}.declaration`);
  nonEmptyString(application.name, `${label}.name`);
  valueTypeList(application.arguments, `${label}.arguments`, nested);
}

function validateCanonicalApplicationType(type: Record<string, unknown>, label: string): void {
  const application = type.application as GenericApplication;
  const expectedIdentity = genericApplicationIdentity(application.declaration, application.arguments);
  if (type.identity !== expectedIdentity) throw new Error(`${label}.identity must match its generic application identity '${expectedIdentity}'`);
  const expectedName = `${application.name}<${application.arguments.map(describeType).join(", ")}>`;
  if (type.name !== expectedName) throw new Error(`${label}.name must match its generic application name '${expectedName}'`);
}

function validateGenericTypeInfo(value: unknown, label: string): void {
  const info = record(value, label);
  exactKeys(info, ["identity", "name", "parameterNames", "parameterBounds", "fields", "readonlyFields"], label, true);
  nonEmptyString(info.identity, `${label}.identity`);
  nonEmptyString(info.name, `${label}.name`);
  stringList(info.parameterNames, `${label}.parameterNames`);
  boundList(info.parameterBounds, `${label}.parameterBounds`);
  validateTypeParameterVectors(info.parameterNames, info.parameterBounds, label, "parameterNames", "parameterBounds");
  stringMap(info.fields, `${label}.fields`, validateValueType);
  if (info.readonlyFields !== undefined) stringSet(info.readonlyFields, `${label}.readonlyFields`);
}

function validateTypeParameterVectors(
  names: unknown,
  bounds: unknown,
  label: string,
  namesField = "typeParameterNames",
  boundsField = "typeParameterBounds",
): void {
  if (names === undefined) {
    if (bounds !== undefined) throw new Error(`${label}.${boundsField} requires ${label}.${namesField}`);
    return;
  }
  const parameterNames = names as readonly string[];
  if (new Set(parameterNames).size !== parameterNames.length) throw new Error(`${label}.${namesField} must not repeat a name`);
  if (bounds !== undefined && (bounds as readonly unknown[]).length !== parameterNames.length) {
    throw new Error(`${label}.${boundsField} must contain one entry for every ${namesField} item`);
  }
}

function validateCallableParameterShape(parameters: unknown, names: unknown, required: unknown, label: string): void {
  const values = parameters as readonly unknown[];
  if (names !== undefined) {
    const parameterNames = names as readonly string[];
    if (parameterNames.length !== values.length) throw new Error(`${label}.parameterNames must match ${label}.parameters length`);
    const named = parameterNames.filter(Boolean);
    if (new Set(named).size !== named.length) throw new Error(`${label}.parameterNames must not repeat a non-empty name`);
  }
  if ((required as number) > values.length) throw new Error(`${label}.requiredParameters cannot exceed ${label}.parameters length`);
}

function validateEnumInfo(value: unknown, label: string): void {
  const info = record(value, label);
  exactKeys(info, ["identity", "members", "wireValues"], label);
  nonEmptyString(info.identity, `${label}.identity`);
  stringSet(info.members, `${label}.members`);
  stringMap(info.wireValues, `${label}.wireValues`, (item, itemLabel) => {
    if (typeof item === "string") return;
    if (typeof item !== "number" || !Number.isSafeInteger(item)) throw new Error(`${itemLabel} must be a string or a safe integer`);
  });
  if ((info.members as ReadonlySet<string>).size !== (info.wireValues as ReadonlyMap<string, string | number>).size
    || [...info.members as ReadonlySet<string>].some((member) => !(info.wireValues as ReadonlyMap<string, string | number>).has(member))) {
    throw new Error(`${label}.wireValues must define exactly one value for every enum member`);
  }
}

function validateClassInfo(value: unknown, label: string): void {
  const info = record(value, label);
  exactKeys(info, [
    "identity", "typeParameterNames", "typeParameterBounds", "application", "baseApplication", "dispose", "iterate",
    "iterateAsync", "parameters", "parameterNames", "requiredParameters", "constructorRest", "base", "abstract", "fields",
    "getters", "abstractGetters", "methods", "abstractMethods", "staticFields", "staticGetters", "staticMethods",
  ], label, true);
  optionalString(info.identity, `${label}.identity`);
  if (info.typeParameterNames !== undefined) stringList(info.typeParameterNames, `${label}.typeParameterNames`);
  if (info.typeParameterBounds !== undefined) boundList(info.typeParameterBounds, `${label}.typeParameterBounds`);
  validateTypeParameterVectors(info.typeParameterNames, info.typeParameterBounds, label);
  if (info.typeParameterNames !== undefined && info.identity === undefined) throw new Error(`${label}.identity is required for a generic class declaration`);
  if (info.application !== undefined) {
    validateGenericApplication(info.application, `${label}.application`, validateValueType);
    if (info.typeParameterNames !== undefined || info.typeParameterBounds !== undefined) {
      throw new Error(`${label} cannot be both a generic class declaration and an application`);
    }
    const expected = genericApplicationIdentity(info.application.declaration, info.application.arguments);
    if (info.identity !== expected) throw new Error(`${label}.identity must match its generic application identity '${expected}'`);
  }
  if (info.baseApplication !== undefined) validateGenericApplication(info.baseApplication, `${label}.baseApplication`, validateValueType);
  if (info.dispose !== undefined && info.dispose !== "sync" && info.dispose !== "async") throw new Error(`${label}.dispose must be 'sync' or 'async'`);
  if (info.iterate !== undefined) validateValueType(info.iterate, `${label}.iterate`);
  if (info.iterateAsync !== undefined) validateValueType(info.iterateAsync, `${label}.iterateAsync`);
  valueTypeList(info.parameters, `${label}.parameters`, validateValueType);
  if (info.parameterNames !== undefined) stringList(info.parameterNames, `${label}.parameterNames`, true);
  nonNegativeInteger(info.requiredParameters, `${label}.requiredParameters`);
  validateCallableParameterShape(info.parameters, info.parameterNames, info.requiredParameters, label);
  if (info.constructorRest !== undefined) validateValueType(info.constructorRest, `${label}.constructorRest`);
  if (info.base !== null && typeof info.base !== "string") throw new Error(`${label}.base must be a string or null`);
  if (info.baseApplication !== undefined) {
    const expected = genericApplicationIdentity(info.baseApplication.declaration, info.baseApplication.arguments);
    if (info.base !== expected) throw new Error(`${label}.base must match its generic base application identity '${expected}'`);
  }
  if (typeof info.abstract !== "boolean") throw new Error(`${label}.abstract must be a bool`);
  stringMap(info.fields, `${label}.fields`, validateClassField);
  stringSet(info.getters, `${label}.getters`);
  stringSet(info.abstractGetters, `${label}.abstractGetters`);
  stringMap(info.methods, `${label}.methods`, validateValueType);
  stringSet(info.abstractMethods, `${label}.abstractMethods`);
  stringMap(info.staticFields, `${label}.staticFields`, validateClassField);
  stringSet(info.staticGetters, `${label}.staticGetters`);
  stringMap(info.staticMethods, `${label}.staticMethods`, validateValueType);
}

function validateKnownGenericApplicationArities(interface_: ModuleInterface, label: string): void {
  const arities = new Map<string, number>();
  const register = (identity: string, arity: number): void => {
    const existing = arities.get(identity);
    if (existing !== undefined && existing !== arity) throw new Error(`${label} declares generic identity '${identity}' with conflicting arities`);
    arities.set(identity, arity);
  };
  for (const info of interface_.genericTypes?.values() ?? []) register(info.identity, info.parameterNames.length);
  for (const info of interface_.classes.values()) {
    if (info.identity && info.typeParameterNames !== undefined) register(info.identity, info.typeParameterNames.length);
  }
  const application = (value: GenericApplication, valueLabel: string): void => {
    const arity = arities.get(value.declaration);
    if (arity !== undefined && value.arguments.length !== arity) {
      throw new Error(`${valueLabel}.arguments must contain ${arity} item${arity === 1 ? "" : "s"} for '${value.declaration}'`);
    }
    value.arguments.forEach((argument, index) => visit(argument, `${valueLabel}.arguments[${index}]`));
  };
  const visit = (type: ValueType, typeLabel: string): void => {
    if ((type.kind === "named" || type.kind === "class") && type.application) application(type.application, `${typeLabel}.application`);
    switch (type.kind) {
      case "optional": return visit(type.inner, `${typeLabel}.inner`);
      case "list": case "set": return visit(type.element, `${typeLabel}.element`);
      case "map":
        visit(type.key, `${typeLabel}.key`);
        return visit(type.value, `${typeLabel}.value`);
      case "record": case "promise": case "runtimeType": return visit(type.value, `${typeLabel}.value`);
      case "object":
        for (const [name, field] of type.fields) visit(field, `${typeLabel}.fields.${name}`);
        return;
      case "typeObject":
        if (type.value) visit(type.value, `${typeLabel}.value`);
        return;
      case "extension":
        for (const [name, property] of type.properties) visit(property, `${typeLabel}.properties.${name}`);
        type.arguments.forEach((argument, index) => visit(argument, `${typeLabel}.arguments[${index}]`));
        return;
      case "function": case "action": case "intrinsic":
        type.parameters.forEach((parameter, index) => visit(parameter, `${typeLabel}.parameters[${index}]`));
        if (type.rest) visit(type.rest, `${typeLabel}.rest`);
        return visit(type.result, `${typeLabel}.result`);
      case "union":
        type.members.forEach((member, index) => visit(member, `${typeLabel}.members[${index}]`));
        return;
      default: return;
    }
  };
  for (const [name, type] of interface_.exports) visit(type, `${label}.exports.${name}`);
  for (const [name, fields] of interface_.namedTypes) for (const [field, type] of fields) visit(type, `${label}.namedTypes.${name}.${field}`);
  for (const [name, type] of interface_.namedTypeBases ?? []) visit(type, `${label}.namedTypeBases.${name}`);
  for (const [name, info] of interface_.genericTypes ?? []) {
    for (const [field, type] of info.fields) visit(type, `${label}.genericTypes.${name}.fields.${field}`);
  }
  for (const [name, type] of interface_.typeAliases) visit(type, `${label}.typeAliases.${name}`);
  for (const [name, info] of interface_.classes) {
    if (info.application) application(info.application, `${label}.classes.${name}.application`);
    if (info.baseApplication) application(info.baseApplication, `${label}.classes.${name}.baseApplication`);
    info.parameters.forEach((parameter, index) => visit(parameter, `${label}.classes.${name}.parameters[${index}]`));
    if (info.constructorRest) visit(info.constructorRest, `${label}.classes.${name}.constructorRest`);
    if (info.iterate) visit(info.iterate, `${label}.classes.${name}.iterate`);
    if (info.iterateAsync) visit(info.iterateAsync, `${label}.classes.${name}.iterateAsync`);
    for (const [field, value] of info.fields) visit(value.type, `${label}.classes.${name}.fields.${field}.type`);
    for (const [method, type] of info.methods) visit(type, `${label}.classes.${name}.methods.${method}`);
    for (const [field, value] of info.staticFields) visit(value.type, `${label}.classes.${name}.staticFields.${field}.type`);
    for (const [method, type] of info.staticMethods) visit(type, `${label}.classes.${name}.staticMethods.${method}`);
  }
}

function validateClassField(value: unknown, label: string): void {
  const field = record(value, label);
  exactKeys(field, ["mutable", "type"], label);
  if (typeof field.mutable !== "boolean") throw new Error(`${label}.mutable must be a bool`);
  validateValueType(field.type, `${label}.type`);
}

function validateExtensionDisplay(value: unknown, label: string): void {
  const display = record(value, label);
  if (display.kind === "named") {
    exactKeys(display, ["kind", "name"], label);
    nonEmptyString(display.name, `${label}.name`);
  } else if (display.kind === "constructor") {
    exactKeys(display, ["kind", "prefix", "name"], label);
    if (typeof display.prefix !== "string") throw new Error(`${label}.prefix must be a string`);
    nonEmptyString(display.name, `${label}.name`);
  } else if (display.kind === "properties") {
    exactKeys(display, ["kind", "name", "result", "hiddenOptionalProperties"], label, true);
    nonEmptyString(display.name, `${label}.name`);
    nonEmptyString(display.result, `${label}.result`);
    if (display.hiddenOptionalProperties !== undefined) stringMap(display.hiddenOptionalProperties, `${label}.hiddenOptionalProperties`, (item, itemLabel) => nonEmptyString(item, itemLabel));
  } else {
    throw new Error(`${label}.kind must be named, constructor, or properties`);
  }
}

function validatePortableData(value: unknown, label: string, depth = 0): void {
  if (depth > MAX_WIRE_DEPTH) throw new RangeError(`${label} exceeds the ABI data nesting limit`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) validatePortableData(item, `${label}[${index}]`, depth + 1);
    return;
  }
  if (value instanceof Set) {
    for (const item of value) validatePortableData(item, `${label} set value`, depth + 1);
    return;
  }
  if (value instanceof Map) {
    for (const [key, item] of value) {
      if (typeof key !== "string") throw new Error(`${label} map keys must be strings`);
      validatePortableData(item, `${label}.${key}`, depth + 1);
    }
    return;
  }
  const object = record(value, label);
  for (const [key, item] of Object.entries(object)) validatePortableData(item, `${label}.${key}`, depth + 1);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof Map || value instanceof Set) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string, optional = false): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) throw new Error(`${label} has unknown field '${unknown}'`);
  if (!optional) {
    const missing = allowed.find((key) => !Object.hasOwn(value, key));
    if (missing) throw new Error(`${label} is missing field '${missing}'`);
  }
}

function stringMap(value: unknown, label: string, validate: (item: unknown, label: string) => void): void {
  if (!(value instanceof Map) || value.size > 100_000) throw new Error(`${label} must be a bounded map`);
  for (const [key, item] of value) {
    if (typeof key !== "string" || key === "") throw new Error(`${label} keys must be non-empty strings`);
    validate(item, `${label}.${key}`);
  }
}

function stringSet(value: unknown, label: string): void {
  if (!(value instanceof Set) || value.size > 100_000 || [...value].some((item) => typeof item !== "string" || item === "")) {
    throw new Error(`${label} must be a bounded set of non-empty strings`);
  }
}

function valueTypeList(value: unknown, label: string, validate: (item: unknown, label: string) => void): void {
  if (!Array.isArray(value) || value.length > 100_000) throw new Error(`${label} must be a bounded list`);
  value.forEach((item, index) => validate(item, `${label}[${index}]`));
}

function stringList(value: unknown, label: string, allowEmpty = false): void {
  if (!Array.isArray(value) || value.length > 100_000 || value.some((item) => typeof item !== "string" || (!allowEmpty && item === ""))) {
    throw new Error(`${label} must be a bounded list of ${allowEmpty ? "strings" : "non-empty strings"}`);
  }
}

function boundList(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length > 100_000 || value.some((item) => item !== null && item !== "Comparable" && item !== "Text" && item !== "Data")) {
    throw new Error(`${label} must contain only Comparable, Text, Data, or null`);
  }
}

function stringRecord(value: unknown, label: string): void {
  const object = record(value, label);
  for (const [key, item] of Object.entries(object)) {
    if (key === "" || typeof item !== "string") throw new Error(`${label} must map non-empty strings to strings`);
  }
}

function trueFlag(value: unknown, label: string): void {
  if (value !== undefined && value !== true) throw new Error(`${label} must be true when present`);
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value === "") throw new Error(`${label} must be a non-empty string`);
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined) nonEmptyString(value, label);
}

function nonNegativeInteger(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`);
}
