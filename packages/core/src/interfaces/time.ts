import { optionalOf as optional, type ModuleInterface } from "@velarscript/compiler";
import { stringType, numberType, apiFunction, object, moduleInterface } from "./types.ts";

const timePartsType = object({
  year: numberType, month: numberType, day: numberType, weekday: numberType,
  hour: numberType, minute: numberType, second: numberType, millisecond: numberType,
});

/** `velar/time`. */
export const timeModuleInterface: ModuleInterface = moduleInterface(new Map([
  ["now", apiFunction([], [], numberType)],
  ["monotonic", apiFunction([], [], numberType)],
  ["parse", apiFunction(["value"], [stringType], optional(numberType))],
  ["iso", apiFunction(["value"], [numberType], stringType, 0)],
  // D104 rule 5: the two style arguments are how `format` answers for a part
  // of a time rather than the whole of it. `dateStyle="none"` is the
  // time-of-day rendering a message list wants, and it is the locale's own —
  // `parts()` plus hand-written zero padding gives every locale a
  // twenty-four-hour clock, which is wrong wherever the reader expects
  // AM/PM. Styles are `Intl`'s own vocabulary, projected rather than
  // reinvented: full, long, medium, short, and `none` for the half this call
  // leaves out.
  ["format", apiFunction(["value", "locale", "timeZone", "dateStyle", "timeStyle"], [numberType, stringType, stringType, stringType, stringType], stringType, 1)],
  ["date", apiFunction(["year", "month", "day", "hour", "minute", "second"], [numberType, numberType, numberType, numberType, numberType, numberType], numberType, 3)],
  ["utc", apiFunction(["year", "month", "day", "hour", "minute", "second"], [numberType, numberType, numberType, numberType, numberType, numberType], numberType, 3)],
  ["parts", apiFunction(["value", "timeZone"], [numberType, stringType], timePartsType, 1)],
]));
