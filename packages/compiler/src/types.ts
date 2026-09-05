/**
 * The type model's front door. `types.ts` was one 1,664-line module; D114 R1c
 * split it into `types/` by the question each part answers, and this facade
 * re-exports every name it published, so no import path in the repository
 * changed and `@velarscript/compiler`'s export list is untouched.
 *
 * Where to look:
 *
 *  - `types/model.ts`         the `ValueType` union, singletons, identity, constructors
 *  - `types/bounds.ts`        what a type-parameter bound grants, and its violations
 *  - `types/readonly.ts`      the readonly projection
 *  - `types/display.ts`       `describeType` and the generic application constructors
 *  - `types/from-syntax.ts`   written syntax to a type, and back to text
 *  - `types/unification.ts`   `mergeTypes` and the generic parameter solver
 *  - `types/assignability.ts` may this value stand where that type is expected
 */
export { analysisTypeIdentity, anyType, binaryStorageKind, boolType, boundaryUnknownType, genericApplicationIdentity, invalidType, isInvalidType, mapNestedTypes, nonOptional, nullType, numberType, optionalOf, resolvedAsyncType, sameType, sameTypeIgnoringCallableParameterNames, semanticTypeIdentity, stringType, textConvertibleType, typeContainsAnyOutput, typeContainsRuntimeTypeCheck, typeParameterBoundNames, unionOf, unknownType, VELAR_BYTES_TYPE_IDENTITY, VELAR_FLOAT32_BUFFER_TYPE_IDENTITY, VELAR_UINT16_BUFFER_TYPE_IDENTITY, VELAR_UINT32_BUFFER_TYPE_IDENTITY, VELAR_UINT8_BUFFER_TYPE_IDENTITY } from "./types/model.ts";
export type { BinaryStorageKind, EnumInfo, ExtensionTypeDisplay, ExtensionValueType, GenericApplication, GenericTypeInfo, TypeEnvironment, TypeParameterBound, ValueType } from "./types/model.ts";
export { boundAccepts, boundGrants, collectGenericBoundViolations, collectTypeArgumentBoundViolations, instantiateGenericCallable, isTypeParameterBound } from "./types/bounds.ts";
export type { BoundCapability, GenericBoundViolation } from "./types/bounds.ts";
export { isReadonlyView, mutableViewOf, readonlyViewOf } from "./types/readonly.ts";
export { classApplicationType, describeType, genericApplicationName, genericApplicationType } from "./types/display.ts";
export { formatTypeReference, formatTypeSyntax, resolveTypeReference, typeFromSyntax } from "./types/from-syntax.ts";
export type { ExtensionTypeSyntaxResolver } from "./types/from-syntax.ts";
export { bindNamedTypeParameters, mergeTypes, substituteTypeParameters, typeContainsParameter, unifyTypeParameters } from "./types/unification.ts";
export { isAssignable, isTextConvertibleType } from "./types/assignability.ts";
