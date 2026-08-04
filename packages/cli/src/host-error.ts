import { types as utilityTypes } from "node:util";

const NativeError = Error;
const nativeErrorCheck = utilityTypes.isNativeError;
const getOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const primitiveToString = String;

const MAX_HOST_ERROR_TEXT_LENGTH = 64 * 1024;
const NON_ERROR_MESSAGE = "A non-Error value was thrown by JavaScript";
const EMPTY_ERROR_MESSAGE = "An Error was thrown without a message";

function isNativeError(value: unknown): value is Error {
  return nativeErrorCheck(value);
}

function boundedText(value: string): string {
  return value.length <= MAX_HOST_ERROR_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_HOST_ERROR_TEXT_LENGTH)}…`;
}

function ownString(value: Error, property: "message" | "stack" | "code"): string | null {
  const descriptor = getOwnPropertyDescriptor(value, property);
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? boundedText(descriptor.value)
    : null;
}

export function hostErrorMessage(value: unknown): string {
  if (isNativeError(value)) return ownString(value, "message") || EMPTY_ERROR_MESSAGE;
  const kind = typeof value;
  if (kind === "string") return boundedText(value as string);
  if (value === null) return "null";
  if (kind === "undefined") return "undefined";
  if (kind === "number" || kind === "boolean" || kind === "bigint" || kind === "symbol") {
    return boundedText(primitiveToString(value));
  }
  return NON_ERROR_MESSAGE;
}

export function hostErrorStack(value: unknown): string {
  if (isNativeError(value)) return ownString(value, "stack") || ownString(value, "message") || EMPTY_ERROR_MESSAGE;
  return hostErrorMessage(value);
}

export function hostErrorCode(value: unknown): string | null {
  return isNativeError(value) ? ownString(value, "code") : null;
}

export function isHostErrorCode(value: unknown, code: string): boolean {
  return hostErrorCode(value) === code;
}

export function asHostError(value: unknown): Error {
  return isNativeError(value)
    ? value
    : new NativeError(hostErrorMessage(value), { cause: value });
}
