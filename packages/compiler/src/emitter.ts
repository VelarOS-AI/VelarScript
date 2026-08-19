import type {
  AssignmentStatement,
  ClassDeclaration,
  BindingPattern,
  EmbeddedJavaScriptDeclaration,
  EnumDeclaration,
  Expression,
  ImportDeclaration,
  MatchPattern,
  Program,
  Statement,
  TypeAliasDeclaration,
  TestDeclaration,
  TypeDeclaration,
  TypeSyntax,
  UsingDeclaration,
  TypeReference,
} from "./ast.ts";
import { blockContainsDirectAwait, expressionContainsDirectAwait as containsDirectAwait, testFunctionName } from "./ast.ts";
import { VELAR_CLASS_FIELD_MODULE, VELAR_CLASS_FIELD_RUNTIME } from "./class-runtime.ts";
import { VELAR_COLLECTION_HOST_EXPORTS, VELAR_COLLECTION_HOST_MODULE, VELAR_COLLECTION_IDENTITY_RUNTIME, VELAR_COLLECTION_LIST_RUNTIME, VELAR_COLLECTION_RECORD_RUNTIME, VELAR_COLLECTION_SET_MAP_RUNTIME, VELAR_COLLECTION_TYPE_RUNTIME } from "./collection-runtime.ts";
import { VELAR_COLLECTION_LOWERING_EXPORTS, VELAR_COLLECTION_LOWERING_MODULE, VELAR_COLLECTION_LOWERING_RUNTIME } from "./collection-lowering-runtime.ts";
import { describeType, formatTypeReference, formatTypeSyntax, mapNestedTypes, resolveTypeReference, semanticTypeIdentity, typeContainsParameter, type BinaryStorageKind, type GenericApplication, type ValueType } from "./types.ts";
import { disposeMemberKey, iterateMemberKey, type LoweringHints } from "./analyzer.ts";
import { VELAR_ERROR_NORMALIZATION_MODULE, VELAR_ERROR_NORMALIZATION_RUNTIME, VELAR_HOST_ERROR_NAMES, VELAR_HOST_ERROR_RUNTIME } from "./error-runtime.ts";
import { embeddedJavaScriptSpecifier } from "./embedded-module.ts";
import type { CompilerEmbeddedJavaScriptModule, CompilerEmitterOptions } from "./extension.ts";
import { VELAR_NARROWING_MODULE, VELAR_NARROWING_RUNTIME } from "./narrowing-runtime.ts";
import { VELAR_NUMBER_METHOD_RUNTIME } from "./number-runtime.ts";
import { VELAR_PRIMITIVE_METHOD_MODULE } from "./primitive-runtime.ts";
import { VELAR_PROMISE_NORMALIZATION_MODULE, VELAR_PROMISE_NORMALIZATION_RUNTIME } from "./promise-runtime.ts";
import { VELAR_REACTIVE_BRIDGE_MODULE, VELAR_REACTIVE_BRIDGE_RUNTIME, VELAR_REACTIVE_COLLECTION_BRIDGE_RUNTIME } from "./reactive-bridge-runtime.ts";
import { spanIdentity, type SourceText, type Span } from "./source.ts";
import { VELAR_TEXT_METHOD_RUNTIME } from "./text-runtime.ts";
import { VELAR_TYPE_REGISTRY_RUNTIME } from "./type-registry-runtime.ts";
import {
  VELAR_RUNTIME_TYPE_COLLECTION_RUNTIME,
  VELAR_TYPE_VALIDATION_MODULE,
  VELAR_TYPE_VALIDATION_RUNTIME,
  VELAR_VALIDATION_ERROR_RUNTIME,
} from "./type-validation-runtime.ts";

interface JavaScriptNode {
  readonly id: number;
  readonly code: string;
  readonly sourceSpan: Span;
}

interface GeneratedMapping {
  readonly offset: number;
  readonly sourceSpan: Span;
}

interface PreparedEmbeddedJavaScriptModule {
  readonly statement: EmbeddedJavaScriptDeclaration;
  readonly specifier: `./${string}.js`;
  readonly factoryName: string | null;
  readonly localFactoryName: string | null;
  readonly code: string;
  readonly mappings: readonly GeneratedMapping[];
}

const javaScriptNodeMarker = /\u0000VELAR_MAP_(\d+)\u0000/gu;

// ENM-U4 + COL-U5: the compiler-raised error types are nameable in source;
// their runtime classes carry compiler-owned names. The source names are
// reserved Core bindings, so a bare reference is always the builtin.
const builtinErrorRuntimeNames: ReadonlyMap<string, string> = new Map([
  ["ValidationError", "__VelarValidationError"],
  ["NarrowingError", "__VelarNarrowingError"],
  ["IndexError", "__VelarIndexError"],
]);

export class JavaScriptEmitter {
  private readonly typeDeclarations = new Map<string, TypeDeclaration | TypeAliasDeclaration>();
  private readonly runtimeTypes = new Set<string>();
  private readonly expandedRuntimeTypes = new Set<string>();
  /**
   * D55 rule 121: the type parameters of the generic record currently being
   * emitted. Inside that body a `T`-typed position is checked by the argument
   * predicate the instantiation supplied, which is the only reading of `T` a
   * validator can have once the type is erased.
   */
  private genericTypeParameters: readonly string[] | null = null;
  /** Hoisted `function __velarTypeOf_N()` bodies for instantiations written outside a generic. */
  private readonly hoistedGenericInstances = new Map<string, string>();
  private readonly externModuleExports = new Map<string, ReadonlySet<string>>();
  private needsExternExportHelper = false;
  protected readonly hints: LoweringHints;
  private readonly forcedFunctionExports: ReadonlySet<string>;
  private readonly sharedRuntimeModules: boolean;
  private readonly requiredRuntimeModules = new Set<string>();
  private needsIndexHelpers = false;
  private needsBinaryHelpers = false;
  private needsBitwiseHelpers = false;
  private needsCollectionHelpers = false;
  private needsPrimitiveHelpers = false;
  private needsRecordHelpers = false;
  private needsObjectBindingHelpers = false;
  private needsListBindingHelpers = false;
  private needsDirectCollectionInfrastructure = false;
  private needsRuntimeTypeHelpers = false;
  private needsNumberHelper = false;
  private needsThrownValueHelper = false;
  private needsErrorCodeHelper = false;
  private readonly requiredHostErrorClasses = new Set<string>();
  private needsDetachedTaskHelper = false;
  private needsDisposalHelper = false;
  private needsIntegrityFailureHelper = false;
  private needsNarrowingErrorClass = false;
  private suppressPromiseNormalization = 0;
  private nextJavaScriptNodeId = 0;
  private readonly javaScriptNodeSpans = new Map<number, Span>();
  private generatedMappings: readonly GeneratedMapping[] = [];
  private generatedCode = "";
  private readonly sourcePath: string;
  private readonly embeddedJavaScript = new Map<EmbeddedJavaScriptDeclaration, PreparedEmbeddedJavaScriptModule>();

  constructor(hints: LoweringHints, forcedFunctionExports: ReadonlySet<string> = new Set(), options: CompilerEmitterOptions = {}) {
    this.hints = hints;
    this.forcedFunctionExports = forcedFunctionExports;
    this.sharedRuntimeModules = options.sharedRuntimeModules === true;
    this.sourcePath = options.sourcePath ?? "<source>";
  }

