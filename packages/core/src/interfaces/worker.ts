import { optionalOf as optional, type GenericTypeInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { nullType, stringType, numberType, durationType, apiFunction, promise, moduleInterface } from "./types.ts";
import { cancellationType, taskErrorClass } from "./task.ts";

const workerIdentity = "velar/worker#type:Worker";
const workerPoolIdentity = "velar/worker#type:WorkerPool";
const workerRequestType: ValueType = { kind: "parameter", name: "Request", index: 0 };
const workerResponseType: ValueType = { kind: "parameter", name: "Response", index: 1 };
const workerApplication = (identity: string, name: string, request: ValueType, response: ValueType): ValueType => ({
  kind: "named", name: `${name}<Request, Response>`, identity,
  application: { declaration: identity, name, arguments: [request, response] },
});
const workerCallFields = new Map<string, ValueType>([
  ["call", { kind: "function", parameterNames: ["request", "cancellation", "timeout"], parameters: [workerRequestType, optional(cancellationType), optional(durationType)], requiredParameters: 1, result: promise(workerResponseType) }],
  ["close", apiFunction([], [], promise(nullType))],
]);
const workerPoolFields = new Map<string, ValueType>([
  ...workerCallFields,
  ["broadcast", { kind: "function", parameterNames: ["request", "cancellation", "timeout"], parameters: [workerRequestType, optional(cancellationType), optional(durationType)], requiredParameters: 1, result: promise({ kind: "list", element: workerResponseType }) }],
]);
const workerTemplate = (identity: string, name: string, fields: ReadonlyMap<string, ValueType>): GenericTypeInfo => ({
  identity, name, parameterNames: ["Request", "Response"], parameterBounds: [null, null], fields,
  readonlyFields: new Set(fields.keys()),
});
const workerErrorIdentities = new Map([
  ["WorkerBackpressureError", "velar/worker#class:WorkerBackpressureError"],
  ["WorkerCallError", "velar/worker#class:WorkerCallError"],
  ["WorkerCrashedError", "velar/worker#class:WorkerCrashedError"],
  ["WorkerClosedError", "velar/worker#class:WorkerClosedError"],
]);

/** `velar/worker`: typed request/response workers and pools. */
export const workerModuleInterface: ModuleInterface = moduleInterface(
  new Map([
    ["Worker", { kind: "typeObject", name: "Worker" }],
    ["WorkerPool", { kind: "typeObject", name: "WorkerPool" }],
    ...[...workerErrorIdentities].map(([name, identity]) => [name, { kind: "classConstructor", name, identity } as ValueType] as const),
    ["worker", { kind: "function", typeParameterNames: ["Request", "Response"], parameterNames: ["name", "RequestType", "ResponseType", "capacity"], parameters: [stringType, { kind: "runtimeType", value: workerRequestType }, { kind: "runtimeType", value: workerResponseType }, numberType], requiredParameters: 3, result: workerApplication(workerIdentity, "Worker", workerRequestType, workerResponseType) }],
    ["workerPool", { kind: "function", typeParameterNames: ["Request", "Response"], parameterNames: ["name", "RequestType", "ResponseType", "size", "capacity"], parameters: [stringType, { kind: "runtimeType", value: workerRequestType }, { kind: "runtimeType", value: workerResponseType }, numberType, numberType], requiredParameters: 4, result: workerApplication(workerPoolIdentity, "WorkerPool", workerRequestType, workerResponseType) }],
    ["serveWorker", { kind: "function", typeParameterNames: ["Request", "Response"], parameterNames: ["RequestType", "ResponseType", "handler", "capacity"], parameters: [
      { kind: "runtimeType", value: workerRequestType }, { kind: "runtimeType", value: workerResponseType },
      { kind: "function", parameterNames: ["request", "cancellation"], parameters: [workerRequestType, cancellationType], requiredParameters: 2, result: promise(workerResponseType) }, numberType,
    ], requiredParameters: 3, result: nullType }],
  ]),
  new Map([...workerErrorIdentities].map(([name, identity]) => [name, taskErrorClass(identity)])),
  new Map(), new Map(), new Map(), new Map(), new Map(),
  new Map([
    ["Worker", workerTemplate(workerIdentity, "Worker", workerCallFields)], [workerIdentity, workerTemplate(workerIdentity, "Worker", workerCallFields)],
    ["WorkerPool", workerTemplate(workerPoolIdentity, "WorkerPool", workerPoolFields)], [workerPoolIdentity, workerTemplate(workerPoolIdentity, "WorkerPool", workerPoolFields)],
  ]),
);
