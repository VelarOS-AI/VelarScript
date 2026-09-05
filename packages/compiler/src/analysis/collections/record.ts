/**
 * The Record operations: what one call of a compiler-owned Record member
 * answers.
 *
 * D115 §三: this was one private method of `CollectionInference`. Its cases run
 * in the order the one method evaluated them in, and it answers `null` for a
 * property Record does not publish. A Record is keyed by strings and holds one
 * value type, so nothing here judges a key domain and the host is one name.
 */
import {
  boolType,
  nullType,
  optionalOf,
  stringType,
  type ValueType,
} from "../../types.ts";
import { type CollectionCall, type CollectionLoweringFacts } from "./call.ts";

/** What the Record family asks of the analyzer that hosts it, and nothing more. */
export interface RecordCallsHost {
  /** What the emitter will lower each collection call to. */
  readonly lowering: CollectionLoweringFacts;
}

export class RecordCalls {
  private readonly host: RecordCallsHost;

  constructor(host: RecordCallsHost) {
    this.host = host;
  }

  /** The Record operations. */
  inferRecordCall(call: CollectionCall, object: Extract<ValueType, { kind: "record" }>): ValueType | null {
    if (call.member.property === "set") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordSet");
      call.checkCollectionArguments([stringType, object.value]);
      return nullType;
    }
    if (call.member.property === "get") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordGet");
      call.checkProbeArgument(stringType, "Record.get", "key");
      return optionalOf(call.readonlyValue!);
    }
    if (call.member.property === "keys") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordKeys");
      call.checkCollectionArguments([]);
      return { kind: "list", element: stringType };
    }
    if (call.member.property === "values") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordValues");
      call.checkCollectionArguments([]);
      return { kind: "list", element: call.readonlyValue! };
    }
    if (call.member.property === "entries") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordEntries");
      call.checkCollectionArguments([]);
      return { kind: "list", element: { kind: "object", fields: new Map([["key", stringType], ["value", call.readonlyValue!]]) } };
    }
    if (call.member.property === "has") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordHas");
      call.checkProbeArgument(stringType, "Record.has", "key");
      return boolType;
    }
    if (call.member.property === "remove") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordRemove");
      call.checkProbeArgument(stringType, "Record.remove", "key");
      return boolType;
    }
    if (call.member.property === "clear") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordClear");
      call.checkCollectionArguments([]);
      return nullType;
    }
    if (call.member.property === "copy") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordCopy");
      call.checkCollectionArguments([]);
      return { kind: "record", value: call.readonlyValue! };
    }
    return null;
  }
}