  emit(program: Program): string {
    this.nextJavaScriptNodeId = 0;
    this.javaScriptNodeSpans.clear();
    this.requiredRuntimeModules.clear();
    this.requiredHostErrorClasses.clear();
    this.prepareEmbeddedJavaScript(program);
    this.collectDeclarations(program);
    this.collectRuntimeUses(program);
    const statements = program.body
      .map((statement) => this.emitJavaScriptNode(statement.span, () => this.emitStatement(statement, 0)))
      .filter((item) => item.code.length > 0);

    const needsDirectCollectionInfrastructure = this.needsDirectCollectionInfrastructure
      || this.needsRecordHelpers
      || this.needsObjectBindingHelpers
      || this.needsListBindingHelpers;
    const helpers: string[] = [...this.additionalHelpers(program)];
    const builtinValues = new Set(this.hints.builtinValueReferences.values());
    if (builtinValues.has("Json")) {
      helpers.push('import * as __velarJsonNamespace from "velar/json";');
      this.requiredRuntimeModules.add("velar/json");
    }
    if (builtinValues.has("Promise")) {
      helpers.push('import * as __velarPromiseNamespace from "velar/async";');
      this.requiredRuntimeModules.add("velar/async");
    }
    if (builtinValues.has("Text")) {
      helpers.push('import * as __velarTextNamespace from "velar/text";');
      this.requiredRuntimeModules.add("velar/text");
    }
    if (builtinValues.has("Math")) {
      helpers.push('import * as __velarMathNamespace from "velar/math";');
      this.requiredRuntimeModules.add("velar/math");
    }
    if (builtinValues.has("range")) {
      helpers.push('import { range as __velarRange } from "velar/collections";');
      this.requiredRuntimeModules.add("velar/collections");
    }
    if (this.hints.nativeRangeForStatements.size > 0) {
      helpers.push('import { range as __velarCountedRangeOwner } from "velar/collections";');
      this.requiredRuntimeModules.add("velar/collections");
    }
    if (this.needsBinaryHelpers) {
      helpers.push('import { Bytes as __velarBinaryRuntime } from "velar/binary";');
      this.requiredRuntimeModules.add("velar/binary");
    }
    if (this.needsBitwiseHelpers) {
      helpers.push([
        "const __velarBitwiseApply = Reflect.apply;",
        "const __velarBitwiseNumber = Number;",
        "const __velarBitwiseNumberIsInteger = Number.isInteger;",
        "const __velarBitwiseTypeError = TypeError;",
        "const __velarBitwiseRangeError = RangeError;",
        "function __velarBitwiseOperand(value, operator) {",
        "  if (typeof value !== \"number\" || !__velarBitwiseApply(__velarBitwiseNumberIsInteger, __velarBitwiseNumber, [value])) throw new __velarBitwiseTypeError(\"Bitwise '\" + operator + \"' requires integer operands\");",
        "  if (value < -2147483648 || value > 4294967295) throw new __velarBitwiseRangeError(\"Bitwise '\" + operator + \"' requires 32-bit integer operands\");",
        "  return value;",
        "}",
        "function __velarBitwiseUnary(value) { value = __velarBitwiseOperand(value, \"~\"); return ~value; }",
        "function __velarBitwiseBinary(left, operator, right) {",
        "  left = __velarBitwiseOperand(left, operator);",
        "  if (operator === \"<<\" || operator === \">>\" || operator === \">>>\") {",
        "    if (typeof right !== \"number\" || !__velarBitwiseApply(__velarBitwiseNumberIsInteger, __velarBitwiseNumber, [right])) throw new __velarBitwiseTypeError(\"Bitwise '\" + operator + \"' requires an integer shift count\");",
        "    if (right < 0 || right > 31) throw new __velarBitwiseRangeError(\"Bitwise '\" + operator + \"' requires a shift count from 0 to 31\");",
        "    return operator === \"<<\" ? left << right : operator === \">>\" ? left >> right : left >>> right;",
        "  }",
        "  right = __velarBitwiseOperand(right, operator);",
        "  return operator === \"&\" ? left & right : operator === \"|\" ? left | right : left ^ right;",
        "}",
      ].join("\n"));
    }
    if ([...this.hints.extensionCalls.values()].includes("core.duration-arithmetic")) helpers.push([
      "const __velarDurationApply = Reflect.apply;",
      "const __velarDurationPattern = /^([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))(ms|s)$/;",
      "const __velarDurationRegExpExec = RegExp.prototype.exec;",
      "const __velarDurationNumber = Number;",
      "const __velarDurationNumberIsFinite = Number.isFinite;",
      "const __velarDurationObjectIs = Object.is;",
      "const __velarDurationString = String;",
      "const __velarDurationTypeError = TypeError;",
      "const __velarDurationRangeError = RangeError;",
      "function __velarDurationMilliseconds(value) {",
      "  if (typeof value !== \"string\") throw new __velarDurationTypeError(\"Duration arithmetic requires Duration values\");",
      "  const match = __velarDurationApply(__velarDurationRegExpExec, __velarDurationPattern, [value]);",
      "  if (!match) throw new __velarDurationTypeError(\"Duration arithmetic requires Duration values\");",
      "  const milliseconds = __velarDurationNumber(match[1]) * (match[2] === \"s\" ? 1000 : 1);",
      "  if (!__velarDurationNumberIsFinite(milliseconds)) throw new __velarDurationRangeError(\"Duration arithmetic must produce a finite value\");",
      "  return milliseconds;",
      "}",
      "function __velarDurationValue(milliseconds) {",
      "  if (!__velarDurationNumberIsFinite(milliseconds)) throw new __velarDurationRangeError(\"Duration arithmetic must produce a finite value\");",
      "  return __velarDurationString(__velarDurationObjectIs(milliseconds, -0) ? 0 : milliseconds) + \"ms\";",
      "}",
      "function __velarDurationUnary(operator, value) { const milliseconds = __velarDurationMilliseconds(value); return __velarDurationValue(operator === \"-\" ? -milliseconds : milliseconds); }",
      "function __velarDurationMath(operator, left, right) {",
      "  if (operator === \"+\" || operator === \"-\") { const a = __velarDurationMilliseconds(left), b = __velarDurationMilliseconds(right); return __velarDurationValue(operator === \"+\" ? a + b : a - b); }",
      "  if (operator === \"*\" && typeof left === \"number\") return __velarDurationValue(left * __velarDurationMilliseconds(right));",
      "  const milliseconds = __velarDurationMilliseconds(left);",
      "  if (typeof right !== \"number\" || !__velarDurationNumberIsFinite(right)) throw new __velarDurationTypeError(\"Duration scaling requires a finite number\");",
      "  if (operator === \"/\" && right === 0) throw new __velarDurationRangeError(\"Duration arithmetic cannot divide by zero\");",
      "  return __velarDurationValue(operator === \"*\" ? milliseconds * right : milliseconds / right);",
      "}",
    ].join("\n"));
    helpers.push(...this.reactiveBridgeHelpers(
      this.hints.javaScriptCallBoundaries.size > 0,
      this.sharedRuntimeModules ? needsDirectCollectionInfrastructure : this.needsCollectionHelpers,
    ));
    // Runtime imports are selected from JavaScript identifier tokens, not raw
    // substrings. Raw text produces two wrong answers: a user string such as
    // "__velarStringTrim" looks like a call, and a real
    // __velarStringReplaceAll call also looks like __velarStringReplace.
    // Generated helper names are reserved, so an identifier token is an exact
    // compiler-owned use once string/comment/template text has been skipped.
    const generatedIdentifiers = javaScriptIdentifiers([
      ...statements.map((statement) => statement.code),
      ...helpers,
    ]);
    const usesGeneratedName = (name: string): boolean => generatedIdentifiers.has(name);
    if (this.needsExternExportHelper) {
      // W-22: an extern module declaration is trusted for shapes, but the
      // declared export must actually exist. The bridge verifies presence at
      // module initialization with one property probe per imported name; a
      // declared export that legitimately holds undefined stays importable
      // because the boundary is membership in the module namespace, not the
      // value.
      helpers.push([
        "function __velarExternExport(namespace, name, source) {",
        "  const value = namespace[name];",
        "  if (value === undefined && !(name in namespace)) {",
        "    throw new TypeError(name === \"default\"",
        "      ? `Extern module '${source}' declares 'default', but the JavaScript module has no default export; declare the module's real named exports instead`",
        "      : `Extern module '${source}' declares '${name}', but the JavaScript module has no such export; prototype methods and instance members belong on a declared class or singleton const, not module exports`);",
        "  }",
        "  return value;",
        "}",
      ].join("\n"));
    }
    if (this.needsPrimitiveHelpers) {
      if (this.sharedRuntimeModules) {
        this.requiredRuntimeModules.add(VELAR_PRIMITIVE_METHOD_MODULE);
        const imports = [
          ["stringSize", "__velarStringSize"], ["stringTrim", "__velarStringTrim"], ["stringUpper", "__velarStringUpper"], ["stringLower", "__velarStringLower"],
          ["stringSlice", "__velarStringSlice"], ["stringChar", "__velarStringChar"], ["stringHas", "__velarStringHas"], ["stringIndex", "__velarStringIndex"],
          ["stringCount", "__velarStringCount"], ["stringStartsWith", "__velarStringStartsWith"], ["stringEndsWith", "__velarStringEndsWith"],
          ["stringSplit", "__velarStringSplit"], ["stringReplace", "__velarStringReplace"], ["stringReplaceAll", "__velarStringReplaceAll"],
          ["stringPadStart", "__velarStringPadStart"], ["stringPadEnd", "__velarStringPadEnd"], ["stringRepeat", "__velarStringRepeat"],
          ["stringIsBlank", "__velarStringIsBlank"], ["stringCompare", "__velarStringCompare"], ["orderCompare", "__velarOrderCompare"],
          ["numberAbs", "__velarNumberAbs"], ["numberRound", "__velarNumberRound"], ["numberFloor", "__velarNumberFloor"],
          ["numberCeil", "__velarNumberCeil"], ["numberToFixed", "__velarNumberToFixed"],
          ["numberIsInteger", "__velarNumberIsInteger"], ["numberIsNaN", "__velarNumberIsNaN"], ["numberIsFinite", "__velarNumberIsFinite"],
        ].filter(([, local]) => usesGeneratedName(local!));
        helpers.push(`import { ${imports.map(([exported, local]) => `${exported} as ${local}`).join(", ")} } from ${JSON.stringify(VELAR_PRIMITIVE_METHOD_MODULE)};`);
      } else {
        helpers.push(VELAR_TEXT_METHOD_RUNTIME);
        helpers.push(VELAR_NUMBER_METHOD_RUNTIME);
      }
    }
    if (this.hints.instanceFieldReads.size > 0 || this.hints.privateInstanceFieldReads.size > 0 || this.hints.staticFieldReads.size > 0) {
      if (this.sharedRuntimeModules) {
        this.requiredRuntimeModules.add(VELAR_CLASS_FIELD_MODULE);
        const imports = [
          ["readInstanceField", "__velarReadInstanceField"],
          ["readPrivateField", "__velarReadPrivateField"],
          ["readStaticField", "__velarReadStaticField"],
        ].filter(([, local]) => usesGeneratedName(local!));
        helpers.push(`import { ${imports.map(([exported, local]) => `${exported} as ${local}`).join(", ")} } from ${JSON.stringify(VELAR_CLASS_FIELD_MODULE)};`);
      } else {
        helpers.push(VELAR_CLASS_FIELD_RUNTIME);
      }
    }
    if (this.hints.runtimeNarrowings.size > 0 || this.needsNarrowingErrorClass) {
      if (this.sharedRuntimeModules) {
        this.requireRuntimeModule(VELAR_NARROWING_MODULE);
        const imports = [
          ...(this.hints.runtimeNarrowings.size > 0 ? ["narrow as __velarNarrow"] : []),
          ...(this.needsNarrowingErrorClass ? ["NarrowingError as __VelarNarrowingError"] : []),
        ];
        helpers.push(`import { ${imports.join(", ")} } from ${JSON.stringify(VELAR_NARROWING_MODULE)};`);
      } else {
        helpers.push(VELAR_NARROWING_RUNTIME);
      }
    }
    const needsPromiseNormalization = this.hints.normalizedPromiseValues.size > 0
      || this.hints.asyncResolvedValues.size > 0
      || this.hints.asyncForStatements.size > 0;
    if (needsPromiseNormalization) {
      if (this.sharedRuntimeModules) {
        this.requireRuntimeModule(VELAR_PROMISE_NORMALIZATION_MODULE);
        const imports = [
          ...(this.hints.normalizedPromiseValues.size > 0 || this.hints.asyncForStatements.size > 0
            ? ["normalizePromiseValue as __velarNormalizePromiseValue"]
            : []),
          ...(this.hints.asyncResolvedValues.size > 0
            ? ["asyncResolvedValue as __velarAsyncResolvedValue"]
            : []),
        ];
        helpers.push(`import { ${imports.join(", ")} } from ${JSON.stringify(VELAR_PROMISE_NORMALIZATION_MODULE)};`);
      } else {
        helpers.push(VELAR_PROMISE_NORMALIZATION_RUNTIME);
      }
    }
    if (this.hints.asyncForStatements.size > 0) {
      helpers.push([
        "const __velarAsyncPullGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;",
        "const __velarAsyncPullGetPrototypeOf = Object.getPrototypeOf;",
        "const __velarAsyncPullApply = Reflect.apply;",
        "const __velarAsyncPullArguments = [];",
        "const __velarAsyncPullTypeError = TypeError;",
        // Class methods live on the prototype (charter section 18), so the
        // capture walks the chain with descriptor reads. The first level that
        // declares 'next' decides: only a data-valued function is accepted,
        // and an accessor is rejected without ever being invoked.
        "function __velarAsyncPullNext(source) {",
        "  if ((typeof source !== \"object\" && typeof source !== \"function\") || source === null) {",
        "    throw new __velarAsyncPullTypeError(\"async for requires a data-valued next method\");",
        "  }",
        "  for (let owner = source; owner !== null; owner = __velarAsyncPullGetPrototypeOf(owner)) {",
        "    const descriptor = __velarAsyncPullGetOwnPropertyDescriptor(owner, \"next\");",
        "    if (!descriptor) continue;",
        "    if (!(\"value\" in descriptor) || typeof descriptor.value !== \"function\") {",
        "      throw new __velarAsyncPullTypeError(\"async for requires a data-valued next method\");",
        "    }",
        "    return descriptor.value;",
        "  }",
        "  throw new __velarAsyncPullTypeError(\"async for requires a data-valued next method\");",
        "}",
        "function __velarAsyncPullCall(source, next) {",
        "  return __velarAsyncPullApply(next, source, __velarAsyncPullArguments);",
        "}",
      ].join("\n"));
    }
    if (this.needsDetachedTaskHelper) {
      helpers.push(...this.detachedTaskHelpers());
    }
    if (this.needsDisposalHelper) {
      helpers.push(...this.disposalHelpers());
    }
    if (this.needsIntegrityFailureHelper) {
      helpers.push(...this.integrityFailureHelpers());
    }
    const needsErrorNormalizationRuntime = this.needsThrownValueHelper || this.needsErrorCodeHelper;
    if (needsErrorNormalizationRuntime && !this.includesErrorNormalizationRuntime()) {
      if (this.sharedRuntimeModules) {
        this.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE);
        const imports = [
          ...(this.needsErrorCodeHelper ? ["errorCode as __velarErrorCode"] : []),
          ...(this.needsThrownValueHelper ? ["normalizeError as __velarNormalizeError"] : []),
        ];
        helpers.push(`import { ${imports.join(", ")} } from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)};`);
      } else {
        helpers.push(VELAR_ERROR_NORMALIZATION_RUNTIME);
      }
    }
    // D50 rule 89: a named capability error is a leaf class the compiler owns,
    // so a source reference resolves to the one runtime class every capability
    // constructs — the same wiring the three compiler-raised errors use.
    if (this.requiredHostErrorClasses.size > 0) {
      const imports = [...this.requiredHostErrorClasses].sort().map((name) => `${name} as __Velar${name}`);
      if (this.sharedRuntimeModules) {
        this.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE);
        helpers.push(`import { ${imports.join(", ")} } from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)};`);
      } else {
        helpers.push(VELAR_HOST_ERROR_RUNTIME);
      }
    }
    const needsRuntimeTypeRuntime = this.needsRuntimeTypeHelpers || this.runtimeTypes.size > 0
      || program.body.some((statement) => statement.kind === "EnumDeclaration");
    if (needsDirectCollectionInfrastructure && this.sharedRuntimeModules) {
      this.requireRuntimeModule(VELAR_COLLECTION_HOST_MODULE);
      helpers.push([
        "import {",
        ...VELAR_COLLECTION_HOST_EXPORTS.map((name) => `  ${name},`),
        `} from ${JSON.stringify(VELAR_COLLECTION_HOST_MODULE)};`,
      ].join("\n"));
    } else if (!this.sharedRuntimeModules && (this.needsCollectionHelpers || needsRuntimeTypeRuntime)) {
      helpers.push(VELAR_COLLECTION_IDENTITY_RUNTIME);
    }
    if (needsRuntimeTypeRuntime) {
      if (this.sharedRuntimeModules) {
        this.requireRuntimeModule(VELAR_TYPE_VALIDATION_MODULE);
        const imports = [
          ["registerRuntimeType", "__velarRegisterRuntimeType"], ["ValidationError", "__VelarValidationError"],
          ["validationState", "__velarValidationState"], ["validationSet", "__velarValidationSet"],
          ["validationWeakMapGet", "__velarValidationWeakMapGet"], ["validationWeakMapSet", "__velarValidationWeakMapSet"], ["validationWeakMapDelete", "__velarValidationWeakMapDelete"],
          ["validationSetHas", "__velarValidationSetHas"], ["validationSetAdd", "__velarValidationSetAdd"], ["validationSetDelete", "__velarValidationSetDelete"], ["validationSetSize", "__velarValidationSetSize"],
          ["validationIsArray", "__velarValidationIsArray"], ["validationOwnDescriptor", "__velarValidationOwnDescriptor"],
          ["validationIsInstance", "__velarValidationIsInstance"], ["validationIsPromise", "__velarValidationIsPromise"],
          ["validationIsPlainObject", "__velarValidationIsPlainObject"], ["validationRejectionHint", "__velarValidationRejectionHint"],
          ["validationFreeze", "__velarValidationFreeze"],
          ["listTypeIs", "__velarListTypeIs"], ["setTypeIs", "__velarSetTypeIs"], ["mapTypeIs", "__velarMapTypeIs"], ["recordTypeIs", "__velarRecordTypeIs"],
        ].filter(([, local]) => usesGeneratedName(local!));
        helpers.push(`import { ${imports.map(([exported, local]) => `${exported} as ${local}`).join(", ")} } from ${JSON.stringify(VELAR_TYPE_VALIDATION_MODULE)};`);
      } else {
        helpers.push(VELAR_COLLECTION_TYPE_RUNTIME);
        helpers.push(VELAR_TYPE_REGISTRY_RUNTIME);
        helpers.push(VELAR_TYPE_VALIDATION_RUNTIME);
        helpers.push(VELAR_RUNTIME_TYPE_COLLECTION_RUNTIME);
        helpers.push(VELAR_VALIDATION_ERROR_RUNTIME);
      }
    }
    if (this.needsCollectionHelpers) {
      if (this.sharedRuntimeModules) {
        this.requireRuntimeModule(VELAR_COLLECTION_LOWERING_MODULE);
        const imports = VELAR_COLLECTION_LOWERING_EXPORTS.filter((name) => usesGeneratedName(name)
          || (this.needsListBindingHelpers && name === "__velarValidateDenseList"));
        helpers.push([
          "import {",
          ...imports.map((name) => `  ${name},`),
          `} from ${JSON.stringify(VELAR_COLLECTION_LOWERING_MODULE)};`,
        ].join("\n"));
      } else {
        helpers.push(VELAR_COLLECTION_LIST_RUNTIME);
        helpers.push(VELAR_COLLECTION_SET_MAP_RUNTIME);
        helpers.push(VELAR_COLLECTION_RECORD_RUNTIME);
        helpers.push(VELAR_COLLECTION_LOWERING_RUNTIME);
      }
    }
    if (this.needsRecordHelpers) {
      helpers.push([
        "const __velarMaxRecordFields = 1000000;",
        "",
        "function __velarSetRecordField(output, field, value, count) {",
        "  const present = __velarCollectionRecordGetOwnPropertyDescriptor(output, field) !== undefined;",
        "  if (!present && count >= __velarMaxRecordFields) throw new __velarCollectionRecordNativeRangeError(\"A record cannot exceed 1000000 fields\");",
        "  __velarCollectionRecordDefineProperty(output, field, { value: value ?? null, writable: true, enumerable: true, configurable: true });",
        "  return present ? count : count + 1;",
        "}",
        "function __velarSpreadRecord(output, value, count) {",
        "  if (value === null || typeof value !== \"object\" || __velarCollectionListIsArray(value)) throw new __velarCollectionNativeTypeError(\"Object spread requires a record object\");",
        "  if (__velarCollectionRecordOwnSymbols(value).length > 0) throw new __velarCollectionNativeTypeError(\"Object spread cannot copy symbol fields\");",
        "  __velarReactiveCollectionTrack(value);",
        "  const fields = __velarCollectionRecordOwnNames(value);",
        "  if (fields.length > __velarMaxRecordFields) throw new __velarCollectionRecordNativeRangeError(\"Object spread cannot inspect more than 1000000 fields\");",
        "  for (let index = 0; index < fields.length; index += 1) {",
        "    const field = fields[index];",
        "    const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, field);",
        "    if (!descriptor) throw new __velarCollectionNativeTypeError(\"Object spread source changed while it was being copied\");",
        "    if (!descriptor.enumerable) continue;",
        "    if (!(\"value\" in descriptor)) throw new __velarCollectionNativeTypeError(\"Object spread cannot copy accessor field '\" + field + \"'\");",
        "    count = __velarSetRecordField(output, field, __velarReactiveCollectionRead(value, field, descriptor.value), count);",
        "  }",
        "  return count;",
        "}",
        "function __velarCreateRecord(parts) {",
        "  const output = {};",
        "  let count = 0;",
        "  for (let index = 0; index < parts.length; index += 1) {",
        "    const spread = parts[index][0];",
        "    const field = parts[index][1];",
        "    const read = parts[index][2];",
        "    if (spread) count = __velarSpreadRecord(output, read(), count);",
        "    else {",
        "      count = __velarSetRecordField(output, field, read(), count);",
        "    }",
        "  }",
        "  return output;",
        "}",
        "async function __velarCreateRecordAsync(parts) {",
        "  const output = {};",
        "  let count = 0;",
        "  for (let index = 0; index < parts.length; index += 1) {",
        "    const spread = parts[index][0];",
        "    const field = parts[index][1];",
        "    const asynchronous = parts[index][2];",
        "    const read = parts[index][3];",
        "    if (spread) count = __velarSpreadRecord(output, asynchronous ? await read() : read(), count);",
        "    else {",
        "      count = __velarSetRecordField(output, field, asynchronous ? await read() : read(), count);",
        "    }",
        "  }",
        "  return output;",
        "}",
      ].join("\n"));
    }
    if (this.needsObjectBindingHelpers) {
      helpers.push([
        "const __velarMaxBindingFields = 1000000;",
        "",
        "function __velarRequireBindingObject(value, name) {",
        "  if (value === null || typeof value !== \"object\" || __velarCollectionListIsArray(value)) throw new __velarCollectionNativeTypeError(name + \" object binding requires a record object\");",
        "  return value;",
        "}",
        "function __velarReadBindingField(value, field, optional, name) {",
        "  __velarReactiveCollectionTrack(value, field);",
        "  const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, field);",
        "  if (descriptor === undefined) {",
        "    if (optional) return null;",
        "    throw new __velarCollectionNativeTypeError(name + \" object binding requires own data field '\" + field + \"'\");",
        "  }",
        "  if (!descriptor.enumerable || !(\"value\" in descriptor)) throw new __velarCollectionNativeTypeError(name + \" object binding requires enumerable data field '\" + field + \"'\");",
        "  return __velarReactiveCollectionRead(value, field, descriptor.value) ?? null;",
        "}",
        "function __velarBindingObjectRest(value, excluded, name) {",
        "  if (__velarCollectionRecordOwnSymbols(value).length > 0) throw new __velarCollectionNativeTypeError(name + \" object rest cannot copy symbol fields\");",
        "  __velarReactiveCollectionTrack(value);",
        "  const fields = __velarCollectionRecordOwnNames(value);",
        "  if (fields.length > __velarMaxBindingFields) throw new __velarCollectionRecordNativeRangeError(name + \" object rest cannot copy more than 1000000 fields\");",
        "  const output = {};",
        "  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {",
        "    const field = fields[fieldIndex];",
        "    let selected = false;",
        "    for (let index = 0; index < excluded.length; index += 1) if (excluded[index] === field) { selected = true; break; }",
        "    if (selected) continue;",
        "    const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, field);",
        "    if (!descriptor?.enumerable) continue;",
        "    if (!(\"value\" in descriptor)) throw new __velarCollectionNativeTypeError(name + \" object rest cannot copy accessor field '\" + field + \"'\");",
        "    __velarCollectionRecordDefineProperty(output, field, { value: __velarReactiveCollectionRead(value, field, descriptor.value) ?? null, writable: true, enumerable: true, configurable: true });",
        "  }",
        "  return output;",
        "}",
      ].join("\n"));
    }
    if (this.needsListBindingHelpers) {
      helpers.push([
        "function __velarRequireBindingList(value, size, hasRest, name) {",
        "  __velarValidateDenseList(value, name + \" List binding\");",
        "  __velarReactiveCollectionTrack(value);",
        "  const valid = hasRest ? value.length >= size : value.length === size;",
        "  if (!valid) throw new __velarCollectionListNativeRangeError(name + \" List binding\" + (hasRest ? \" requires at least \" : \" requires exactly \") + size + (size === 1 ? \" item\" : \" items\") + \", received \" + value.length);",
        "  return value;",
        "}",
        "function __velarReadBindingListItem(value, index) {",
        "  return __velarReactiveCollectionRead(value, index, __velarCollectionListGetOwnPropertyDescriptor(value, index).value) ?? null;",
        "}",
        "function __velarBindingListRest(value, start) {",
        "  const output = new __velarCollectionNativeArray(value.length - start);",
        "  for (let index = start; index < value.length; index += 1) output[index - start] = __velarReactiveCollectionRead(value, index, __velarCollectionListGetOwnPropertyDescriptor(value, index).value) ?? null;",
        "  return output;",
        "}",
      ].join("\n"));
    }
    if (this.needsNumberHelper) {
      helpers.push([
        "function __velarNumber(value) {",
        "  if (typeof value !== \"string\") throw new TypeError(\"number(text) requires a string\");",
        "  const text = value.trim();",
        "  if (!/^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?$/u.test(text)) return null;",
        "  const parsed = Number(text);",
        "  return Number.isFinite(parsed) ? parsed : null;",
        "}",
      ].join("\n"));
    }

    // D55 rule 121: one memoized accessor per instantiation written outside a
    // generic body. They are `function` declarations so that
    // `type Boxed = Box<string>` above the declaration of `Box` still reads a
    // hoisted name instead of a `const` in its temporal dead zone.
    const instances = [...this.hoistedGenericInstances].map(([expression, name]) => `function ${name}() {\n  return ${expression};\n}`);
    const chunks: readonly { readonly code: string; readonly mappings: readonly GeneratedMapping[] }[] = [
      ...helpers.map((code) => ({ code, mappings: [] })),
      ...instances.map((code) => ({ code, mappings: [] })),
      ...statements.map((node) => this.renderJavaScriptNode(node)),
    ];
    let output = "";
    const mappings: GeneratedMapping[] = [];
    for (const chunk of chunks) {
      if (output.length > 0) output += "\n\n";
      const offset = output.length;
      output += chunk.code;
      mappings.push(...chunk.mappings.map((mapping) => ({ ...mapping, offset: offset + mapping.offset })));
    }
    this.generatedCode = `${output}${output.length > 0 ? "\n" : ""}`;
    this.generatedMappings = mappings.sort((left, right) => left.offset - right.offset);
    return this.generatedCode;
  }

  sourceMap(source: SourceText): string {
    return sourceMapFor(this.generatedCode, this.generatedMappings, source);
  }

  embeddedModules(source: SourceText): readonly CompilerEmbeddedJavaScriptModule[] {
    return [...this.embeddedJavaScript.values()].map((module) => ({
      specifier: module.specifier,
      code: module.code,
      sourceMap: sourceMapFor(module.code, module.mappings, source),
      sourceSpan: module.statement.sourceSpan,
    }));
  }

  runtimeModules(): readonly string[] {
    return [...this.requiredRuntimeModules].sort();
  }

  private emitJavaScriptNode(sourceSpan: Span, render: () => string): JavaScriptNode {
    const node = { id: this.nextJavaScriptNodeId++, code: render(), sourceSpan } satisfies JavaScriptNode;
    this.javaScriptNodeSpans.set(node.id, sourceSpan);
    return node;
  }

  private markJavaScriptNode(node: JavaScriptNode): string {
    return node.code.length === 0 ? "" : `\u0000VELAR_MAP_${node.id}\u0000${node.code}`;
  }

  protected emitMappedJavaScript(sourceSpan: Span, render: () => string): string {
    return this.markJavaScriptNode(this.emitJavaScriptNode(sourceSpan, render));
  }

  private renderJavaScriptNode(node: JavaScriptNode): { readonly code: string; readonly mappings: readonly GeneratedMapping[] } {
    let code = "";
    let cursor = 0;
    const mappings: GeneratedMapping[] = [{ offset: 0, sourceSpan: node.sourceSpan }];
    for (const marker of node.code.matchAll(javaScriptNodeMarker)) {
      const markerIndex = marker.index;
      code += node.code.slice(cursor, markerIndex);
      const sourceSpan = this.javaScriptNodeSpans.get(Number(marker[1]));
      if (!sourceSpan) throw new Error("A generated JavaScript mapping marker has no source node");
      mappings.push({ offset: code.length, sourceSpan });
      cursor = markerIndex + marker[0].length;
    }
    code += node.code.slice(cursor);
    return { code, mappings };
  }

  protected additionalHelpers(_program: Program): readonly string[] {
    return [];
  }

  protected reactiveBridgeHelpers(needsJavaScriptCallBoundary: boolean, needsCollections: boolean): readonly string[] {
    if (!needsJavaScriptCallBoundary && !needsCollections) return [];
    if (this.sharedRuntimeModules) {
      this.requiredRuntimeModules.add(VELAR_REACTIVE_BRIDGE_MODULE);
      const imports = [
        "reactiveRaw as __velarReactiveRaw",
        "hostRaw as __velarHostRaw",
        ...(needsCollections ? [
          "reactiveIterateKey as __velarReactiveIterateKey",
          "reactiveStructureKey as __velarReactiveStructureKey",
          "reactiveCollectionRead as __velarReactiveCollectionRead",
          "reactiveCollectionTrack as __velarReactiveCollectionTrack",
          "reactiveCollectionLink as __velarReactiveCollectionLink",
          "reactiveCollectionTrigger as __velarReactiveCollectionTrigger",
          "reactiveCollectionUnlink as __velarReactiveCollectionUnlink",
        ] : []),
      ];
      return [`import { ${imports.join(", ")} } from ${JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE)};`];
    }
    return [VELAR_REACTIVE_BRIDGE_RUNTIME, ...(needsCollections ? [VELAR_REACTIVE_COLLECTION_BRIDGE_RUNTIME] : [])];
  }

  protected usesSharedRuntimeModules(): boolean {
    return this.sharedRuntimeModules;
  }

  // The compiler-owned observer behind the 'async <expression>' statement
  // (docs/contributing/runtime-boundary.md, B-DETACHED-ASYNC). The Promise and Reflect
  // operations and the console channel are captured at module initialization;
  // rejection is normalized to Error and reported on the host error channel
  // without ending the process. Hosts with their own error chain override
  // this (the Web emitter routes the report through the velar/app chain).
  //
  // The reporter itself must never fail outward: a rejection value carries a
  // foreign error object whose 'stack' or 'message' may be a throwing getter,
  // and a throw inside a rejection handler becomes an unhandled rejection that
  // ends the Node process — the exact program termination this boundary
  // forbids. Every foreign read is therefore guarded, and the Promise derived
  // from adopting the task is observed rather than discarded.
  protected detachedTaskHelpers(): readonly string[] {
    return [[
      "const __velarDetachedPromiseThen = globalThis.Promise.prototype.then;",
      "const __velarDetachedApply = Reflect.apply;",
      "const __velarDetachedConsole = globalThis.console;",
      "const __velarDetachedConsoleError = __velarDetachedConsole ? __velarDetachedConsole.error : null;",
      "function __velarDetachedTrace(error) {",
      "  try { const trace = error.stack; if (typeof trace === \"string\" && trace !== \"\") return trace; } catch {}",
      "  try { const message = error.message; if (typeof message === \"string\" && message !== \"\") return message; } catch {}",
      "  return \"A detached task failed\";",
      "}",
      "function __velarDetachedReport(failure) {",
      "  try {",
      "    if (typeof __velarDetachedConsoleError !== \"function\") return null;",
      "    let error = null;",
      "    try { error = __velarNormalizeError(failure); } catch {}",
      "    const trace = error === null ? \"A detached task failed\" : __velarDetachedTrace(error);",
      "    __velarDetachedApply(__velarDetachedConsoleError, __velarDetachedConsole, [\"Detached async task failed: \" + trace]);",
      "  } catch {}",
      "  return null;",
      "}",
      "function __velarDetachedTask(task) {",
      "  try {",
      "    const observed = __velarDetachedApply(__velarDetachedPromiseThen, task, [null, __velarDetachedReport]);",
      "    __velarDetachedApply(__velarDetachedPromiseThen, observed, [null, __velarDetachedReport]);",
      "  } catch (failure) {",
      "    __velarDetachedReport(failure);",
      "  }",
      "  return null;",
      "}",
    ].join("\n")];
  }

  /**
   * D43 item 69 rule 8: a release that fails while an error is already in
   * flight must not replace it. The original error keeps the throw; the release
   * failure is normalized and reported through the host channel. The reporter
   * itself never fails outward, for the same reason the detached-task reporter
   * does not — a throw inside it would end the process.
   */
  protected disposalHelpers(): readonly string[] {
    return [[
      "const __velarDisposalApply = Reflect.apply;",
      "const __velarDisposalConsole = globalThis.console;",
      "const __velarDisposalConsoleError = __velarDisposalConsole ? __velarDisposalConsole.error : null;",
      "function __velarDisposalTrace(error) {",
      "  try { const trace = error.stack; if (typeof trace === \"string\" && trace !== \"\") return trace; } catch {}",
      "  try { const message = error.message; if (typeof message === \"string\" && message !== \"\") return message; } catch {}",
      "  return \"A resource release failed\";",
      "}",
      "function __velarDisposalReport(failure) {",
      "  try {",
      "    if (typeof __velarDisposalConsoleError !== \"function\") return null;",
      "    let error = null;",
      "    try { error = __velarNormalizeError(failure); } catch {}",
      "    const trace = error === null ? \"A resource release failed\" : __velarDisposalTrace(error);",
      "    __velarDisposalApply(__velarDisposalConsoleError, __velarDisposalConsole, [\"Resource release failed while another error was in flight: \" + trace]);",
      "  } catch {}",
      "  return null;",
      "}",
    ].join("\n")];
  }

  /**
   * D51 rule 103: the three failures that mean "this program has a bug", by the
   * one name each of them stamps on itself. A forged name can only make a
   * failure propagate instead of becoming `null`, which is the safe direction:
   * `try` never hides a guard, and `catch` still receives everything.
   */
  protected integrityFailureHelpers(): readonly string[] {
    return [[
      "const __velarIntegrityDescriptor = Object.getOwnPropertyDescriptor;",
      "function __velarIsIntegrityFailure(value) {",
      "  if (value === null || (typeof value !== \"object\" && typeof value !== \"function\")) return false;",
      "  const descriptor = __velarIntegrityDescriptor(value, \"name\");",
      "  if (!descriptor || !(\"value\" in descriptor)) return false;",
      "  const name = descriptor.value;",
      "  return name === \"AssertionError\" || name === \"NarrowingError\" || name === \"IndexError\";",
      "}",
    ].join("\n")];
  }

  protected requireRuntimeModule(source: string): void {
    this.requiredRuntimeModules.add(source);
  }

  protected includesErrorNormalizationRuntime(): boolean {
    return false;
  }

  protected visitExtensionRuntimeExpression(_expression: Expression, _visitExpression: (expression: Expression) => void): boolean {
    return false;
  }

  protected visitExtensionRuntimeStatement(
    _statement: Statement,
    _visitExpression: (expression: Expression) => void,
    _visitStatement: (statement: Statement) => void,
  ): boolean {
    return false;
  }

  protected extensionExpressionContainsDirectAwait(
    _expression: Expression,
    _contains: (expression: Expression) => boolean,
  ): boolean | undefined {
    return undefined;
  }

  protected extensionStatementContainsDirectAwait(
    _statement: Statement,
    _containsExpression: (expression: Expression) => boolean,
    _containsBlock: (statements: readonly Statement[]) => boolean,
  ): boolean | undefined {
    return undefined;
  }

  private collectDeclarations(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind === "TypeDeclaration" || statement.kind === "TypeAliasDeclaration") {
        this.typeDeclarations.set(statement.name, statement);
        if (statement.exported) {
          this.runtimeTypes.add(statement.name);
        }
      } else if (statement.kind === "ExternModuleDeclaration") {
        const names = new Set(this.externModuleExports.get(statement.source));
        for (const declaration of statement.functions) names.add(declaration.name);
        for (const declaration of statement.constants) names.add(declaration.name);
        for (const declaration of statement.classes) names.add(declaration.name);
        this.externModuleExports.set(statement.source, names);
      }
    }
    for (const name of [...this.runtimeTypes]) {
      this.markRuntimeType({ kind: "named", name });
    }
  }

  private collectRuntimeUses(program: Program): void {
    for (const guard of this.hints.runtimeNarrowings.values()) this.markRuntimeNarrowingType(guard.expected);
    const visitExpression = (expression: Expression): void => {
      if (this.visitExtensionRuntimeExpression(expression, visitExpression)) return;
      switch (expression.kind) {
        case "FStringExpression":
          for (const part of expression.parts) {
            if (part.kind === "expression") visitExpression(part.value);
          }
          break;
        case "ListExpression":
          expression.elements.forEach(visitExpression);
          break;
        case "ObjectExpression":
          expression.properties.forEach((property) => visitExpression(property.value));
          break;
        case "SpreadExpression":
          visitExpression(expression.value);
          break;
        case "UnaryExpression":
          visitExpression(expression.operand);
          break;
        case "TryExpression":
          visitExpression(expression.value);
          break;
        case "BinaryExpression":
          visitExpression(expression.left);
          visitExpression(expression.right);
          break;
        case "ComparisonChainExpression":
          expression.operands.forEach(visitExpression);
          break;
        case "ConditionalExpression":
          visitExpression(expression.condition);
          visitExpression(expression.thenValue);
          visitExpression(expression.elseValue);
          break;
        case "IsExpression":
          this.markRuntimeType(resolveTypeReference(expression.type));
          visitExpression(expression.value);
          break;
        case "ArrowFunctionExpression":
          visitExpression(expression.body);
          break;
        case "CallExpression":
          if (expression.callee.kind === "MemberExpression"
            && expression.callee.object.kind === "IdentifierExpression"
            && expression.callee.property === "parse"
            && this.typeDeclarations.has(expression.callee.object.name)) {
            this.markRuntimeType({ kind: "named", name: expression.callee.object.name });
          }
          if (expression.callee.kind === "MemberExpression"
            && this.collectionHelper(expression.callee)) {
            this.needsCollectionHelpers = true;
          }
          if (expression.callee.kind === "MemberExpression"
            && this.binaryHelper(expression.callee)) {
            this.needsBinaryHelpers = true;
          }
          visitExpression(expression.callee);
          expression.arguments.forEach(visitExpression);
          break;
        case "MemberExpression":
          if (this.binaryHelper(expression) || this.hints.binarySizes.has(expression.span.end)) {
            this.needsBinaryHelpers = true;
          }
          visitExpression(expression.object);
          break;
        case "IndexExpression":
          if (this.hints.binaryIndexes.has(spanIdentity(expression.span))) this.needsBinaryHelpers = true;
          else this.needsIndexHelpers = true;
          visitExpression(expression.object);
          visitExpression(expression.index);
          break;
        case "LiteralExpression":
          break;
        case "IdentifierExpression":
          if (this.typeDeclarations.has(expression.name)) {
            this.markRuntimeType({ kind: "named", name: expression.name });
          }
          break;
        case "SuperExpression":
        case "DynamicImportExpression":
          break;
      }
    };

    const visitStatement = (statement: Statement): void => {
      if (this.visitExtensionRuntimeStatement(statement, visitExpression, visitStatement)) return;
      switch (statement.kind) {
        case "VariableDeclaration": visitExpression(statement.initializer); break;
        case "TestDeclaration": statement.body.forEach(visitStatement); break;
        case "UsingDeclaration":
          // Releasing a resource reports its own failure through the host
          // channel, which carries the error-normalization runtime with it.
          this.needsDisposalHelper = true;
          this.needsThrownValueHelper = true;
          visitExpression(statement.initializer);
          break;
        case "FunctionDeclaration": statement.parameters.forEach((parameter) => { if (parameter.defaultValue) visitExpression(parameter.defaultValue); }); statement.body.forEach(visitStatement); break;
        case "ClassDeclaration":
          statement.parameters.forEach((parameter) => { if (parameter.defaultValue) visitExpression(parameter.defaultValue); });
          statement.base?.arguments.forEach(visitExpression);
          statement.fields.forEach((field) => { if (field.initializer) visitExpression(field.initializer); });
          statement.initialization?.body.forEach(visitStatement);
          statement.getters.forEach(visitStatement);
          statement.methods.forEach(visitStatement);
          statement.dispose?.body.forEach(visitStatement);
          statement.iterate?.body.forEach(visitStatement);
          break;
        case "ReturnStatement": if (statement.value) visitExpression(statement.value); break;
        case "ThrowStatement": visitExpression(statement.value); break;
        case "AssertStatement": visitExpression(statement.condition); if (statement.message) visitExpression(statement.message); break;
        case "IfStatement": visitExpression(statement.condition); statement.thenBody.forEach(visitStatement); statement.elseBody?.forEach(visitStatement); break;
        case "MatchStatement":
          visitExpression(statement.value);
          statement.cases.forEach((branch) => {
            visitMatchPattern(branch.pattern);
            if (branch.guard) visitExpression(branch.guard);
            branch.body.forEach(visitStatement);
          });
          break;
        case "ForStatement": visitExpression(statement.iterable); statement.body.forEach(visitStatement); break;
        case "WhileStatement": visitExpression(statement.condition); statement.body.forEach(visitStatement); break;
        case "TryStatement": statement.tryBody.forEach(visitStatement); statement.catchBody?.forEach(visitStatement); statement.finallyBody?.forEach(visitStatement); break;
        case "AssignmentStatement": visitExpression(statement.target); visitExpression(statement.value); break;
        case "ExpressionStatement": visitExpression(statement.expression); break;
        case "AsyncStatement":
          // The detached-task observer normalizes rejection values, so the
          // error-normalization runtime travels with it.
          this.needsDetachedTaskHelper = true;
          this.needsThrownValueHelper = true;
          visitExpression(statement.expression);
          break;
        case "EmbeddedJavaScriptDeclaration":
          statement.captures.forEach((capture) => visitExpression({
            kind: "IdentifierExpression",
            name: capture.name,
            span: capture.nameSpan,
          }));
          break;
        case "ImportDeclaration":
        case "ReExportDeclaration":
        case "ExternModuleDeclaration":
        case "TypeDeclaration":
        case "TypeAliasDeclaration":
        case "EnumDeclaration":
        case "BreakStatement":
        case "ContinueStatement":
        case "PassStatement":
          break;
      }
    };

    const visitMatchPattern = (pattern: MatchPattern): void => {
      switch (pattern.kind) {
        case "MatchValuePattern": pattern.values.forEach(visitExpression); break;
        case "MatchTypePattern": this.markRuntimeType(resolveTypeReference(pattern.type)); break;
        case "MatchAsPattern": visitMatchPattern(pattern.pattern); break;
        case "MatchObjectPattern": pattern.entries.forEach((entry) => visitMatchPattern(entry.pattern)); break;
        case "MatchListPattern": pattern.elements.forEach(visitMatchPattern); break;
        case "MatchWildcardPattern":
        case "MatchCapturePattern":
          break;
      }
    };

    program.body.forEach(visitStatement);
  }

  private markRuntimeType(type: ValueType): void {
    this.needsRuntimeTypeHelpers = true;
    const visit = (value: ValueType): void => {
      // D55 rule 121: `Box<string>` needs `Box`'s factory emitted and every
      // argument's own runtime types marked; the application's display name is
      // not a declaration, so the walk asks the application which one it is.
      if (value.kind === "named" && value.application) {
        for (const argument of value.application.arguments) visit(argument);
        visit({ kind: "named", name: value.application.name });
        return;
      }
      if (value.kind === "named" && this.typeDeclarations.has(value.name) && !this.runtimeTypes.has(value.name)) {
        this.runtimeTypes.add(value.name);
      }
      if (value.kind === "named" && this.typeDeclarations.has(value.name) && !this.expandedRuntimeTypes.has(value.name)) {
        this.expandedRuntimeTypes.add(value.name);
        const declaration = this.typeDeclarations.get(value.name)!;
        if (declaration.kind === "TypeDeclaration") {
          const complete = this.hints.typeDeclarationFields.get(declaration.span.start);
          const ownNames = new Set(declaration.fields.map((field) => field.name));
          // A field written in this module must retain the local spelling that
          // owns its runtime Type binding. The analyzer's complete structural
          // table expands aliases for static work; walking that expansion here
          // can lose the only imported/local validator name before emission.
          declaration.fields.forEach((field) => visit(resolveTypeReference(field.type)));
          complete?.filter((field) => !ownNames.has(field.name)).forEach((field) => visit(field.type));
        } else {
          visit(resolveTypeReference(declaration.target));
        }
      } else if (value.kind === "optional") {
        visit(value.inner);
      } else if (value.kind === "list") {
        visit(value.element);
      } else if (value.kind === "set") {
        visit(value.element);
      } else if (value.kind === "map") {
        visit(value.key);
        visit(value.value);
      } else if (value.kind === "record") {
        visit(value.value);
      } else if (value.kind === "promise") {
        visit(value.value);
      } else if (value.kind === "union") {
        value.members.forEach(visit);
      }
    };
    visit(type);
  }

  private markRuntimeNarrowingType(type: ValueType): void {
    if (type.kind === "optional") {
      this.markRuntimeNarrowingType(type.inner);
      return;
    }
    if (type.kind === "union") {
      for (const member of type.members) this.markRuntimeNarrowingType(member);
      return;
    }
    if (type.kind === "list" || type.kind === "set" || type.kind === "map" || type.kind === "record"
      || type.kind === "promise" || type.kind === "named" || type.kind === "class") {
      this.markRuntimeType(type);
    }
  }

  protected emitMappedStatement(statement: Statement, depth: number): string {
    return this.emitMappedJavaScript(statement.span, () => this.emitStatement(statement, depth));
  }

  /**
   * D43 item 69: a `using` binding owns the rest of its block, so a statement
   * list is emitted as a whole. Everything after the binding moves inside the
   * release frame; a second `using` nests inside the first, which is what makes
   * release order the reverse of declaration order.
   */
  protected emitStatementLines(statements: readonly Statement[], depth: number): readonly string[] {
    const owned = statements.findIndex((statement) => statement.kind === "UsingDeclaration");
    const plain = (values: readonly Statement[]): string[] =>
      values.map((child) => this.emitMappedStatement(child, depth)).filter(Boolean);
    if (owned < 0) return plain(statements);
    return [
      ...plain(statements.slice(0, owned)),
      ...this.emitUsingScope(statements[owned] as UsingDeclaration, statements.slice(owned + 1), depth),
    ];
  }

  private emitUsingScope(statement: UsingDeclaration, rest: readonly Statement[], depth: number): readonly string[] {
    const indentation = "  ".repeat(depth);
    const contract = this.hints.usingDisposals.get(spanIdentity(statement.span));
    const initializer = this.emitMappedJavaScript(statement.span, () => `const ${statement.name} = ${this.emitMappedExpression(statement.initializer)};`);
    // A value with no resolved contract was already diagnosed; emitting the
    // binding alone keeps the rest of the block readable in a failed compile.
    if (!contract) return [`${indentation}${initializer}`, ...this.emitStatementLines(rest, depth)];
    const body = this.emitStatementLines(rest, depth + 1);
    this.needsDisposalHelper = true;
    const suffix = statement.span.start;
    const member = contract.owner === "class" ? `[${JSON.stringify(contract.member)}]` : `.${contract.member}`;
    const call = `${contract.asynchronous ? "await " : ""}${statement.name}${member}()`;
    const released = `__velarReleased${suffix}`;
    const failure = `__velarUsingFailure${suffix}`;
    return [
      `${indentation}${initializer}`,
      `${indentation}let ${released} = false;`,
      `${indentation}try {`,
      ...body,
      // An error already in flight owns the failure: the release still runs,
      // but its own failure is reported to the host instead of replacing the
      // error the author is about to see (D43 item 69 rule 8).
      `${indentation}} catch (${failure}) {`,
      `${indentation}  ${released} = true;`,
      `${indentation}  try { ${call}; } catch (__velarDisposeFailure${suffix}) { __velarDisposalReport(__velarDisposeFailure${suffix}); }`,
      `${indentation}  throw ${failure};`,
      `${indentation}} finally {`,
      // Normal completion, `return`, `break`, and `continue` all arrive here,
      // and a release failure on those paths throws normally.
      `${indentation}  if (!${released}) ${call};`,
      `${indentation}}`,
    ];
  }

  protected emitStatement(statement: Statement, depth: number): string {
    const indentation = "  ".repeat(depth);
    switch (statement.kind) {
      case "ImportDeclaration":
        return this.emitImport(statement, indentation);
      case "ReExportDeclaration": {
        const emittedSource = statement.source.endsWith(".vel") ? `${statement.source.slice(0, -4)}.js` : statement.source;
        const names = statement.specifiers
          .map((specifier) => specifier.imported === specifier.exported ? specifier.imported : `${specifier.imported} as ${specifier.exported}`)
          .join(", ");
        return `${indentation}export {${names.length > 0 ? ` ${names} ` : ""}} from ${JSON.stringify(emittedSource)};`;
      }
      case "ExternModuleDeclaration":
        return "";
      case "EmbeddedJavaScriptDeclaration":
        return this.emitEmbeddedJavaScript(statement, indentation);
      case "TypeDeclaration":
        return this.runtimeTypes.has(statement.name) ? this.emitTypeDeclaration(statement, depth) : "";
      case "TypeAliasDeclaration":
        return this.runtimeTypes.has(statement.name) ? this.emitTypeAliasDeclaration(statement, depth) : "";
      case "EnumDeclaration":
        return this.emitEnumDeclaration(statement, depth);
      case "ClassDeclaration":
        return this.emitClass(statement, depth);
      case "VariableDeclaration": {
        const initializer = this.emitMappedExpression(statement.initializer);
        if (statement.pattern.kind === "NameBindingPattern") {
          return `${indentation}${statement.exported ? "export " : ""}${statement.binding} ${statement.pattern.name} = ${initializer};`;
        }
        const valueName = `__velarBindingValue${statement.pattern.span.start}`;
        return [
          `${indentation}const ${valueName} = ${initializer};`,
          ...this.emitBindingPatternStatements(
            statement.pattern,
            valueName,
            statement.binding,
            statement.exported,
            depth,
            "Variable",
          ),
        ].join("\n");
      }
      // D39 item 53: a test is an exported async function the runner calls by
      // its generated name; the author's name travels in the module interface
      // so the reporter can quote it verbatim.
      case "TestDeclaration": {
        const lines = [
          ...this.emitStatementLines(statement.body, depth + 1),
          `${"  ".repeat(depth + 1)}return null;`,
        ];
        return `${indentation}export async function ${testFunctionName(statement)}() {\n${lines.join("\n")}\n${indentation}}`;
      }
      case "FunctionDeclaration": {
        const prefix = `${statement.exported || this.forcedFunctionExports.has(statement.name) ? "export " : ""}${statement.asynchronous ? "async " : ""}function`;
        const parameters = statement.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
        const lines = [...this.emitStatementLines(statement.body, depth + 1)];
        if (!this.blockAlwaysReturns(statement.body)) lines.push(`${"  ".repeat(depth + 1)}return null;`);
        const body = lines.join("\n");
        return `${indentation}${prefix} ${statement.name}(${parameters}) {${body.length > 0 ? `\n${body}\n${indentation}` : ""}}`;
      }
      case "ReturnStatement": {
        if (!statement.value) return `${indentation}return null;`;
        const value = this.emitMappedExpression(statement.value);
        return `${indentation}return ${this.hints.asyncResolvedValues.has(spanIdentity(statement.value.span)) ? `__velarAsyncResolvedValue(${value})` : value};`;
      }
      case "ThrowStatement":
        return `${indentation}throw ${this.emitMappedExpression(statement.value)};`;
      case "AssertStatement": {
        const message = statement.message ? this.emitMappedExpression(statement.message) : JSON.stringify("Assertion failed");
        return [
          `${indentation}if (!(${this.emitCondition(statement.condition)})) {`,
          `${indentation}  const __velarAssertionError = new Error(${message});`,
          `${indentation}  __velarAssertionError.name = "AssertionError";`,
          `${indentation}  throw __velarAssertionError;`,
          `${indentation}}`,
        ].join("\n");
      }
      case "IfStatement": {
        const thenBody = this.emitStatementLines(statement.thenBody, depth + 1).join("\n");
        let output = `${indentation}if (${this.emitCondition(statement.condition)}) {${thenBody.length > 0 ? `\n${thenBody}\n${indentation}` : ""}}`;
        if (statement.elseBody) {
          const chained = statement.elseBody.length === 1 && statement.elseBody[0]?.kind === "IfStatement"
            ? this.emitMappedStatement(statement.elseBody[0], 0)
            : null;
          if (chained) {
            output += ` else ${chained}`;
          } else {
            const elseBody = this.emitStatementLines(statement.elseBody, depth + 1).join("\n");
            output += ` else {${elseBody.length > 0 ? `\n${elseBody}\n${indentation}` : ""}}`;
          }
        }
        return output;
      }
      case "MatchStatement": {
        const suffix = statement.span.start;
        const valueName = `__velarMatchValue${suffix}`;
        const matchedName = `__velarMatchDone${suffix}`;
        const lines = [
          `${indentation}{`,
          `${indentation}  const ${valueName} = ${this.emitMappedExpression(statement.value)};`,
          `${indentation}  let ${matchedName} = false;`,
        ];
        for (const branch of statement.cases) {
          const attemptName = `__velarMatchCase${branch.pattern.span.start}`;
          const attempt = this.emitMatchPatternAttempt(branch.pattern, valueName, `${indentation}      `);
          lines.push(`${indentation}  let ${attemptName} = null;`);
          lines.push(`${indentation}  if (!${matchedName} && (${attemptName} = (() => {`);
          lines.push(...attempt.lines);
          lines.push(`${indentation}      return [${attempt.bindings.map((binding) => binding.value).join(", ")}];`);
          lines.push(`${indentation}    })()) !== null) {`);
          attempt.bindings.forEach((binding, index) => {
            lines.push(`${indentation}    const ${binding.name} = ${attemptName}[${index}];`);
          });
          if (branch.guard) {
            lines.push(`${indentation}    if (${this.emitCondition(branch.guard)}) {`);
            lines.push(`${indentation}      ${matchedName} = true;`);
            lines.push(...this.emitStatementLines(branch.body, depth + 3));
            lines.push(`${indentation}    }`);
          } else {
            lines.push(`${indentation}    ${matchedName} = true;`);
            lines.push(...this.emitStatementLines(branch.body, depth + 2));
          }
          lines.push(`${indentation}  }`);
        }
        lines.push(`${indentation}}`);
        return lines.join("\n");
      }
      case "ForStatement": {
        if (statement.asynchronous) {
          const suffix = statement.span.start;
          const sourceName = `__velarAsyncForSource${suffix}`;
          const nextName = `__velarAsyncForNext${suffix}`;
          const valueName = `__velarAsyncForValue${suffix}`;
          const indexName = `__velarAsyncForIndex${suffix}`;
          const bodyDepth = depth + 2;
          const lines = [
            `${indentation}{`,
            `${"  ".repeat(depth + 1)}const ${sourceName} = ${this.emitMappedExpression(statement.iterable)};`,
            `${"  ".repeat(depth + 1)}const ${nextName} = __velarAsyncPullNext(${sourceName});`,
            `${"  ".repeat(depth + 1)}let ${indexName} = 0;`,
            `${"  ".repeat(depth + 1)}while (true) {`,
            `${"  ".repeat(bodyDepth)}const ${valueName} = await __velarNormalizePromiseValue(__velarAsyncPullCall(${sourceName}, ${nextName}));`,
            `${"  ".repeat(bodyDepth)}if (${valueName} === null) break;`,
            ...this.emitBindingPatternStatements(statement.pattern, valueName, "const", false, bodyDepth, "Async for"),
            ...(statement.secondPattern
              ? this.emitBindingPatternStatements(statement.secondPattern, indexName, "const", false, bodyDepth, "Async for second slot")
              : []),
            `${"  ".repeat(bodyDepth)}${indexName} += 1;`,
            ...this.emitStatementLines(statement.body, bodyDepth),
            `${"  ".repeat(depth + 1)}}`,
            `${indentation}}`,
          ];
          return lines.join("\n");
        }
        if (this.hints.nativeRangeForStatements.has(statement.span.start)
          && statement.iterable.kind === "CallExpression"
          && statement.pattern.kind === "NameBindingPattern") {
          const call = statement.iterable;
          const sourceArguments = call.arguments.map((argument) => this.emitMappedExpression(argument));
          const namedOrder = this.hints.namedArgumentOrders.get(spanIdentity(call.span));
          const arguments_ = namedOrder
            ? namedOrder.map((source) => source === -1 ? "undefined" : `__velarNamedArguments[${source}]`)
            : sourceArguments;
          const emittedArguments = namedOrder
            ? `...((__velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
            : arguments_.join(", ");
          const suffix = statement.span.start;
          const boundsName = `__velarRangeBounds${suffix}`;
          const counterName = `__velarRangeCounter${suffix}`;
          const endName = `__velarRangeEnd${suffix}`;
          const stepName = `__velarRangeStep${suffix}`;
          const valueName = statement.pattern.name;
          const body = this.emitStatementLines(statement.body, depth + 2).join("\n");
          return [
            `${indentation}{`,
            `${indentation}  const ${boundsName} = __velarCountedRangeOwner.__velarCounted(${emittedArguments});`,
            `${indentation}  let ${counterName} = ${boundsName}[0];`,
            `${indentation}  const ${endName} = ${boundsName}[1];`,
            `${indentation}  const ${stepName} = ${boundsName}[2];`,
            `${indentation}  for (; ${stepName} > 0 ? ${counterName} < ${endName} : ${counterName} > ${endName}; ${counterName} += ${stepName}) {`,
            `${indentation}    const ${valueName} = ${counterName};${body.length > 0 ? `\n${body}` : ""}`,
            `${indentation}  }`,
            `${indentation}}`,
          ].join("\n");
        }
        this.needsCollectionHelpers = true;
        const iterable = this.emitMappedExpression(statement.iterable);
        if (!statement.secondPattern && statement.pattern.kind === "NameBindingPattern") {
          const body = this.emitStatementLines(statement.body, depth + 1).join("\n");
          return `${indentation}for (const ${statement.pattern.name} of __velarCollectionIterator(${iterable})) {${body.length > 0 ? `\n${body}\n${indentation}` : ""}}`;
        }
        if (statement.secondPattern) {
          const pairName = `__velarForPair${statement.pattern.span.start}`;
          const lines = [
            ...this.emitBindingPatternStatements(statement.pattern, `${pairName}[0]`, "const", false, depth + 1, "For first slot"),
            ...this.emitBindingPatternStatements(statement.secondPattern, `${pairName}[1]`, "const", false, depth + 1, "For second slot"),
            ...this.emitStatementLines(statement.body, depth + 1),
          ];
          return `${indentation}for (const ${pairName} of __velarCollectionPairIterator(${iterable})) {${lines.length > 0 ? `\n${lines.join("\n")}\n${indentation}` : ""}}`;
        }
        const valueName = `__velarForValue${statement.pattern.span.start}`;
        const lines = [
          ...this.emitBindingPatternStatements(statement.pattern, valueName, "const", false, depth + 1, "For"),
          ...this.emitStatementLines(statement.body, depth + 1),
        ];
        return `${indentation}for (const ${valueName} of __velarCollectionIterator(${iterable})) {${lines.length > 0 ? `\n${lines.join("\n")}\n${indentation}` : ""}}`;
      }
      case "WhileStatement": {
        const body = this.emitStatementLines(statement.body, depth + 1).join("\n");
        return `${indentation}while (${this.emitCondition(statement.condition)}) {${body.length > 0 ? `\n${body}\n${indentation}` : ""}}`;
      }
      case "BreakStatement":
        return `${indentation}break;`;
      case "ContinueStatement":
        return `${indentation}continue;`;
      case "PassStatement":
        return "";
      case "TryStatement": {
        const tryBody = this.emitStatementLines(statement.tryBody, depth + 1).join("\n");
        let output = `${indentation}try {${tryBody.length > 0 ? `\n${tryBody}\n${indentation}` : ""}}`;
        if (statement.catchBody) {
          this.needsThrownValueHelper = true;
          const catchBody = this.emitStatementLines(statement.catchBody, depth + 1).join("\n");
          const catchName = statement.catchName ?? "error";
          const normalization = `${"  ".repeat(depth + 1)}${catchName} = __velarNormalizeError(${catchName});`;
          output += ` catch (${catchName}) {\n${normalization}${catchBody.length > 0 ? `\n${catchBody}` : ""}\n${indentation}}`;
        }
        if (statement.finallyBody) {
          const finallyBody = this.emitStatementLines(statement.finallyBody, depth + 1).join("\n");
          output += ` finally {${finallyBody.length > 0 ? `\n${finallyBody}\n${indentation}` : ""}}`;
        }
        return output;
      }
      case "AssignmentStatement":
        if (statement.target.kind === "IndexExpression") {
          const binaryKind = this.hints.binaryIndexes.get(spanIdentity(statement.target.span));
          if (binaryKind) this.needsBinaryHelpers = true;
          else {
            this.needsIndexHelpers = true;
            this.needsCollectionHelpers = true;
          }
          const object = this.emitMappedExpression(statement.target.object);
          const index = this.emitMappedExpression(statement.target.index);
          if (binaryKind === "bytes") {
            return `${indentation}__velarBinaryRuntime.__velarSetIndex(${object}, ${index}, ${this.emitMappedExpression(statement.value)});`;
          }
          if (binaryKind) {
            const setHelper = this.binarySetIndexHelper(binaryKind);
            const getHelper = this.binaryIndexHelper(binaryKind);
            if (statement.operator === "=") {
              return `${indentation}__velarBinaryRuntime.${setHelper}(${object}, ${index}, ${this.emitMappedExpression(statement.value)});`;
            }
            const suffix = statement.span.start;
            const objectName = `__velarIndexObject${suffix}`;
            const keyName = `__velarIndexKey${suffix}`;
            const value = this.emitMappedExpression(statement.value);
            return [
              `${indentation}{`,
              `${indentation}  const ${objectName} = ${object};`,
              `${indentation}  const ${keyName} = ${index};`,
              `${indentation}  __velarBinaryRuntime.${setHelper}(${objectName}, ${keyName}, ${this.emitCompoundOperation(`__velarBinaryRuntime.${getHelper}(${objectName}, ${keyName})`, statement.operator, value)});`,
              `${indentation}}`,
            ].join("\n");
          }
          if (statement.operator === "=") {
            return `${indentation}__velarSetIndex(${object}, ${index}, ${this.emitMappedExpression(statement.value)});`;
          }
          const suffix = statement.span.start;
          const objectName = `__velarIndexObject${suffix}`;
          const keyName = `__velarIndexKey${suffix}`;
          const value = this.emitMappedExpression(statement.value);
          return [
            `${indentation}{`,
            `${indentation}  const ${objectName} = ${object};`,
            `${indentation}  const ${keyName} = ${index};`,
            `${indentation}  __velarSetIndex(${objectName}, ${keyName}, ${this.emitCompoundOperation(`__velarIndex(${objectName}, ${keyName})`, statement.operator, value)});`,
            `${indentation}}`,
          ].join("\n");
        }
        if (statement.operator !== "=" && statement.target.kind === "MemberExpression") {
          const key = spanIdentity(statement.target.span);
          const staticFieldOwnerDepth = this.hints.staticFieldReads.get(key);
          const guardedInstanceField = this.hints.instanceFieldReads.has(key);
          const guardedPrivateField = this.hints.privateInstanceFieldReads.has(key);
          if (staticFieldOwnerDepth !== undefined || guardedInstanceField || guardedPrivateField) {
            const suffix = statement.span.start;
            const objectName = `__velarMemberObject${suffix}`;
            const privateProperty = this.hints.privateMembers.has(key);
            const property = `${privateProperty ? "#" : ""}${statement.target.property}`;
            const read = staticFieldOwnerDepth !== undefined
              ? `__velarReadStaticField(${objectName}, ${JSON.stringify(statement.target.property)}, ${staticFieldOwnerDepth})`
              : guardedPrivateField
                ? `__velarReadPrivateField(${objectName}.${property}, ${JSON.stringify(statement.target.property)})`
                : `__velarReadInstanceField(${objectName}, ${JSON.stringify(statement.target.property)})`;
            const operation = this.emitCompoundOperation(read, statement.operator, this.emitMappedExpression(statement.value));
            return [
              `${indentation}{`,
              `${indentation}  const ${objectName} = ${this.emitMappedExpression(statement.target.object)};`,
              `${indentation}  ${objectName}.${property} = ${operation};`,
              `${indentation}}`,
            ].join("\n");
          }
          if (this.bitwiseAssignmentOperator(statement.operator)) {
            const suffix = statement.span.start;
            const objectName = `__velarMemberObject${suffix}`;
            const privateProperty = this.hints.privateMembers.has(key);
            const property = `${privateProperty ? "#" : ""}${statement.target.property}`;
            const value = this.emitMappedExpression(statement.value);
            return [
              `${indentation}{`,
              `${indentation}  const ${objectName} = ${this.emitMappedExpression(statement.target.object)};`,
              `${indentation}  ${objectName}.${property} = ${this.emitCompoundOperation(`${objectName}.${property}`, statement.operator, value)};`,
              `${indentation}}`,
            ].join("\n");
          }
        }
        {
          const target = this.emitMappedAssignmentTarget(statement.target);
          const value = this.emitMappedExpression(statement.value);
          if (statement.operator !== "=" && this.bitwiseAssignmentOperator(statement.operator)) {
            return `${indentation}${target} = ${this.emitCompoundOperation(target, statement.operator, value)};`;
          }
          return `${indentation}${target} ${statement.operator} ${value};`;
        }
      case "ExpressionStatement":
        return `${indentation}${this.emitMappedExpression(statement.expression, false)};`;
      case "AsyncStatement":
        // Detached execution never floats: the compiler-owned observer
        // adopts the Promise, normalizes rejection to Error, and reports it
        // through the host error channel (see docs/contributing/runtime-boundary.md,
        // B-DETACHED-ASYNC). The expression takes the same Promise
        // normalization every other Promise consumer applies, so a foreign
        // thenable or an `undefined` from an extern boundary fails as an owned
        // 'Expected an actual Promise' instead of a host-voiced
        // 'Promise.prototype.then called on incompatible receiver'.
        return `${indentation}__velarDetachedTask(${this.emitMappedExpression(statement.expression)});`;
      default:
        return "";
    }
  }

  private emitImport(statement: ImportDeclaration, indentation: string): string {
    const source = statement.source;
    const emittedSource = source.endsWith(".vel") ? `${source.slice(0, -4)}.js` : source;
    const first = statement.specifiers[0];
    if (first?.namespace) {
      const declared = statement.javascript && !statement.unsafe
        ? this.externModuleExports.get(source)
        : undefined;
      if (!declared) return `${indentation}import * as ${first.local} from ${JSON.stringify(emittedSource)};`;
      this.needsExternExportHelper = true;
      return [
        `${indentation}import * as ${first.local} from ${JSON.stringify(emittedSource)};`,
        ...[...declared].sort().map((name) => (
          `${indentation}__velarExternExport(${first.local}, ${JSON.stringify(name)}, ${JSON.stringify(source)});`
        )),
      ].join("\n");
    }
    // W-22: names governed by an extern module declaration import through the
    // module namespace so a declared-but-missing export fails at this import
    // site with a velar-voiced error instead of linking to undefined (bundled
    // CommonJS interop) or a host-voiced link refusal. Only the genuinely
    // imported declared names are checked; specifiers the declaration does not
    // name keep the native import form.
    const declared = statement.javascript && !statement.unsafe
      ? this.externModuleExports.get(source)
      : undefined;
    const checked = declared ? statement.specifiers.filter((specifier) => declared.has(specifier.imported)) : [];
    const native = declared ? statement.specifiers.filter((specifier) => !declared.has(specifier.imported)) : statement.specifiers;
    const lines: string[] = [];
    if (native.length === 1 && native[0]!.imported === "default") {
      lines.push(`${indentation}import ${native[0]!.local} from ${JSON.stringify(emittedSource)};`);
    } else if (native.length > 0 || checked.length === 0) {
      const names = native.map((specifier) => specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`).join(", ");
      lines.push(`${indentation}import { ${names} } from ${JSON.stringify(emittedSource)};`);
    }
    if (checked.length > 0) {
      this.needsExternExportHelper = true;
      const namespaceName = `__velarExternModule${statement.span.start}`;
      lines.push(`${indentation}import * as ${namespaceName} from ${JSON.stringify(emittedSource)};`);
      for (const specifier of checked) {
        lines.push(`${indentation}const ${specifier.local} = __velarExternExport(${namespaceName}, ${JSON.stringify(specifier.imported)}, ${JSON.stringify(source)});`);
      }
    }
    return lines.join("\n");
  }

  private prepareEmbeddedJavaScript(program: Program): void {
    this.embeddedJavaScript.clear();
    let ordinal = 0;
    for (const statement of program.body) {
      if (statement.kind !== "EmbeddedJavaScriptDeclaration") continue;
      const specifier = embeddedJavaScriptSpecifier(this.sourcePath, ordinal);
      const occupiedJavaScriptNames = new Set(statement.bindings.map((binding) => binding.name));
      let factoryName = statement.contract ? `__velarEmbeddedFactory_${ordinal}` : null;
      while (factoryName && occupiedJavaScriptNames.has(factoryName)) factoryName += "_";
      const localFactoryName = statement.contract ? `__velarEmbeddedFactoryBinding_${ordinal}` : null;
      const generated = statement.contract
        ? emitCheckedEmbeddedJavaScript(statement, factoryName!)
        : mappedSource(statement.source, statement.sourceSpan.start);
      this.embeddedJavaScript.set(statement, {
        statement,
        specifier,
        factoryName,
        localFactoryName,
        code: generated.code,
        mappings: generated.mappings,
      });
      ordinal += 1;
    }
  }

  private emitEmbeddedJavaScript(statement: EmbeddedJavaScriptDeclaration, indentation: string): string {
    const prepared = this.embeddedJavaScript.get(statement);
    if (!prepared) throw new Error("An embedded JavaScript declaration has no prepared sibling module");
    if (!statement.contract) {
      const imported: ImportDeclaration = {
        kind: "ImportDeclaration",
        source: prepared.specifier,
        sourceSpan: statement.sourceSpan,
        javascript: true,
        unsafe: true,
        specifiers: statement.exports.map((item) => ({
          imported: item.name,
          local: item.name,
          namespace: false,
          span: item.nameSpan,
        })),
        span: statement.span,
      };
      return this.emitImport(imported, indentation);
    }
    const names = [
      ...statement.contract.functions.map((item) => item.name),
      ...statement.contract.constants.map((item) => item.name),
      ...statement.contract.classes.map((item) => item.name),
    ];
    const captureValues = statement.captures.map((capture) => this.emitMappedExpression({
      kind: "IdentifierExpression",
      name: capture.name,
      span: capture.nameSpan,
    })).join(", ");
    const call = `${prepared.localFactoryName}(${captureValues})`;
    return [
      `${indentation}import { ${prepared.factoryName} as ${prepared.localFactoryName} } from ${JSON.stringify(prepared.specifier)};`,
      names.length > 0
        ? `${indentation}const { ${names.join(", ")} } = ${call};`
        : `${indentation}${call};`,
    ].join("\n");
  }

  private emitTypeDeclaration(statement: TypeDeclaration, depth: number): string {
    const parameters = statement.typeParameters?.map((parameter) => parameter.name) ?? null;
    if (!parameters) return this.emitRecordTypeDeclaration(statement, depth);
    this.genericTypeParameters = parameters;
    try {
      return this.emitRecordTypeDeclaration(statement, depth);
    } finally {
      this.genericTypeParameters = null;
    }
  }

  private emitRecordTypeDeclaration(statement: TypeDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const generic = this.genericTypeParameters;
    const checkName = this.runtimeTypeCheckName(statement.name);
    const ownFields = new Map(statement.fields.map((field) => [field.name, field]));
    const completeFields = this.hints.typeDeclarationFields.get(statement.span.start)
      ?? statement.fields.map((field) => ({ name: field.name, type: this.resolveDeclarationType(field.type) }));
    const fields = completeFields.map((field, index) => ({
      name: field.name,
      descriptor: `__velarField${index}`,
      // Complete field tables are alias-expanded for structural analysis. An
      // own field's source spelling is nevertheless the runtime authority in
      // this module: an imported alias may be the only binding available for
      // its target record. Inherited fields have no local syntax and continue
      // to use the analyzer-owned resolved type.
      type: ownFields.has(field.name)
        ? this.resolveDeclarationType(ownFields.get(field.name)!.type)
        : field.type,
      syntax: ownFields.get(field.name)?.type.syntax ?? null,
    }));
    const checks = fields.map(({ descriptor, type }) => {
      const present = `${descriptor}?.enumerable && "value" in ${descriptor} && ${this.emitTypeCheck(type, `${descriptor}.value`, "__state")}`;
      return type.kind === "optional" ? `(${descriptor} === undefined || (${present}))` : present;
    });
    const predicate = checks.length > 0 ? checks.join(" && ") : "true";
    const exportPrefix = statement.exported ? "export " : "";
    // COL-U5: parse failures name the failing field. The explain companion
    // re-runs the per-field checks only on the failure path, so is() and the
    // success path stay exactly as cheap as before.
    const explainName = `__velarTypeExplain_${statement.name}`;
    // D55 rule 121: a generic record's validator is the same validator with the
    // erased positions supplied from outside — the arguments carry a predicate,
    // a display text, and a key per type argument, so `parse` still names the
    // type the author wrote and the memo still answers with one Type object per
    // instantiation.
    const argumentsParameter = generic ? ", __velarArguments" : "";
    const displayName = generic ? "__velarArguments.name" : JSON.stringify(statement.name);
    const pathText = (suffix: string): string => generic
      ? (suffix === "" ? displayName : `${displayName} + ${JSON.stringify(suffix)}`)
      : JSON.stringify(`${statement.name}${suffix}`);
    const explainLines = [
      `${indentation}function ${explainName}(value${argumentsParameter}) {`,
      `${indentation}  if (value === null || typeof value !== "object" || __velarValidationIsArray(value) || !__velarValidationIsPlainObject(value)) {`,
      `${indentation}    return { path: ${pathText("")}, field: null, reason: "the value is not a record" };`,
      `${indentation}  }`,
      ...fields.flatMap(({ name, type, syntax }) => {
        const descriptor = "__velarExplainField";
        const typeText = this.typeTextExpression(type, syntax);
        const lines = [
          `${indentation}  {`,
          `${indentation}    const ${descriptor} = __velarValidationOwnDescriptor(value, ${JSON.stringify(name)});`,
        ];
        if (type.kind === "optional") {
          lines.push(`${indentation}    if (${descriptor} !== undefined && !(${descriptor}.enumerable && "value" in ${descriptor} && ${this.emitTypeCheck(type, `${descriptor}.value`, "__velarValidationState()")})) {`);
        } else {
          lines.push(`${indentation}    if (${descriptor} === undefined) {`);
          lines.push(`${indentation}      return { path: ${pathText(`.${name}`)}, field: ${JSON.stringify(name)}, reason: ${JSON.stringify(`field '${name}' is missing`)} };`);
          lines.push(`${indentation}    }`);
          lines.push(`${indentation}    if (!(${descriptor}.enumerable && "value" in ${descriptor} && ${this.emitTypeCheck(type, `${descriptor}.value`, "__velarValidationState()")})) {`);
        }
        lines.push(`${indentation}      return { path: ${pathText(`.${name}`)}, field: ${JSON.stringify(name)}, reason: ${JSON.stringify(`field '${name}' does not match `)} + ${typeText} };`);
        lines.push(`${indentation}    }`);
        lines.push(`${indentation}  }`);
        return lines;
      }),
      `${indentation}  return { path: ${pathText("")}, field: null, reason: null };`,
      `${indentation}}`,
      "",
    ];
    const typeObject = [
      `${indentation}  is(value, __state) {`,
      `${indentation}    return ${checkName}(value, __state${generic ? ", __velarArguments" : ""});`,
      `${indentation}  },`,
      `${indentation}  parse(value) {`,
      `${indentation}    if (!${checkName}(value, __velarValidationState()${generic ? ", __velarArguments" : ""})) {`,
      `${indentation}      const __velarDetail = ${explainName}(value${generic ? ", __velarArguments" : ""});`,
      `${indentation}      throw new __VelarValidationError(${generic ? `"Value does not match " + ${displayName}` : JSON.stringify(`Value does not match ${statement.name}`)} + (__velarDetail.reason ? " — " + __velarDetail.reason : "") + __velarValidationRejectionHint(value), __velarDetail);`,
      `${indentation}    }`,
      `${indentation}    return value;`,
      `${indentation}  },`,
    ];
    if (generic) {
      const instances = `__velarGenericInstances_${statement.name}`;
      return [
        ...explainLines,
        ...this.recordCheckFunctionLines(statement, fields, predicate, checkName, indentation, argumentsParameter),
        "",
        `${indentation}const ${instances} = [];`,
        // The instantiation memo: one frozen Type object per set of arguments,
        // found by a key the emitter builds from the arguments' own identities.
        // It is what makes `type Tree<T>: kids: List<Tree<T>>` terminate — the
        // body's reference to its own instantiation is a lookup, not a rebuild.
        `${indentation}${exportPrefix}const ${statement.name} = __velarValidationFreeze({`,
        `${indentation}  of(__velarKeys, __velarTexts, __velarChecks) {`,
        `${indentation}    let __velarKey = ${JSON.stringify(statement.name)};`,
        `${indentation}    for (let __velarIndex = 0; __velarIndex < __velarKeys.length; __velarIndex += 1) __velarKey += "\\u0000" + __velarKeys[__velarIndex];`,
        `${indentation}    for (let __velarIndex = 0; __velarIndex < ${instances}.length; __velarIndex += 1) {`,
        `${indentation}      if (${instances}[__velarIndex].key === __velarKey) return ${instances}[__velarIndex].type;`,
        `${indentation}    }`,
        `${indentation}    let __velarName = ${JSON.stringify(`${statement.name}<`)};`,
        `${indentation}    for (let __velarIndex = 0; __velarIndex < __velarTexts.length; __velarIndex += 1) __velarName += (__velarIndex === 0 ? "" : ", ") + __velarTexts[__velarIndex];`,
        `${indentation}    __velarName += ">";`,
        `${indentation}    const __velarArguments = { keys: __velarKeys, texts: __velarTexts, checks: __velarChecks, name: __velarName };`,
        `${indentation}    const __velarType = __velarRegisterRuntimeType(__velarValidationFreeze({`,
        ...typeObject.map((line) => `${indentation}  ${line}`),
        `${indentation}    }));`,
        `${indentation}    ${instances}[${instances}.length] = { key: __velarKey, type: __velarType };`,
        `${indentation}    return __velarType;`,
        `${indentation}  },`,
        `${indentation}});`,
      ].join("\n");
    }
    return [
      ...explainLines,
      ...this.recordCheckFunctionLines(statement, fields, predicate, checkName, indentation, ""),
      "",
      `${indentation}${exportPrefix}const ${statement.name} = __velarRegisterRuntimeType(__velarValidationFreeze({`,
      ...typeObject,
      `${indentation}}));`,
    ].join("\n");
  }

  /** The record predicate itself: identical for a plain record and a generic one but for the arguments it carries. */
  private recordCheckFunctionLines(
    statement: TypeDeclaration,
    fields: readonly { readonly name: string; readonly descriptor: string }[],
    predicate: string,
    checkName: string,
    indentation: string,
    argumentsParameter: string,
  ): readonly string[] {
    // The per-value cycle guard is keyed by the *instantiation*, not by the
    // function: `Tree<string>` and `Tree<number>` share one predicate, and a
    // value reached under both in one traversal is two questions, not one.
    const guard = argumentsParameter ? "__velarArguments" : checkName;
    return [
      `${indentation}function ${checkName}(value, __state = __velarValidationState()${argumentsParameter}) {`,
      // D44 rule 70: a record contract accepts only plain data objects, so a
      // class instance can never satisfy it — otherwise the validated record
      // view would alias the live instance and write through its const fields.
      `${indentation}  if (value === null || typeof value !== "object" || __velarValidationIsArray(value) || !__velarValidationIsPlainObject(value) || __state.depth >= 1000) return false;`,
      `${indentation}  let __active = __velarValidationWeakMapGet(__state.active, value);`,
      `${indentation}  if (__active && __velarValidationSetHas(__active, ${guard})) return false;`,
      `${indentation}  if (!__active) {`,
      `${indentation}    __active = __velarValidationSet();`,
      `${indentation}    __velarValidationWeakMapSet(__state.active, value, __active);`,
      `${indentation}  }`,
      `${indentation}  __velarValidationSetAdd(__active, ${guard});`,
      `${indentation}  __state.depth += 1;`,
      `${indentation}  try {`,
      ...fields.map(({ name, descriptor }) => `${indentation}    const ${descriptor} = __velarValidationOwnDescriptor(value, ${JSON.stringify(name)});`),
      `${indentation}    return !!(${predicate});`,
      `${indentation}  } finally {`,
      `${indentation}    __state.depth -= 1;`,
      `${indentation}    __velarValidationSetDelete(__active, ${guard});`,
      `${indentation}    if (__velarValidationSetSize(__active) === 0) __velarValidationWeakMapDelete(__state.active, value);`,
      `${indentation}  }`,
      `${indentation}}`,
    ];
  }

  private emitTypeAliasDeclaration(statement: TypeAliasDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    // ENM-I4: identities follow aliases, so an alias whose target resolves to
    // an enum IS that enum object at runtime — members, is, parse, and
    // values() all answer through the one frozen object.
    const enumTarget = this.enumAliasTarget(statement.name);
    if (enumTarget !== null) {
      return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = ${enumTarget};`;
    }
    // D55 rule 123 on ENM-I4's precedent: naming an instantiation is *the*
    // idiom that gives a generic record a runtime Type object, so the name IS
    // that instantiation's Type object rather than a wrapper around it. One
    // object per instantiation program-wide, and `parse` answers with the
    // record's own per-field explanation instead of a bare refusal.
    const target = resolveTypeReference(statement.target);
    if (target.kind === "named" && target.application && this.genericTypeBinding(target.application.name)) {
      this.needsRuntimeTypeHelpers = true;
      return `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = ${this.genericInstanceExpression(target.application)};`;
    }
    const checkName = this.runtimeTypeCheckName(statement.name);
    const predicate = this.emitTypeCheck(resolveTypeReference(statement.target), "value", "__state");
    const exportPrefix = statement.exported ? "export " : "";
    return [
      `${indentation}function ${checkName}(value, __state = __velarValidationState()) {`,
      `${indentation}  return ${predicate};`,
      `${indentation}}`,
      "",
      `${indentation}${exportPrefix}const ${statement.name} = __velarRegisterRuntimeType(__velarValidationFreeze({`,
      `${indentation}  is(value, __state) {`,
      `${indentation}    return ${checkName}(value, __state);`,
      `${indentation}  },`,
      `${indentation}  parse(value) {`,
      `${indentation}    if (!${checkName}(value)) {`,
      `${indentation}      throw new __VelarValidationError(${JSON.stringify(`Value does not match ${statement.name}`)}, { path: ${JSON.stringify(statement.name)} });`,
      `${indentation}    }`,
      `${indentation}    return value;`,
      `${indentation}  },`,
      `${indentation}}));`,
    ].join("\n");
  }

  private emitEnumDeclaration(statement: EnumDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const values = statement.members.map((member) => JSON.stringify(member.value));
    const members = statement.members.map((member) => `${indentation}  ${member.name}: ${JSON.stringify(member.value)},`);
    const predicate = values.length === 1
      ? `value === ${values[0]}`
      : values.map((value) => `value === ${value}`).join(" || ");
    return [
      `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarRegisterRuntimeType(__velarValidationFreeze({`,
      ...members,
      `${indentation}  is(value) {`,
      `${indentation}    return ${predicate};`,
      `${indentation}  },`,
      `${indentation}  parse(value) {`,
      `${indentation}    if (!${statement.name}.is(value)) {`,
      `${indentation}      throw new __VelarValidationError(${JSON.stringify(`Value does not match ${statement.name}`)}, { path: ${JSON.stringify(statement.name)} });`,
      `${indentation}    }`,
      `${indentation}    return value;`,
      `${indentation}  },`,
      // ENM-U1: the members in declaration order, a fresh mutable List per call.
      `${indentation}  values() {`,
      `${indentation}    return [${values.join(", ")}];`,
      `${indentation}  },`,
      `${indentation}}));`,
    ].join("\n");
  }

  protected emitTypeCheck(type: ValueType, value: string, state = "undefined"): string {
    switch (type.kind) {
      case "unknown":
      case "any":
        return "true";
      case "null":
        return `${value} == null`;
      case "string":
      case "number":
      case "bool":
        return `typeof ${value} === ${JSON.stringify(type.kind === "bool" ? "boolean" : type.kind)}`;
      case "optional":
        return `(${value} == null || ${this.emitTypeCheck(type.inner, value, state)})`;
      case "list":
        return `__velarListTypeIs(${value}, (item) => ${this.emitTypeCheck(type.element, "item", state)})`;
      case "set":
        return `__velarSetTypeIs(${value}, (item) => ${this.emitTypeCheck(type.element, "item", state)})`;
      case "map":
        return `__velarMapTypeIs(${value}, (key, item) => ${this.emitTypeCheck(type.key, "key", state)} && ${this.emitTypeCheck(type.value, "item", state)})`;
      case "record":
        return `__velarRecordTypeIs(${value}, (item) => ${this.emitTypeCheck(type.value, "item", state)})`;
      case "promise":
        return `__velarValidationIsPromise(${value})`;
      case "named":
        // D55 rule 121: an instantiation's validator is the declaration's,
        // supplied with this application's argument predicates. The factory
        // memoizes, so the object is built once however many times it is asked
        // for — and a recursive record's reference to itself is a memo hit.
        if (type.application && this.genericTypeBinding(type.application.name)) {
          this.needsRuntimeTypeHelpers = true;
          return `${this.genericInstanceExpression(type.application)}.is(${value}, ${state})`;
        }
        if (type.name === "Duration") return `typeof ${value} === "string" && /^[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:ms|s)$/.test(${value})`;
        if (this.hints.enumNames.has(type.name)) return `${type.name}.is(${value})`;
        if (this.hints.classNames.has(type.name)) {
          return `__velarValidationIsInstance(${value}, ${this.builtinErrorRuntimeName(type.name) ?? type.name})`;
        }
        // An alias of an enum is lowered as the enum object itself, so its
        // check delegates the same way a direct enum name does (ENM-I4).
        if (this.enumAliasTarget(type.name) !== null) return `${type.name}.is(${value})`;
        if (this.typeDeclarations.has(type.name)) return `${this.runtimeTypeCheckName(type.name)}(${value}, ${state})`;
        // D60 rule 148: only a name that actually binds a runtime Type object
        // may be written into the output. See `runtimeTypeBinding`.
        return this.runtimeTypeBinding(type.name) ? `${type.name}.is(${value}, ${state})` : "false";
      case "class":
        return `__velarValidationIsInstance(${value}, ${this.builtinErrorRuntimeName(type.name) ?? type.name})`;
      case "enum":
        return `${type.name}.is(${value})`;
      case "enumMember":
        return `${value} === ${type.name}.${type.member}`;
      case "union":
        return `(${type.members.map((member) => this.emitTypeCheck(member, value, state)).join(" || ")})`;
      case "object":
        return `${value} !== null && typeof ${value} === "object"`;
      case "function":
      case "action":
      case "intrinsic":
        return `typeof ${value} === "function"`;
      // D55 rule 121: inside a generic record's own validator a type parameter
      // is not unknowable — the instantiation handed in the predicate for it.
      case "parameter":
        return this.genericTypeParameters?.length
          ? `__velarArguments.checks[${type.index}](${value}, ${state === "undefined" ? "__velarValidationState()" : state})`
          : "false";
      case "typeObject":
      case "runtimeType":
      case "enumObject":
      case "classConstructor":
      case "extension":
        // Static Type<T> carriers are erased; the analyzer rejects them in any
        // recursively runtime-checked position before emission can happen.
        return "false";
    }
  }

  protected emitIsCheck(type: ValueType, value: string): string {
    if (type.kind === "named" && type.name === "Duration") return `typeof ${value} === "string" && /^[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:ms|s)$/.test(${value})`;
    // D60 rule 148: a name with no runtime Type object behind it is not a
    // callable receiver, so the check falls through to the structural form
    // instead of naming a binding that does not exist.
    return type.kind === "named" && this.runtimeTypeBinding(type.name)
      ? `${type.name}.is(${value})`
      : this.emitTypeCheck(type, value);
  }

  protected emitNarrowingCheck(type: ValueType, value: string, state = "undefined"): string {
    switch (type.kind) {
      case "optional":
        return `(${value} == null || ${this.emitNarrowingCheck(type.inner, value, state)})`;
      case "list":
        return `__velarListTypeIs(${value}, (item) => ${this.emitNarrowingCheck(type.element, "item", state)})`;
      case "set":
        return `__velarSetTypeIs(${value}, (item) => ${this.emitNarrowingCheck(type.element, "item", state)})`;
      case "map":
        return `__velarMapTypeIs(${value}, (key, item) => ${this.emitNarrowingCheck(type.key, "key", state)} && ${this.emitNarrowingCheck(type.value, "item", state)})`;
      case "record":
        return `__velarRecordTypeIs(${value}, (item) => ${this.emitNarrowingCheck(type.value, "item", state)})`;
      case "union":
        return `(${type.members.map((member) => this.emitNarrowingCheck(member, value, state)).join(" || ")})`;
      case "named":
        // FLW-U1: an imported record type (or alias) is not in this module's
        // typeDeclarations, but its runtime Type object is an in-scope
        // binding, so the recheck routes through `Name.is(value)` exactly as
        // `is` tests already do. Only names with no runtime Type binding at
        // all — extension host types such as DOM interfaces — degrade to the
        // presence-only check.
        if (type.application && this.genericTypeBinding(type.application.name)) return this.emitTypeCheck(type, value, state);
        if (!this.runtimeTypeBinding(type.name)) return `${value} != null`;
        return this.emitTypeCheck(type, value, state);
      case "parameter":
      case "typeObject":
      case "runtimeType":
      case "enumObject":
      case "classConstructor":
      case "extension":
        return `${value} != null`;
      default:
        return this.emitTypeCheck(type, value, state);
    }
  }

  private runtimeTypeCheckName(name: string): string {
    return `__velarTypeCheck_${name}`;
  }

  /**
   * D55 rule 121: the name a module writes for a generic record is a JavaScript
   * binding holding its instantiation factory — declared here, or imported from
   * the module that declares it. Nothing else may be written into `.of(...)`.
   */
  protected genericTypeBinding(name: string): boolean {
    if (this.hints.genericTypeNames.has(name)) return true;
    const declaration = this.typeDeclarations.get(name);
    return declaration?.kind === "TypeDeclaration" && (declaration.typeParameters?.length ?? 0) > 0;
  }

  /** The instantiation a `named` application stands for, as a JavaScript expression. */
  private genericInstanceExpression(application: GenericApplication): string {
    const keys = application.arguments.map((argument) => this.genericArgumentExpression(argument, "key"));
    const texts = application.arguments.map((argument) => this.genericArgumentExpression(argument, "text"));
    const checks = application.arguments.map((argument) => `(value, __state) => ${this.emitTypeCheck(argument, "value", "__state")}`);
    const expression = `${application.name}.of([${keys.join(", ")}], [${texts.join(", ")}], [${checks.join(", ")}])`;
    // Outside a generic body the arguments are closed, so the whole
    // instantiation is hoisted into one memoized function: a `function`
    // declaration, which hoists past the temporal dead zone a `const` would
    // create for `type Boxed = Box<string>` written above the declaration.
    if (this.genericTypeParameters?.length) return expression;
    const hoisted = this.hoistedGenericInstances.get(expression)
      ?? `__velarTypeOf${this.hoistedGenericInstances.size}`;
    this.hoistedGenericInstances.set(expression, hoisted);
    return `${hoisted}()`;
  }

  /**
   * A type argument's memo key or display text. Both are plain strings when the
   * argument is closed; inside a generic body a mention of the enclosing
   * parameters reads them off the arguments the instantiation supplied, so
   * `type Wrapper<T>: inner: Box<List<T>>` keys and prints correctly at every
   * instantiation without the emitter having seen one.
   */
  private genericArgumentExpression(type: ValueType, mode: "key" | "text"): string {
    const parameters = this.genericTypeParameters;
    if (!parameters?.length || !typeContainsParameter(type)) {
      return JSON.stringify(mode === "key" ? semanticTypeIdentity(type) : describeType(type));
    }
    const nested = (value: ValueType): string => this.genericArgumentExpression(value, mode);
    const wrap = (prefix: string, parts: readonly string[], suffix: string): string =>
      [JSON.stringify(prefix), ...parts.flatMap((part, index) => index === 0 ? [part] : [JSON.stringify(mode === "key" ? "," : ", "), part]), JSON.stringify(suffix)].join(" + ");
    switch (type.kind) {
      case "parameter":
        return `__velarArguments.${mode === "key" ? "keys" : "texts"}[${type.index}]`;
      case "optional":
        return `${nested(type.inner)} + ${JSON.stringify("?")}`;
      case "list":
        return wrap("List<", [nested(type.element)], ">");
      case "set":
        return wrap("Set<", [nested(type.element)], ">");
      case "map":
        return wrap("Map<", [nested(type.key), nested(type.value)], ">");
      case "record":
        return wrap("Record<", [nested(type.value)], ">");
      case "promise":
        return wrap("Promise<", [nested(type.value)], ">");
      case "named":
        return type.application
          ? wrap(`${type.application.name}<`, type.application.arguments.map(nested), ">")
          : JSON.stringify(mode === "key" ? semanticTypeIdentity(type) : describeType(type));
      case "union":
        return type.members.map(nested).join(` + ${JSON.stringify(mode === "key" ? "|" : " | ")} + `);
      default:
        return JSON.stringify(mode === "key" ? semanticTypeIdentity(type) : describeType(type));
    }
  }

  /**
   * The display text of a field's declared type, as a JavaScript expression.
   * A generic record's `parse` failure names the type the caller instantiated
   * — `field 'value' does not match string`, not `does not match T`.
   */
  private typeTextExpression(type: ValueType, syntax: TypeSyntax | null): string {
    return this.genericTypeParameters?.length
      ? this.genericArgumentExpression(type, "text")
      : JSON.stringify(syntax ? formatTypeSyntax(syntax) : describeType(type));
  }

  /**
   * A declared type inside a generic record's body. The emitter has no analyzer
   * frame, so the declaration's own parameter names are turned into `parameter`
   * kinds here — the one place the emitter learns that `T` is erased rather
   * than unknown.
   */
  private resolveDeclarationType(reference: TypeReference): ValueType {
    const parameters = this.genericTypeParameters;
    const resolved = resolveTypeReference(reference);
    if (!parameters?.length) return resolved;
    const bindParameters = (type: ValueType): ValueType => {
      if (type.kind === "named" && !type.application) {
        const index = parameters.indexOf(type.name);
        if (index >= 0) return { kind: "parameter", name: type.name, index };
      }
      return mapNestedTypes(type, bindParameters);
    };
    return bindParameters(resolved);
  }

  /**
   * D60 rule 148: a `named` ValueType carries the type's *display* name, which
   * is a runtime binding only when this module really has a Type object under
   * it — a local `type` declaration, an imported one, an enum, or a class. An
   * unresolved generic formats to type text (`Component<(label: string) ->
   * WebNode>`) that is not even a JavaScript identifier, and an extension host
   * scalar (`Color`, `Length`, `WebNode`) has no binding at all. Writing either
   * into the output is how `velar check` passed and `velar build` then failed
   * to parse its own emission; the narrowing path (FLW-U1) already asks this
   * question, and every other check path now asks it too.
   */
  protected runtimeTypeBinding(name: string): boolean {
    return this.hints.enumNames.has(name)
      || this.hints.classNames.has(name)
      || this.typeDeclarations.has(name)
      || this.hints.runtimeTypeObjectNames.has(name);
  }

  /** The runtime class behind a nameable builtin error type, marking the runtime it needs. */
  private builtinErrorRuntimeName(name: string): string | null {
    if ((VELAR_HOST_ERROR_NAMES as readonly string[]).includes(name)) {
      this.requiredHostErrorClasses.add(name);
      return `__Velar${name}`;
    }
    const runtime = builtinErrorRuntimeNames.get(name);
    if (!runtime) return null;
    if (name === "ValidationError") this.needsRuntimeTypeHelpers = true;
    else if (name === "NarrowingError") this.needsNarrowingErrorClass = true;
    else this.needsCollectionHelpers = true;
    return runtime;
  }

  /** The enum an alias (or alias chain) resolves to, or null when the name is not an alias of an enum. */
  private enumAliasTarget(name: string, seen: readonly string[] = []): string | null {
    if (seen.includes(name)) return null;
    const declaration = this.typeDeclarations.get(name);
    if (!declaration || declaration.kind !== "TypeAliasDeclaration") return null;
    const target = resolveTypeReference(declaration.target);
    if (target.kind !== "named") return null;
    if (this.hints.enumNames.has(target.name)) return target.name;
    return this.enumAliasTarget(target.name, [...seen, name]);
  }

  private emitClass(statement: ClassDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const parameters = statement.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
    const constructorLines: string[] = [];
    const constructorBody = [...(statement.initialization?.body ?? [])];
    const explicitSuper = constructorBody[0]?.kind === "ExpressionStatement"
      && constructorBody[0].expression.kind === "CallExpression"
      && constructorBody[0].expression.callee.kind === "SuperExpression";
    if (statement.base) {
      constructorLines.push(explicitSuper
        ? this.emitMappedStatement(constructorBody.shift()!, depth + 2)
        : `${indentation}    super();`);
    }
    // Error subclasses report under their declared name — the JavaScript
    // default leaves `.name` at "Error", which mislabels every report header
    // (audit 4's micro-ruling).
    if (statement.base && this.hints.errorSubclassNames.has(statement.name)) {
      constructorLines.push(`${indentation}    this.name = ${JSON.stringify(statement.name)};`);
    }
    for (const parameter of statement.parameters) {
      if (parameter.binding) {
        constructorLines.push(`${indentation}    this.${parameter.private ? "#" : ""}${parameter.name} = ${parameter.name};`);
      }
    }
    for (const field of statement.fields) {
      if (!field.static && field.initializer) constructorLines.push(`${indentation}    this.${field.private ? "#" : ""}${field.name} = ${this.emitMappedExpression(field.initializer)};`);
    }
    if (statement.initialization) {
      constructorLines.push(`${indentation}    const self = this;`);
      constructorLines.push(...this.emitStatementLines(constructorBody, depth + 2));
    }
    const constructor = [
      `${indentation}  constructor(${parameters}) {`,
      ...constructorLines,
      `${indentation}  }`,
    ].join("\n");
    const methodBody = (method: ClassDeclaration["methods"][number] | ClassDeclaration["getters"][number], methodDepth: number): string[] => {
      const lines = method.abstract
        ? [`${"  ".repeat(methodDepth)}throw new Error(${JSON.stringify(`Abstract ${"accessor" in method ? "getter" : "method"} ${statement.name}.${method.name}${"accessor" in method ? "" : "()"} must be implemented`)});`]
        : [
          ...(method.static ? [] : [`${"  ".repeat(methodDepth)}const self = this;`]),
          ...this.emitStatementLines(method.body, methodDepth),
        ];
      if (!method.abstract && !this.blockAlwaysReturns(method.body)) lines.push(`${"  ".repeat(methodDepth)}return null;`);
      return lines;
    };
    // Methods — public, static, and private alike — live on the class body as
    // native (private) methods, so instances carry data fields only and one
    // method object serves every instance (charter section 18).
    const methods = statement.methods.map((method) => {
      const methodParameters = method.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
      const lines = methodBody(method, depth + 2);
      const body = lines.join("\n");
      return `${indentation}  ${method.static ? "static " : ""}${method.asynchronous ? "async " : ""}${method.private ? "#" : ""}${method.name}(${methodParameters}) {${body.length > 0 ? `\n${body}\n${indentation}  ` : ""}}`;
    });
    const getters = statement.getters.map((getter) => {
      const lines = methodBody(getter, depth + 2);
      const body = lines.join("\n");
      return `${indentation}  ${getter.static ? "static " : ""}get ${getter.private ? "#" : ""}${getter.name}() {${body.length > 0 ? `\n${body}\n${indentation}  ` : ""}}`;
    });
    const privateFields = [
      ...statement.parameters.filter((parameter) => parameter.private).map((parameter) => parameter.name),
      ...statement.fields.filter((field) => field.private && !field.static).map((field) => field.name),
    ].map((name) => `${indentation}  #${name};`);
    const staticFields = statement.fields
      .filter((field) => field.static)
      .map((field) => `${indentation}  static ${field.private ? "#" : ""}${field.name} = ${field.initializer ? this.emitMappedExpression(field.initializer) : "null"};`);
    // D43 item 69: `@dispose:` becomes one prototype member under a key no
    // source member name can spell, so the release contract cannot be called
    // from source and cannot collide with a member the author declares.
    const dispose: string[] = [];
    if (statement.dispose) {
      // D51 rule 102: a derived `@dispose:` adds to the base's, it does not
      // replace it. The compiler composes the contract because `@dispose` is
      // not callable from source (D43 item 69), so an author could not forward
      // it by hand even if every author remembered to.
      const chained = this.hints.classDisposeChains.get(spanIdentity(statement.span)) ?? null;
      const disposeDepth = depth + (chained ? 3 : 2);
      const indent = "  ".repeat(disposeDepth);
      const asynchronous = chained === "async"
        || blockContainsDirectAwait(
          statement.dispose.body,
          (value, contains) => this.extensionExpressionContainsDirectAwait(value, contains),
          (owned, containsExpression, containsBlock) => this.extensionStatementContainsDirectAwait(owned, containsExpression, containsBlock),
        );
      const body = [
        `${indent}const self = this;`,
        ...this.emitStatementLines(statement.dispose.body, disposeDepth),
        `${indent}return null;`,
      ];
      const lines = chained ? this.chainedDisposeLines(body, chained, statement.span.start, depth + 2) : body;
      dispose.push(`${indentation}  ${asynchronous ? "async " : ""}[${JSON.stringify(disposeMemberKey)}]() {\n${lines.join("\n")}\n${indentation}  }`);
    }
    // D68 rule 177: `@iterate:` lands the same way, under its own unspellable
    // key. It is a plain prototype member, so a derived block simply shadows
    // the base's — overriding replaces, which is what "one answer" means.
    const iterate: string[] = [];
    if (statement.iterate) {
      const iterateDepth = depth + 2;
      const indent = "  ".repeat(iterateDepth);
      const body = [
        `${indent}const self = this;`,
        ...this.emitStatementLines(statement.iterate.body, iterateDepth),
        `${indent}return null;`,
      ];
      iterate.push(`${indentation}  [${JSON.stringify(iterateMemberKey)}]() {\n${body.join("\n")}\n${indentation}  }`);
    }
    const extension = statement.base ? ` extends ${statement.base.name}` : "";
    return `${indentation}${statement.exported ? "export " : ""}class ${statement.name}${extension} {\n${[...privateFields, ...staticFields, constructor, ...getters, ...methods, ...dispose, ...iterate].join("\n\n")}\n${indentation}}`;
  }

  /**
   * D51 rule 102: derived first, base after — construction order reversed, the
   * same intuition LIFO release already has. The base runs on every exit from
   * the derived body, including a `return`, and when the derived part already
   * failed the base failure is reported to the host instead of replacing the
   * error in flight, exactly as rule 8 of D43 item 69 decides for `using`.
   */
  private chainedDisposeLines(
    body: readonly string[],
    inherited: "sync" | "async",
    suffix: number,
    depth: number,
  ): readonly string[] {
    const indentation = "  ".repeat(depth);
    this.needsDisposalHelper = true;
    this.needsThrownValueHelper = true;
    const call = `${inherited === "async" ? "await " : ""}super[${JSON.stringify(disposeMemberKey)}]()`;
    const released = `__velarBaseReleased${suffix}`;
    const failure = `__velarDisposeChainFailure${suffix}`;
    return [
      `${indentation}let ${released} = false;`,
      `${indentation}try {`,
      ...body,
      `${indentation}} catch (${failure}) {`,
      `${indentation}  ${released} = true;`,
      `${indentation}  try { ${call}; } catch (__velarBaseDisposeFailure${suffix}) { __velarDisposalReport(__velarBaseDisposeFailure${suffix}); }`,
      `${indentation}  throw ${failure};`,
      `${indentation}} finally {`,
      `${indentation}  if (!${released}) ${call};`,
      `${indentation}}`,
    ];
  }

  protected emitParameter(name: string, defaultValue: Expression | null, rest = false): string {
    if (rest) return `...${name}`;
    return defaultValue ? `${name} = ${this.emitMappedExpression(defaultValue)}` : name;
  }

  protected emitMappedExpression(expression: Expression, normalizeNull = true): string {
    return this.emitMappedJavaScript(expression.span, () => {
      const key = spanIdentity(expression.span);
      const normalizePromise = normalizeNull
        && this.suppressPromiseNormalization === 0
        && this.hints.normalizedPromiseValues.has(key);
      if (normalizePromise) this.suppressPromiseNormalization += 1;
      let emitted: string;
      try {
        emitted = this.emitExpression(expression);
      } finally {
        if (normalizePromise) this.suppressPromiseNormalization -= 1;
      }
      const narrowing = this.hints.runtimeNarrowings.get(key);
      if (narrowing) {
        emitted = `(__velarValue => __velarNarrow(__velarValue, ${this.emitNarrowingCheck(narrowing.expected, "__velarValue")}, ${JSON.stringify(describeType(narrowing.expected))}, ${JSON.stringify(narrowing.description)}, ${expression.span.start}))(${emitted})`;
      }
      // D68 rule 177: the projection lives here rather than in each of the
      // eight consumers, because "iterating a class means iterating what
      // `@iterate:` answers" is one fact about the operand, and the consumers'
      // own lowerings then receive the List, Set, Map, or Record they already
      // knew how to handle.
      if (this.hints.iterationContracts.has(key)) emitted = `(${emitted})[${JSON.stringify(iterateMemberKey)}]()`;
      if (!normalizeNull) return emitted;
      if (normalizePromise) return `__velarNormalizePromiseValue(${emitted})`;
      if (this.hints.normalizedNullResults.has(key)) return `(${emitted}, null)`;
      if (this.hints.normalizedUndefinedExpressions.has(key)) return `(${emitted} ?? null)`;
      return emitted;
    });
  }

  private emitMappedAssignmentTarget(expression: Extract<Expression, { kind: "IdentifierExpression" | "MemberExpression" }>): string {
    return this.emitMappedJavaScript(expression.span, () => {
      if (expression.kind === "IdentifierExpression") return this.emitExpression(expression);
      const property = `${this.hints.privateMembers.has(spanIdentity(expression.span)) ? "#" : ""}${expression.property}`;
      return `${this.emitPostfixReceiver(expression.object)}.${property}`;
    });
  }

  private bitwiseAssignmentOperator(operator: AssignmentStatement["operator"]): "&" | "|" | "^" | "<<" | ">>" | ">>>" | null {
    return operator === "&=" || operator === "|=" || operator === "^=" || operator === "<<=" || operator === ">>=" || operator === ">>>="
      ? operator.slice(0, -1) as "&" | "|" | "^" | "<<" | ">>" | ">>>"
      : null;
  }

  private emitCompoundOperation(read: string, operator: AssignmentStatement["operator"], value: string): string {
    const bitwise = this.bitwiseAssignmentOperator(operator);
    if (bitwise) {
      this.needsBitwiseHelpers = true;
      return `__velarBitwiseBinary(${read}, ${JSON.stringify(bitwise)}, ${value})`;
    }
    return `${read} ${operator.slice(0, -1)} ${value}`;
  }

  protected emitExpression(expression: Expression): string {
    if (expression.kind === "ExtensionExpression:core:duration") {
      return JSON.stringify((expression as Expression & { readonly raw: string }).raw);
    }
    if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")
      && this.hints.extensionCalls.get(spanIdentity(expression.span)) === "core.duration-arithmetic") {
      return `__velarDurationUnary(${JSON.stringify(expression.operator)}, ${this.emitMappedExpression(expression.operand)})`;
    }
    if (expression.kind === "BinaryExpression"
      && this.hints.extensionCalls.get(spanIdentity(expression.span)) === "core.duration-arithmetic") {
      return `__velarDurationMath(${JSON.stringify(expression.operator)}, ${this.emitMappedExpression(expression.left)}, ${this.emitMappedExpression(expression.right)})`;
    }
    switch (expression.kind) {
      case "LiteralExpression":
        return expression.value === null ? "null" : typeof expression.value === "string" ? JSON.stringify(expression.value) : String(expression.value);
      case "FStringExpression":
        return `\`${expression.parts.map((part) => part.kind === "text" ? this.escapeTemplateText(part.value) : `\${${this.emitMappedExpression(part.value)}}`).join("")}\``;
      case "IdentifierExpression":
        {
          const builtin = this.hints.builtinValueReferences.get(spanIdentity(expression.span));
          if (builtin === "Json") return "__velarJsonNamespace";
          if (builtin === "Promise") return "__velarPromiseNamespace";
          if (builtin === "Text") return "__velarTextNamespace";
          if (builtin === "Math") return "__velarMathNamespace";
          if (builtin === "range") return "__velarRange";
        }
        if (expression.name === "number") {
          this.needsNumberHelper = true;
          return "__velarNumber";
        }
        return expression.name === "str" ? "String"
          : expression.name === "print" ? "console.log"
            : this.builtinErrorRuntimeName(expression.name) ?? expression.name;
      case "SuperExpression":
        return "super";
      case "DynamicImportExpression": {
        const source = expression.source.endsWith(".vel") ? `${expression.source.slice(0, -4)}.js` : expression.source;
        return `import(${JSON.stringify(source)})`;
      }
      case "ListExpression":
        if (expression.elements.some((element) => element.kind === "SpreadExpression")) {
          this.needsCollectionHelpers = true;
          const asynchronous = expression.elements.some((element) => this.expressionContainsDirectAwait(element));
          const parts = expression.elements.map((element) => {
            const directAwait = this.expressionContainsDirectAwait(element);
            const value = element.kind === "SpreadExpression" ? element.value : element;
            const read = `${directAwait ? "async " : ""}() => (${this.emitMappedExpression(value)})`;
            return asynchronous ? `[${element.kind === "SpreadExpression"}, ${directAwait}, ${read}]` : `[${element.kind === "SpreadExpression"}, ${read}]`;
          });
          return `${asynchronous ? "await __velarCreateListAsync" : "__velarCreateList"}([${parts.join(", ")}])`;
        }
        return `[${expression.elements.map((element) => this.emitMappedExpression(element)).join(", ")}]`;
      case "ObjectExpression": {
        const needsControlledConstruction = expression.properties.some((property) => property.kind === "ObjectSpread"
          || property.name === "__proto__");
        if (!needsControlledConstruction) {
          return `{ ${expression.properties.map((property) => property.kind === "ObjectProperty"
            ? `${this.emitObjectKey(property.name)}: ${this.emitMappedExpression(property.value)}`
            : "").join(", ")} }`;
        }
        this.needsCollectionHelpers = true;
        this.needsRecordHelpers = true;
        const asynchronous = expression.properties.some((property) => this.expressionContainsDirectAwait(property.value));
        const parts = expression.properties.map((property) => {
          const directAwait = this.expressionContainsDirectAwait(property.value);
          const read = `${directAwait ? "async " : ""}() => (${this.emitMappedExpression(property.value)})`;
          const name = property.kind === "ObjectProperty" ? JSON.stringify(property.name) : "null";
          return asynchronous
            ? `[${property.kind === "ObjectSpread"}, ${name}, ${directAwait}, ${read}]`
            : `[${property.kind === "ObjectSpread"}, ${name}, ${read}]`;
        });
        return `${asynchronous ? "await __velarCreateRecordAsync" : "__velarCreateRecord"}([${parts.join(", ")}])`;
      }
      case "SpreadExpression":
        this.needsCollectionHelpers = true;
        return `...__velarCopyList(${this.emitMappedExpression(expression.value)}, "Call spread")`;
      // D39 item 51: the attempt runs in its own frame so any failure inside
      // the whole chain becomes null, and nothing else in the surrounding
      // expression is skipped.
      case "TryExpression": {
        // D51 rule 103: `try` turns an *expected* failure into an optional.
        // AssertionError, NarrowingError, and IndexError are the language
        // saying "your program has a bug", so they pass straight through
        // instead of arriving as a `null` that reads like "not found". A
        // `catch` block still catches all three — that one is explicit.
        this.needsIntegrityFailureHelper = true;
        const asynchronous = this.expressionContainsDirectAwait(expression.value);
        const failure = `__velarTryFailure${expression.span.start}`;
        const attempt = `{ try { return ${this.emitMappedExpression(expression.value)}; } `
          + `catch (${failure}) { if (__velarIsIntegrityFailure(${failure})) throw ${failure}; return null; } }`;
        return `${asynchronous ? "await " : ""}(${asynchronous ? "async " : ""}() => ${attempt})()`;
      }
      case "UnaryExpression":
        if (expression.operator === "await") {
          return `await ${this.emitMappedExpression(expression.operand)}`;
        }
        if (expression.operator === "~") {
          this.needsBitwiseHelpers = true;
          return `__velarBitwiseUnary(${this.emitMappedExpression(expression.operand)})`;
        }
        return expression.operator === "not"
          ? `!(${this.emitCondition(expression.operand)})`
          : `${expression.operator}(${this.emitMappedExpression(expression.operand)})`;
      case "BinaryExpression": {
        if (expression.operator === "and" || expression.operator === "or") {
          const operator = expression.operator === "and" ? "&&" : "||";
          return `(${this.emitCondition(expression.left)} ${operator} ${this.emitCondition(expression.right)})`;
        }
        if (expression.operator === "in" || expression.operator === "not in") {
          this.needsCollectionHelpers = true;
          const membership = `__velarContains(${this.emitMappedExpression(expression.left)}, ${this.emitMappedExpression(expression.right)})`;
          return expression.operator === "not in" ? `!(${membership})` : membership;
        }
        if (["&", "|", "^", "<<", ">>", ">>>"].includes(expression.operator)) {
          this.needsBitwiseHelpers = true;
          return `__velarBitwiseBinary(${this.emitMappedExpression(expression.left)}, ${JSON.stringify(expression.operator)}, ${this.emitMappedExpression(expression.right)})`;
        }
        // D36 item 41: `==`/`!=` are SameValueZero. The analyzer proves which
        // comparisons can actually meet two NaN operands; everything else
        // elides the repair and stays plain strict equality.
        if ((expression.operator === "==" || expression.operator === "!=")
          && this.hints.sameValueZeroEqualities.has(spanIdentity(expression.span))) {
          this.needsCollectionHelpers = true;
          const equality = `__velarSameValueZero(${this.emitBinaryOperand(expression.left)}, ${this.emitBinaryOperand(expression.right)})`;
          return expression.operator === "==" ? equality : `!${equality}`;
        }
        // TXT-D1: string orderings compare by code point everywhere; the
        // analyzer marks exactly the ordered comparisons whose operands are
        // strings, so numbers keep the plain operator.
        if (["<", "<=", ">", ">="].includes(expression.operator)
          && this.hints.stringOrderings.has(spanIdentity(expression.span))) {
          this.needsPrimitiveHelpers = true;
          return `(__velarStringCompare(${this.emitBinaryOperand(expression.left)}, ${this.emitBinaryOperand(expression.right)}) ${expression.operator} 0)`;
        }
        // D41 item 61: a comparison between Comparable-bounded parameters
        // dispatches on the runtime category instead of guessing one.
        if (["<", "<=", ">", ">="].includes(expression.operator)
          && this.hints.dynamicOrderings.has(spanIdentity(expression.span))) {
          this.needsPrimitiveHelpers = true;
          return `(__velarOrderCompare(${this.emitBinaryOperand(expression.left)}, ${this.emitBinaryOperand(expression.right)}) ${expression.operator} 0)`;
        }
        const operator = expression.operator === "==" ? "===" : expression.operator === "!=" ? "!==" : expression.operator;
        const left = expression.operator === "**" && expression.left.kind === "UnaryExpression"
          ? `(${this.emitMappedExpression(expression.left)})`
          : this.emitBinaryOperand(expression.left);
        return `(${left} ${operator} ${this.emitBinaryOperand(expression.right)})`;
      }
      case "ComparisonChainExpression":
        return this.emitComparisonChain(expression);
      case "ConditionalExpression":
        return `(${this.emitCondition(expression.condition)} ? ${this.emitMappedExpression(expression.thenValue)} : ${this.emitMappedExpression(expression.elseValue)})`;
      case "IsExpression":
        {
          const value = `__velarIs${expression.span.start}`;
          const checked = resolveTypeReference(expression.type);
          const classCheck = this.hints.classChecks.has(spanIdentity(expression.span));
          const test = classCheck
            ? `${value} instanceof ${this.typeRuntimeName(expression.type)}`
            : this.emitIsCheck(checked, value);
          const emittedValue = this.emitMappedExpression(expression.value);
          // Keep the common one-read checks direct. Union, optional, and
          // structural checks that reference the value more than once capture
          // it first so an arbitrary source expression still runs exactly once.
          const uses = test.split(value).length - 1;
          // GRM-D1: a nested `is` (or unary) operand spliced into the direct
          // check would rebind under the generated operator — `typeof typeof
          // x` — so those operands keep explicit parentheses.
          const operand = expression.value.kind === "IsExpression" || expression.value.kind === "UnaryExpression"
            ? `(${emittedValue})`
            : emittedValue;
          const result = uses === 1
            ? classCheck
              ? `${operand} instanceof ${this.typeRuntimeName(expression.type)}`
              : this.emitIsCheck(checked, operand)
            : `(${value} => ${test})(${emittedValue})`;
          return expression.operator === "is not" ? `!(${result})` : result;
        }
      case "ArrowFunctionExpression": {
        const body = this.emitMappedExpression(expression.body);
        const resolvedBody = this.hints.asyncResolvedValues.has(spanIdentity(expression.body.span)) ? `__velarAsyncResolvedValue(${body})` : body;
        const emittedBody = expression.body.kind === "ObjectExpression" ? `(${resolvedBody})` : resolvedBody;
        return `${expression.asynchronous ? "async " : ""}${expression.parameters.length === 1 && !expression.parameters[0]!.rest && !expression.parameters[0]!.defaultValue
          ? expression.parameters[0]!.name
          : `(${expression.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ")})`} => ${emittedBody}`;
      }
      case "CallExpression": {
        if (expression.callee.kind === "MemberExpression") {
          const binaryHelper = this.binaryHelper(expression.callee);
          if (binaryHelper) {
            this.needsBinaryHelpers = true;
            const object = this.emitMappedExpression(expression.callee.object);
            const sourceArguments = expression.arguments.map((argument) => this.emitMappedExpression(argument));
            const namedOrder = this.hints.namedArgumentOrders.get(spanIdentity(expression.span));
            const arguments_ = namedOrder
              ? namedOrder.map((source) => source === -1 ? "undefined" : `__velarNamedArguments[${source}]`)
              : sourceArguments;
            const emittedArguments = namedOrder
              ? `...((__velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
              : arguments_.join(", ");
            const suffix = arguments_.length > 0 ? `, ${emittedArguments}` : "";
            const invocation = `${binaryHelper}(__velarValue${suffix})`;
            return this.hints.optionalCallees.has(spanIdentity(expression.span))
              ? `(__velarValue => __velarValue == null ? null : ${invocation})(${object})`
              : `${binaryHelper}(${object}${suffix})`;
          }
          const primitiveHelper = this.primitiveHelper(expression.callee);
          if (primitiveHelper) {
            this.needsPrimitiveHelpers = true;
            const object = this.emitMappedExpression(expression.callee.object);
            const sourceArguments = expression.arguments.map((argument) => this.emitMappedExpression(argument));
            const namedOrder = this.hints.namedArgumentOrders.get(spanIdentity(expression.span));
            const arguments_ = namedOrder
              ? namedOrder.map((source) => source === -1 ? "undefined" : `__velarNamedArguments[${source}]`)
              : sourceArguments;
            const emittedArguments = namedOrder
              ? `...((__velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
              : arguments_.join(", ");
            const suffix = arguments_.length > 0 ? `, ${emittedArguments}` : "";
            const invocation = `${primitiveHelper}(__velarValue${suffix})`;
            return this.hints.optionalCallees.has(spanIdentity(expression.span))
              ? `(__velarValue => __velarValue == null ? null : ${invocation})(${object})`
              : `${primitiveHelper}(${object}${suffix})`;
          }
          const helper = this.collectionHelper(expression.callee);
          if (helper) {
            this.needsCollectionHelpers = true;
            const object = this.emitMappedExpression(expression.callee.object);
            const sourceArguments = expression.arguments.map((argument) => this.emitMappedExpression(argument));
            const namedOrder = this.hints.namedArgumentOrders.get(spanIdentity(expression.span));
            const arguments_ = namedOrder
              ? namedOrder.map((source) => source === -1 ? "undefined" : `__velarNamedArguments[${source}]`)
              : sourceArguments;
            const emitArguments = (): string => namedOrder
              ? `...((__velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
              : arguments_.join(", ");
            const suffix = arguments_.length > 0 ? `, ${emitArguments()}` : "";
            if (this.hints.optionalCallees.has(spanIdentity(expression.span))) {
              const invocation = `${helper}(__velarValue${suffix})`;
              return `(__velarOptionalCollection(${object}, __velarValue => ${invocation}) ?? null)`;
            }
            return `${helper}(${object}${suffix})`;
          }
        }
        const hostBoundary = this.hints.javaScriptCallBoundaries.has(spanIdentity(expression.span));
        const sourceArguments = expression.arguments.map((argument) => {
          const emitted = this.emitMappedExpression(argument);
          return hostBoundary && argument.kind !== "SpreadExpression" ? `__velarHostRaw(${emitted})` : emitted;
        });
        const namedOrder = this.hints.namedArgumentOrders.get(spanIdentity(expression.span));
        const arguments_ = namedOrder
          ? namedOrder.map((source) => source === -1 ? "undefined" : `__velarNamedArguments[${source}]`)
          : sourceArguments;
        const emitArguments = (): string => namedOrder
          ? `...((__velarNamedArguments) => [${arguments_.join(", ")}])([${sourceArguments.join(", ")}])`
          : arguments_.join(", ");
        if (this.hints.optionalCallees.has(spanIdentity(expression.span))) {
          const call = expression.callee.kind === "MemberExpression"
            ? `${this.emitPostfixReceiver(expression.callee.object)}${expression.callee.optional ? "?." : "."}${expression.callee.property}?.(${emitArguments()})`
            : `${this.emitPostfixReceiver(expression.callee)}?.(${emitArguments()})`;
          return `(${call} ?? null)`;
        }
        if (expression.callee.kind === "MemberExpression" && expression.callee.optional) {
          const call = `${this.emitPostfixReceiver(expression.callee.object)}?.${expression.callee.property}(${emitArguments()})`;
          return `(${call} ?? null)`;
        }
        let callee: string;
        if (expression.callee.kind === "IdentifierExpression" && (expression.callee.name === "Map" || expression.callee.name === "Set")) {
          this.needsCollectionHelpers = true;
          callee = expression.callee.name === "Map" ? "__velarCreateMap" : "__velarCreateSet";
        } else if (expression.callee.kind === "IdentifierExpression" && this.hints.equalsCalls.has(spanIdentity(expression.span))) {
          this.needsCollectionHelpers = true;
          callee = "__velarEquals";
        } else {
          if (this.hints.constructorCalls.has(spanIdentity(expression.span))) {
            // A callee that is not a plain name path may be wrapped (for
            // example by a narrowing recheck IIFE), and `new (arrow)(x)(args)`
            // binds `(x)` as the construction arguments — the wrapper, not
            // the class, gets constructed. Parentheses restore the callee
            // boundary; plain name paths skip them to keep output readable.
            // Source-map markers are invisible in final output and ignored.
            const constructed = this.emitMappedExpression(expression.callee);
            callee = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*$/u.test(constructed.replaceAll(javaScriptNodeMarker, ""))
              ? `new ${constructed}`
              : `new (${constructed})`;
          } else {
            callee = this.emitPostfixReceiver(expression.callee);
          }
        }
        const formRead = this.hints.formReads.get(spanIdentity(expression.span));
        if (formRead) arguments_.push(JSON.stringify(formRead));
        const call = `${callee}(${emitArguments()})`;
        const result = this.hints.optionalCalls.has(spanIdentity(expression.span)) ? `(${call} ?? null)` : call;
        // BRG-U10: a synchronous non-Error throw from an extern call during
        // module initialization would reach the host raw (no catch, no
        // rejection path); rethrowing through the owned normalization keeps
        // the last bridge failure shape on the Error channel. Calls whose
        // arguments await are already rejection-owned and stay unwrapped.
        if (hostBoundary
          && this.hints.moduleTopLevelHostCalls.has(spanIdentity(expression.span))
          && !this.expressionContainsDirectAwait(expression)) {
          this.needsThrownValueHelper = true;
          return `(() => { try { return ${result}; } catch (__velarThrown) { throw __velarNormalizeError(__velarThrown); } })()`;
        }
        return result;
      }
      case "MemberExpression": {
        const binaryHelper = this.binaryHelper(expression);
        if (binaryHelper) {
          this.needsBinaryHelpers = true;
          const object = this.emitMappedExpression(expression.object);
          const bound = `(...__velarArguments) => ${binaryHelper}(__velarValue, ...__velarArguments)`;
          return expression.optional
            ? `(__velarValue => __velarValue == null ? null : ${bound})(${object})`
            : `(__velarValue => ${bound})(${object})`;
        }
        if (this.hints.binarySizes.has(expression.span.end)) {
          this.needsBinaryHelpers = true;
          const object = this.emitMappedExpression(expression.object);
          return expression.optional
            ? `(__velarValue => __velarValue == null ? null : __velarBinaryRuntime.__velarSize(__velarValue))(${object})`
            : `__velarBinaryRuntime.__velarSize(${object})`;
        }
        const primitiveHelper = this.primitiveHelper(expression);
        if (primitiveHelper) {
          this.needsPrimitiveHelpers = true;
          const object = this.emitMappedExpression(expression.object);
          const bound = `(...__velarArguments) => ${primitiveHelper}(__velarValue, ...__velarArguments)`;
          return expression.optional
            ? `(__velarValue => __velarValue == null ? null : ${bound})(${object})`
            : `(__velarValue => ${bound})(${object})`;
        }
        if (this.hints.stringSizes.has(expression.span.end)) {
          this.needsPrimitiveHelpers = true;
          const object = this.emitMappedExpression(expression.object);
          return expression.optional
            ? `(__velarValue => __velarValue == null ? null : __velarStringSize(__velarValue))(${object})`
            : `__velarStringSize(${object})`;
        }
        const collectionHelper = this.collectionHelper(expression);
        if (collectionHelper) {
          this.needsCollectionHelpers = true;
          const object = this.emitMappedExpression(expression.object);
          const bound = `(...__velarArguments) => ${collectionHelper}(__velarValue, ...__velarArguments)`;
          return expression.optional
            ? `(__velarValue => __velarValue == null ? null : ${bound})(${object})`
            : `(__velarValue => ${bound})(${object})`;
        }
        if (this.hints.collectionSizes.has(expression.span.end)) {
          this.needsCollectionHelpers = true;
          const object = this.emitMappedExpression(expression.object);
          return expression.optional
            ? `(__velarOptionalCollection(${object}, __velarCollectionSize) ?? null)`
            : `__velarCollectionSize(${object})`;
        }
        const staticFieldOwnerDepth = this.hints.staticFieldReads.get(spanIdentity(expression.span));
        if (staticFieldOwnerDepth !== undefined) {
          const object = this.emitMappedExpression(expression.object);
          const read = `__velarReadStaticField(__velarValue, ${JSON.stringify(expression.property)}, ${staticFieldOwnerDepth})`;
          return expression.optional
            ? `(__velarValue => __velarValue == null ? null : ${read})(${object})`
            : `__velarReadStaticField(${object}, ${JSON.stringify(expression.property)}, ${staticFieldOwnerDepth})`;
        }
        if (this.hints.errorCodeReads.has(spanIdentity(expression.span))) {
          this.needsErrorCodeHelper = true;
          const object = this.emitMappedExpression(expression.object);
          return expression.optional
            ? `($velarValue => $velarValue == null ? null : __velarErrorCode($velarValue))(${object})`
            : `__velarErrorCode(${object})`;
        }
        if (this.hints.instanceFieldReads.has(spanIdentity(expression.span))) {
          const object = this.emitMappedExpression(expression.object);
          const read = `__velarReadInstanceField(__velarValue, ${JSON.stringify(expression.property)})`;
          return expression.optional
            ? `(__velarValue => __velarValue == null ? null : ${read})(${object})`
            : `__velarReadInstanceField(${object}, ${JSON.stringify(expression.property)})`;
        }
        if (this.hints.privateInstanceFieldReads.has(spanIdentity(expression.span))) {
          if (expression.optional) {
            const object = this.emitMappedExpression(expression.object);
            const read = `__velarReadPrivateField(__velarValue.#${expression.property}, ${JSON.stringify(expression.property)})`;
            return `(__velarValue => __velarValue == null ? null : ${read})(${object})`;
          }
          return `__velarReadPrivateField(${this.emitPostfixReceiver(expression.object)}.#${expression.property}, ${JSON.stringify(expression.property)})`;
        }
        if (this.hints.classMethodReferences.has(spanIdentity(expression.span))) {
          // Methods live on the prototype, so a method read as a value
          // evaluates its receiver once and binds at the reference site —
          // the collection-method rule of charter section 8. `super` cannot
          // be captured by a temporary; it binds `this` directly.
          const property = `${this.hints.privateMembers.has(spanIdentity(expression.span)) ? "#" : ""}${expression.property}`;
          if (expression.object.kind === "SuperExpression") {
            return `super.${property}.bind(this)`;
          }
          const object = this.emitMappedExpression(expression.object);
          const bound = `__velarValue.${property}.bind(__velarValue)`;
          return expression.optional
            ? `(__velarValue => __velarValue == null ? null : ${bound})(${object})`
            : `(__velarValue => ${bound})(${object})`;
        }
        const publicProperty = expression.property;
        const property = `${this.hints.privateMembers.has(spanIdentity(expression.span)) ? "#" : ""}${publicProperty}`;
        const access = `${this.emitPostfixReceiver(expression.object)}${expression.optional ? "?." : "."}${property}`;
        return this.hints.optionalMembers.has(spanIdentity(expression.span)) ? `(${access} ?? null)` : access;
      }
      case "IndexExpression":
        {
          const binaryKind = this.hints.binaryIndexes.get(spanIdentity(expression.span));
          if (binaryKind) {
            this.needsBinaryHelpers = true;
            const helper = this.binaryIndexHelper(binaryKind);
            const object = this.emitMappedExpression(expression.object);
            if (this.hints.optionalIndexes.has(spanIdentity(expression.span))) {
              return `(__velarValue => __velarValue == null ? null : __velarBinaryRuntime.${helper}(__velarValue, ${this.emitMappedExpression(expression.index)}))(${object})`;
            }
            return `__velarBinaryRuntime.${helper}(${object}, ${this.emitMappedExpression(expression.index)})`;
          }
        }
        this.needsIndexHelpers = true;
        this.needsCollectionHelpers = true;
        return this.hints.optionalIndexes.has(spanIdentity(expression.span))
          ? `__velarOptionalIndex(${this.emitMappedExpression(expression.object)}, () => ${this.emitMappedExpression(expression.index)})`
          : `__velarIndex(${this.emitMappedExpression(expression.object)}, ${this.emitMappedExpression(expression.index)})`;
      default:
        return "null";
    }
  }

  // A 'bool?' condition asks whether the value is true, so it lowers to an
  // explicit '=== true'. Both 'false' and an absent value then take the same
  // else path instead of riding on JavaScript truthiness.
  protected emitCondition(expression: Expression): string {
    const value = this.emitMappedExpression(expression);
    return this.hints.truthConditions.has(spanIdentity(expression.span)) ? `(${value} === true)` : value;
  }

  private emitBinaryOperand(expression: Expression): string {
    const emitted = this.emitMappedExpression(expression);
    return expression.kind === "ArrowFunctionExpression" ? `(${emitted})` : emitted;
  }

  private emitPostfixReceiver(expression: Expression): string {
    const emitted = this.emitMappedExpression(expression);
    if (expression.kind === "ArrowFunctionExpression"
      || expression.kind === "UnaryExpression"
      || expression.kind === "IsExpression"
      || (expression.kind === "LiteralExpression" && typeof expression.value === "number")) {
      return `(${emitted})`;
    }
    return emitted;
  }

  private emitComparisonChain(expression: Extract<Expression, { kind: "ComparisonChainExpression" }>): string {
    const prefix = `__velarCompare${expression.span.start}`;
    const body = [`const ${prefix}_0 = ${this.emitMappedExpression(expression.operands[0]!)};`];
    for (let index = 1; index < expression.operands.length; index += 1) {
      body.push(`const ${prefix}_${index} = ${this.emitMappedExpression(expression.operands[index]!)};`);
      const sourceOperator = expression.operators[index - 1]!;
      const linkSpan = spanIdentity({
        start: expression.operands[index - 1]!.span.start,
        end: expression.operands[index]!.span.end,
      });
      if ((sourceOperator === "==" || sourceOperator === "!=") && this.hints.sameValueZeroEqualities.has(linkSpan)) {
        // Chain operands are already captured once, so the SameValueZero
        // repair inlines as its short-circuit shape (D36 item 41).
        const left = `${prefix}_${index - 1}`;
        const right = `${prefix}_${index}`;
        const equality = `${left} === ${right} || (${left} !== ${left} && ${right} !== ${right})`;
        body.push(sourceOperator === "=="
          ? `if (!(${equality})) return false;`
          : `if (${equality}) return false;`);
        continue;
      }
      // TXT-D1: string chain links compare by code point too.
      if (["<", "<=", ">", ">="].includes(sourceOperator) && this.hints.stringOrderings.has(linkSpan)) {
        this.needsPrimitiveHelpers = true;
        body.push(`if (!(__velarStringCompare(${prefix}_${index - 1}, ${prefix}_${index}) ${sourceOperator} 0)) return false;`);
        continue;
      }
      if (["<", "<=", ">", ">="].includes(sourceOperator) && this.hints.dynamicOrderings.has(linkSpan)) {
        this.needsPrimitiveHelpers = true;
        body.push(`if (!(__velarOrderCompare(${prefix}_${index - 1}, ${prefix}_${index}) ${sourceOperator} 0)) return false;`);
        continue;
      }
      const operator = sourceOperator === "==" ? "===" : sourceOperator === "!=" ? "!==" : sourceOperator;
      body.push(`if (!(${prefix}_${index - 1} ${operator} ${prefix}_${index})) return false;`);
    }
    const asynchronous = expression.operands.some((operand) => this.expressionContainsDirectAwait(operand));
    return `${asynchronous ? "await " : ""}(${asynchronous ? "async " : ""}() => { ${body.join(" ")} return true; })()`;
  }

  protected expressionContainsDirectAwait(expression: Expression): boolean {
    return containsDirectAwait(expression, (value, contains) => this.extensionExpressionContainsDirectAwait(value, contains));
  }

  private typeRuntimeName(reference: TypeReference): string {
    const type = resolveTypeReference(reference);
    if (type.kind === "named") return this.builtinErrorRuntimeName(type.name) ?? type.name;
    return formatTypeReference(reference);
  }

  private collectionHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null {
    switch (this.hints.collectionCalls.get(expression.span.end)) {
      case "get": return "__velarCollectionGet";
      case "slice": return "__velarCollectionSlice";
      case "listAppend": return "__velarListAppend";
      case "listExtend": return "__velarListExtend";
      case "listInsert": return "__velarListInsert";
      case "listRemove": return "__velarListRemove";
      case "listPop": return "__velarListPop";
      case "listCopy": return "__velarListCopy";
      case "listCount": return "__velarListCount";
      case "listFind": return "__velarListFind";
      case "listIndex": return "__velarListIndex";
      case "listSome": return "__velarListSome";
      case "listEvery": return "__velarListEvery";
      case "listMap": return "__velarListMap";
      case "listFilter": return "__velarListFilter";
      case "listFlatMap": return "__velarListFlatMap";
      case "listReduce": return "__velarListReduce";
      case "listJoin": return "__velarListJoin";
      case "listSorted": return "__velarListSorted";
      case "listReversed": return "__velarListReversed";
      case "listSum": return "__velarListSum";
      case "listMin": return "__velarListMin";
      case "listMax": return "__velarListMax";
      case "setAdd": return "__velarSetAdd";
      case "setUpdate": return "__velarSetUpdate";
      case "setCopy": return "__velarSetCopy";
      case "setUnion": return "__velarSetUnion";
      case "setIntersection": return "__velarSetIntersection";
      case "setDifference": return "__velarSetDifference";
      case "mapSet": return "__velarMapSet";
      case "mapUpdate": return "__velarMapUpdate";
      case "mapCopy": return "__velarMapCopy";
      case "recordSet": return "__velarRecordSet";
      case "recordCopy": return "__velarRecordCopy";
      case "has": return "__velarCollectionHas";
      case "remove": return "__velarCollectionRemove";
      case "clear": return "__velarCollectionClear";
      case "keys": return "__velarCollectionKeys";
      case "values": return "__velarCollectionValues";
      case "entries": return "__velarCollectionEntries";
      default: return null;
    }
  }

  private binaryHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null {
    switch (this.hints.binaryCalls.get(expression.span.end)) {
      case "bufferCopy": return "__velarBinaryRuntime.__velarBufferCopy";
      case "bufferSlice": return "__velarBinaryRuntime.__velarBufferSlice";
      case "bufferToBytes": return "__velarBinaryRuntime.__velarBufferToBytes";
      default: return null;
    }
  }

  private binaryIndexHelper(kind: BinaryStorageKind): string {
    switch (kind) {
      case "bytes": return "__velarIndex";
      case "uint8": return "__velarUInt8Index";
      case "uint16": return "__velarUInt16Index";
      case "uint32": return "__velarUInt32Index";
      case "float32": return "__velarFloat32Index";
    }
  }

  private binarySetIndexHelper(kind: Exclude<BinaryStorageKind, "bytes">): string {
    switch (kind) {
      case "uint8": return "__velarUInt8SetIndex";
      case "uint16": return "__velarUInt16SetIndex";
      case "uint32": return "__velarUInt32SetIndex";
      case "float32": return "__velarFloat32SetIndex";
    }
  }

  private primitiveHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null {
    switch (this.hints.primitiveCalls.get(expression.span.end)) {
      case "stringTrim": return "__velarStringTrim";
      case "stringUpper": return "__velarStringUpper";
      case "stringLower": return "__velarStringLower";
      case "stringSlice": return "__velarStringSlice";
      case "stringChar": return "__velarStringChar";
      case "stringHas": return "__velarStringHas";
      case "stringIndex": return "__velarStringIndex";
      case "stringCount": return "__velarStringCount";
      case "stringStartsWith": return "__velarStringStartsWith";
      case "stringEndsWith": return "__velarStringEndsWith";
      case "stringSplit": return "__velarStringSplit";
      case "stringReplace": return "__velarStringReplace";
      case "stringReplaceAll": return "__velarStringReplaceAll";
      case "stringPadStart": return "__velarStringPadStart";
      case "stringPadEnd": return "__velarStringPadEnd";
      case "stringRepeat": return "__velarStringRepeat";
      case "stringIsBlank": return "__velarStringIsBlank";
      case "numberAbs": return "__velarNumberAbs";
      case "numberRound": return "__velarNumberRound";
      case "numberFloor": return "__velarNumberFloor";
      case "numberCeil": return "__velarNumberCeil";
      case "numberToFixed": return "__velarNumberToFixed";
      case "numberIsInteger": return "__velarNumberIsInteger";
      case "numberIsNaN": return "__velarNumberIsNaN";
      case "numberIsFinite": return "__velarNumberIsFinite";
      default: return null;
    }
  }

  protected emitObjectKey(name: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
  }

  private emitMatchPatternAttempt(
    pattern: MatchPattern,
    valueName: string,
    indentation: string,
  ): {
    readonly lines: readonly string[];
    readonly bindings: readonly { readonly name: string; readonly value: string }[];
  } {
    const lines: string[] = [];
    const bindings = new Map<string, string>();
    let nextTemporary = 0;
    const temporary = (label: string): string => `__velarPattern${pattern.span.start}${label}${nextTemporary++}`;
    const bind = (name: string, value: string): void => {
      if (name !== "_" && !bindings.has(name)) bindings.set(name, value);
    };
    const rejectUnless = (condition: string): void => {
      lines.push(`${indentation}if (!(${condition})) return null;`);
    };

    const emit = (current: MatchPattern, value: string): void => {
      switch (current.kind) {
        case "MatchWildcardPattern":
          break;
        case "MatchCapturePattern":
          bind(current.binding.name, value);
          break;
        case "MatchAsPattern":
          emit(current.pattern, value);
          bind(current.binding.name, value);
          break;
        case "MatchValuePattern":
          // ENM-D2: a candidate whose value can be NaN compares by
          // SameValueZero so `case box.nan:` agrees with `==` (charter
          // section 8); every other candidate keeps plain `===`.
          rejectUnless(current.values.map((candidate) => {
            if (this.hints.sameValueZeroMatchValues.has(spanIdentity(candidate.span))) {
              this.needsCollectionHelpers = true;
              return `__velarSameValueZero(${value}, ${this.emitMappedExpression(candidate)})`;
            }
            return `${value} === ${this.emitMappedExpression(candidate)}`;
          }).join(" || ") || "false");
          break;
        case "MatchTypePattern":
          rejectUnless(this.emitTypeCheck(resolveTypeReference(current.type), value));
          break;
        case "MatchListPattern": {
          this.needsCollectionHelpers = true;
          this.needsDirectCollectionInfrastructure = true;
          const items = temporary("List");
          const length = current.elements.length;
          lines.push(`${indentation}__velarReactiveCollectionTrack(${value});`);
          rejectUnless(`__velarCollectionListIsArray(${value})`);
          const lengthDescriptor = temporary("Length");
          const listLength = temporary("Size");
          lines.push(`${indentation}const ${lengthDescriptor} = __velarCollectionListGetOwnPropertyDescriptor(${value}, "length");`);
          rejectUnless(`${lengthDescriptor} && ${lengthDescriptor}.writable && !${lengthDescriptor}.enumerable && !${lengthDescriptor}.configurable && "value" in ${lengthDescriptor}`);
          lines.push(`${indentation}const ${listLength} = ${lengthDescriptor}.value;`);
          rejectUnless(`${listLength} <= __velarMaxCollectionItems && ${listLength} ${current.rest ? ">=" : "==="} ${length} && __velarCollectionListOwnSymbols(${value}).length === 0 && __velarCollectionListOwnNames(${value}).length === ${listLength} + 1`);
          lines.push(`${indentation}const ${items} = new __velarCollectionNativeArray(${listLength});`);
          const cursor = temporary("Index");
          const descriptor = temporary("Item");
          lines.push(`${indentation}for (let ${cursor} = 0; ${cursor} < ${listLength}; ${cursor} += 1) {`);
          lines.push(`${indentation}  const ${descriptor} = __velarCollectionListGetOwnPropertyDescriptor(${value}, ${cursor});`);
          lines.push(`${indentation}  if (!${descriptor}?.enumerable || !${descriptor}.configurable || !${descriptor}.writable || !("value" in ${descriptor})) return null;`);
          lines.push(`${indentation}  __velarCollectionListDefineProperty(${items}, ${cursor}, { value: __velarReactiveCollectionRead(${value}, ${cursor}, ${descriptor}.value), writable: true, enumerable: true, configurable: true });`);
          lines.push(`${indentation}}`);
          current.elements.forEach((child, index) => emit(child, `${items}[${index}]`));
          if (current.rest) {
            const rest = temporary("Rest");
            const restCursor = temporary("RestIndex");
            lines.push(`${indentation}const ${rest} = new __velarCollectionNativeArray(${listLength} - ${length});`);
            lines.push(`${indentation}for (let ${restCursor} = ${length}; ${restCursor} < ${listLength}; ${restCursor} += 1) {`);
            lines.push(`${indentation}  __velarCollectionListDefineProperty(${rest}, ${restCursor} - ${length}, { value: ${items}[${restCursor}], writable: true, enumerable: true, configurable: true });`);
            lines.push(`${indentation}}`);
            bind(current.rest.name, rest);
          }
          break;
        }
        case "MatchObjectPattern": {
          this.needsCollectionHelpers = true;
          this.needsDirectCollectionInfrastructure = true;
          rejectUnless(`${value} !== null && typeof ${value} === "object" && !__velarCollectionListIsArray(${value})`);
          for (const entry of current.entries) {
            const descriptor = temporary("Field");
            const fieldValue = temporary("Value");
            lines.push(`${indentation}__velarReactiveCollectionTrack(${value}, ${JSON.stringify(entry.property)});`);
            lines.push(`${indentation}const ${descriptor} = __velarCollectionRecordGetOwnPropertyDescriptor(${value}, ${JSON.stringify(entry.property)});`);
            rejectUnless(`${descriptor}?.enumerable && "value" in ${descriptor}`);
            lines.push(`${indentation}const ${fieldValue} = __velarReactiveCollectionRead(${value}, ${JSON.stringify(entry.property)}, ${descriptor}.value);`);
            emit(entry.pattern, fieldValue);
          }
          if (current.rest) {
            const rest = temporary("Rest");
            const key = temporary("Key");
            const descriptor = temporary("RestField");
            const selected = current.entries.map((entry) => `${key} === ${JSON.stringify(entry.property)}`).join(" || ") || "false";
            rejectUnless(`__velarCollectionRecordOwnSymbols(${value}).length === 0`);
            lines.push(`${indentation}__velarReactiveCollectionTrack(${value});`);
            lines.push(`${indentation}const ${rest} = {};`);
            const fields = temporary("Fields");
            const fieldIndex = temporary("FieldIndex");
            lines.push(`${indentation}const ${fields} = __velarCollectionRecordOwnNames(${value});`);
            rejectUnless(`${fields}.length <= __velarMaxCollectionItems`);
            lines.push(`${indentation}for (let ${fieldIndex} = 0; ${fieldIndex} < ${fields}.length; ${fieldIndex} += 1) {`);
            lines.push(`${indentation}  const ${key} = ${fields}[${fieldIndex}];`);
            lines.push(`${indentation}  if (${selected}) continue;`);
            lines.push(`${indentation}  const ${descriptor} = __velarCollectionRecordGetOwnPropertyDescriptor(${value}, ${key});`);
            lines.push(`${indentation}  if (!${descriptor}?.enumerable) continue;`);
            lines.push(`${indentation}  if (!("value" in ${descriptor})) return null;`);
            lines.push(`${indentation}  __velarCollectionRecordDefineProperty(${rest}, ${key}, { value: __velarReactiveCollectionRead(${value}, ${key}, ${descriptor}.value), writable: true, enumerable: true, configurable: true });`);
            lines.push(`${indentation}}`);
            bind(current.rest.name, rest);
          }
          break;
        }
      }
    };

    emit(pattern, valueName);
    return { lines, bindings: [...bindings].map(([name, value]) => ({ name, value })) };
  }

  protected emitBindingPatternStatements(
    pattern: BindingPattern,
    value: string,
    binding: "const" | "let",
    exported: boolean,
    depth: number,
    label: string,
  ): readonly string[] {
    const lines: string[] = [];
    const indentation = "  ".repeat(depth);
    let temporary = 0;
    const nextTemporary = (kind: string, current: BindingPattern): string => `__velarBinding${kind}${current.span.start}_${temporary++}`;
    const declare = (name: string, expression: string): void => {
      lines.push(`${indentation}${exported ? "export " : ""}${binding} ${name} = ${expression};`);
    };
    const emit = (current: BindingPattern, currentValue: string): void => {
      if (current.kind === "NameBindingPattern") {
        declare(current.name, currentValue);
        return;
      }
      if (current.kind === "ObjectBindingPattern") {
        this.needsCollectionHelpers = true;
        this.needsObjectBindingHelpers = true;
        const object = nextTemporary("Object", current);
        lines.push(`${indentation}const ${object} = __velarRequireBindingObject(${currentValue}, ${JSON.stringify(label)});`);
        for (const entry of current.entries) {
          const read = `__velarReadBindingField(${object}, ${JSON.stringify(entry.property)}, ${this.hints.optionalBindingEntries.has(entry.span.start)}, ${JSON.stringify(label)})`;
          if (entry.pattern.kind === "NameBindingPattern") {
            declare(entry.pattern.name, read);
          } else {
            const field = nextTemporary("Field", entry.pattern);
            lines.push(`${indentation}const ${field} = ${read};`);
            emit(entry.pattern, field);
          }
        }
        if (current.rest) {
          declare(
            current.rest.name,
            `__velarBindingObjectRest(${object}, ${JSON.stringify(current.entries.map((entry) => entry.property))}, ${JSON.stringify(label)})`,
          );
        }
        return;
      }

      this.needsCollectionHelpers = true;
      this.needsListBindingHelpers = true;
      const list = nextTemporary("List", current);
      lines.push(`${indentation}const ${list} = __velarRequireBindingList(${currentValue}, ${current.elements.length}, ${current.rest !== null}, ${JSON.stringify(label)});`);
      current.elements.forEach((element, index) => {
        if (!element) return;
        const read = `__velarReadBindingListItem(${list}, ${index})`;
        if (element.kind === "NameBindingPattern") {
          declare(element.name, read);
        } else {
          const item = nextTemporary("Item", element);
          lines.push(`${indentation}const ${item} = ${read};`);
          emit(element, item);
        }
      });
      if (current.rest) {
        declare(current.rest.name, `__velarBindingListRest(${list}, ${current.elements.length})`);
      }
    };

    emit(pattern, value);
    return lines;
  }

  private escapeTemplateText(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("\r", "\\r").replaceAll("`", "\\`").replaceAll("${", "\\${");
  }

  protected blockAlwaysReturns(statements: readonly Statement[]): boolean {
    for (const statement of statements) {
      if (statement.kind === "ReturnStatement" || statement.kind === "ThrowStatement") return true;
      if (statement.kind === "IfStatement" && statement.elseBody
        && this.blockAlwaysReturns(statement.thenBody) && this.blockAlwaysReturns(statement.elseBody)) return true;
      if (statement.kind === "MatchStatement" && this.hints.exhaustiveMatches.has(statement.span.start)
        && statement.cases.every((branch) => this.blockAlwaysReturns(branch.body))) return true;
      if (statement.kind === "TryStatement") {
        if (statement.finallyBody && this.blockAlwaysReturns(statement.finallyBody)) return true;
        if (statement.catchBody && this.blockAlwaysReturns(statement.tryBody) && this.blockAlwaysReturns(statement.catchBody)) return true;
      }
    }
    return false;
  }
}

function javaScriptIdentifiers(sources: readonly string[]): ReadonlySet<string> {
  const identifiers = new Set<string>();
  const identifierStart = (character: string): boolean => /[A-Za-z_$]/u.test(character);
  const identifierPart = (character: string): boolean => /[A-Za-z0-9_$]/u.test(character);

  for (const source of sources) {
    let index = 0;
    const skipQuoted = (quote: "'" | '"'): void => {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index] === quote) { index += 1; return; }
        else index += 1;
      }
    };
    const skipLineComment = (): void => {
      index += 2;
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
    };
    const skipBlockComment = (): void => {
      index += 2;
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") { index += 2; return; }
        index += 1;
      }
    };

    let scanCode!: (templateExpression: boolean) => void;
    const skipTemplate = (): void => {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index] === "`") { index += 1; return; }
        else if (source[index] === "$" && source[index + 1] === "{") {
          index += 2;
          scanCode(true);
        } else index += 1;
      }
    };
    scanCode = (templateExpression: boolean): void => {
      let braceDepth = 0;
      while (index < source.length) {
        const character = source[index]!;
        if (character === "'" || character === '"') { skipQuoted(character); continue; }
        if (character === "`") { skipTemplate(); continue; }
        if (character === "/" && source[index + 1] === "/") { skipLineComment(); continue; }
        if (character === "/" && source[index + 1] === "*") { skipBlockComment(); continue; }
        if (character === "{") { braceDepth += 1; index += 1; continue; }
        if (character === "}" && templateExpression) {
          if (braceDepth === 0) { index += 1; return; }
          braceDepth -= 1;
          index += 1;
          continue;
        }
        if (identifierStart(character)) {
          const start = index;
          index += 1;
          while (index < source.length && identifierPart(source[index]!)) index += 1;
          identifiers.add(source.slice(start, index));
          continue;
        }
        index += 1;
      }
    };
    scanCode(false);
  }
  return identifiers;
}

const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeVlq(value: number): string {
  let remaining = value < 0 ? ((-value) << 1) | 1 : value << 1;
  let output = "";
  do {
    let digit = remaining & 31;
    remaining >>>= 5;
    if (remaining > 0) digit |= 32;
    output += base64[digit];
  } while (remaining > 0);
  return output;
}

function generatedLineAt(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle]! <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

function sourceMapFor(code: string, generatedMappings: readonly GeneratedMapping[], source: SourceText): string {
  const lineStarts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] === "\n") lineStarts.push(index + 1);
  }
  const byLine = new Map<number, Array<{ column: number; span: Span }>>();
  for (const mapping of generatedMappings) {
    const line = generatedLineAt(lineStarts, mapping.offset);
    const entries = byLine.get(line) ?? [];
    entries.push({ column: mapping.offset - lineStarts[line]!, span: mapping.sourceSpan });
    byLine.set(line, entries);
  }
  let previousSource = 0;
  let previousLine = 0;
  let previousColumn = 0;
  const mappings = lineStarts.map((_, line) => {
    let previousGeneratedColumn = 0;
    return (byLine.get(line) ?? []).sort((left, right) => left.column - right.column).map((mapped) => {
      const location = source.location(mapped.span.start);
      const originalLine = location.line - 1;
      const originalColumn = location.column - 1;
      const segment = [
        encodeVlq(mapped.column - previousGeneratedColumn),
        encodeVlq(-previousSource),
        encodeVlq(originalLine - previousLine),
        encodeVlq(originalColumn - previousColumn),
      ].join("");
      previousGeneratedColumn = mapped.column;
      previousSource = 0;
      previousLine = originalLine;
      previousColumn = originalColumn;
      return segment;
    }).join(",");
  }).join(";");
  return JSON.stringify({
    version: 3,
    // Source-map sources are URLs, not host path strings. A Windows drive path
    // starts with what URL parsers treat as a scheme (`C:`), so Node cannot
    // map the generated frame back to VelarScript unless the drive path is a
    // real file URL. POSIX and project-relative paths keep their existing form.
    sources: [/^[A-Za-z]:[\\/]/u.test(source.path)
      ? `file:///${source.path.replaceAll("\\", "/")}`
      : source.path.replaceAll("\\", "/")],
    sourcesContent: [source.text],
    names: [],
    mappings,
  });
}

function mappedSource(source: string, sourceStart: number): { readonly code: string; readonly mappings: readonly GeneratedMapping[] } {
  const mappings: GeneratedMapping[] = source.length > 0
    ? [{ offset: 0, sourceSpan: { start: sourceStart, end: sourceStart + 1 } }]
    : [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\n" || index + 1 >= source.length) continue;
    mappings.push({
      offset: index + 1,
      sourceSpan: { start: sourceStart + index + 1, end: sourceStart + index + 2 },
    });
  }
  return { code: source, mappings };
}

function emitCheckedEmbeddedJavaScript(
  statement: EmbeddedJavaScriptDeclaration,
  factoryName: string,
): { readonly code: string; readonly mappings: readonly GeneratedMapping[] } {
  const relative = (value: Span): Span => ({
    start: value.start - statement.sourceSpan.start,
    end: value.end - statement.sourceSpan.start,
  });
  const blank = (value: string): string => value.replace(/[^\r\n]/gu, " ");
  const body = [...statement.factoryEdits]
    .sort((left, right) => right.span.start - left.span.start)
    .reduce((current, edit) => {
      const target = relative(edit.span);
      const replacement = edit.replacement + blank(current.slice(target.start + edit.replacement.length, target.end));
      return `${current.slice(0, target.start)}${replacement}${current.slice(target.end)}`;
    }, statement.source);

  let code = "";
  const mappings: GeneratedMapping[] = [];
  const appendMapped = (value: string, absoluteStart: number): void => {
    const mapped = mappedSource(value, absoluteStart);
    const offset = code.length;
    code += value;
    mappings.push(...mapped.mappings.map((mapping) => ({ ...mapping, offset: offset + mapping.offset })));
  };
  for (const imported of statement.imports) {
    const target = relative(imported.span);
    appendMapped(statement.source.slice(target.start, target.end), imported.span.start);
    if (!code.endsWith("\n") && !code.endsWith("\r")) code += "\n";
  }
  code += `export function ${factoryName}(${statement.captures.map((capture) => capture.name).join(", ")}) {\n`;
  appendMapped(body, statement.sourceSpan.start);
  if (code.length > 0 && !code.endsWith("\n") && !code.endsWith("\r")) code += "\n";
  const entries = statement.exports.map((item) => `${JSON.stringify(item.name)}: ${item.local}`).join(", ");
  code += `return { ${entries} };\n}\n`;
  return { code, mappings };
}
