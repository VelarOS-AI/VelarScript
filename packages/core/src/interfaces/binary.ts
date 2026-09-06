import { VELAR_BYTES_TYPE_IDENTITY, VELAR_FLOAT32_BUFFER_TYPE_IDENTITY, VELAR_UINT16_BUFFER_TYPE_IDENTITY, VELAR_UINT32_BUFFER_TYPE_IDENTITY, VELAR_UINT8_BUFFER_TYPE_IDENTITY, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { nullType, numberType, apiFunction, listNumber, moduleInterface } from "./types.ts";

const byteOrderIdentity = "velar/binary#enum:ByteOrder";
const byteOrderMembers = new Set(["little", "big"]);
const byteOrderWireValues = new Map([...byteOrderMembers].map((member) => [member, member]));
const byteOrderType: ValueType = { kind: "enum", name: "ByteOrder", identity: byteOrderIdentity };
const bytesType: ValueType = { kind: "named", name: "Bytes", identity: VELAR_BYTES_TYPE_IDENTITY };
const uint8BufferType: ValueType = { kind: "named", name: "UInt8Buffer", identity: VELAR_UINT8_BUFFER_TYPE_IDENTITY };
const uint16BufferType: ValueType = { kind: "named", name: "UInt16Buffer", identity: VELAR_UINT16_BUFFER_TYPE_IDENTITY };
const uint32BufferType: ValueType = { kind: "named", name: "UInt32Buffer", identity: VELAR_UINT32_BUFFER_TYPE_IDENTITY };
const float32BufferType: ValueType = { kind: "named", name: "Float32Buffer", identity: VELAR_FLOAT32_BUFFER_TYPE_IDENTITY };
const uint32BuilderType: ValueType = { kind: "named", name: "UInt32Builder", identity: "velar/binary#type:UInt32Builder" };
const float32BuilderType: ValueType = { kind: "named", name: "Float32Builder", identity: "velar/binary#type:Float32Builder" };
const binaryBufferFields = (type: ValueType, ordered: boolean): ReadonlyMap<string, ValueType> => new Map([
  ["size", numberType],
  ["copy", apiFunction([], [], type)],
  ["slice", apiFunction(["start", "end"], [numberType, numberType], type, 0)],
  ["toBytes", ordered ? apiFunction(["order"], [byteOrderType], bytesType) : apiFunction([], [], bytesType)],
  ["values", apiFunction([], [], listNumber)],
]);
const binaryBuilderFields = (type: ValueType): ReadonlyMap<string, ValueType> => new Map([
  ["size", numberType],
  ["maxElements", numberType],
  ["push", apiFunction(["value"], [numberType], nullType)],
  ["finish", apiFunction([], [], type)],
]);
const binaryNamedTypes = new Map([
  ["Bytes", new Map([
    ["size", numberType],
  ])],
  ["UInt8Buffer", binaryBufferFields(uint8BufferType, false)],
  ["UInt16Buffer", binaryBufferFields(uint16BufferType, true)],
  ["UInt32Buffer", binaryBufferFields(uint32BufferType, true)],
  ["Float32Buffer", binaryBufferFields(float32BufferType, true)],
  ["UInt32Builder", binaryBuilderFields(uint32BufferType)],
  ["Float32Builder", binaryBuilderFields(float32BufferType)],
]);
const binaryReadonlyFields = new Map([
  ["Bytes", new Set(["size"])],
  ["UInt8Buffer", new Set(["size", "copy", "slice", "toBytes", "values"])],
  ["UInt16Buffer", new Set(["size", "copy", "slice", "toBytes", "values"])],
  ["UInt32Buffer", new Set(["size", "copy", "slice", "toBytes", "values"])],
  ["Float32Buffer", new Set(["size", "copy", "slice", "toBytes", "values"])],
  ["UInt32Builder", new Set(["size", "maxElements", "push", "finish"])],
  ["Float32Builder", new Set(["size", "maxElements", "push", "finish"])],
]);

/** `velar/binary`: byte buffers, typed views, and their byte order. */
export const binaryModuleInterface: ModuleInterface = moduleInterface(
  new Map([
    ["ByteOrder", { kind: "enumObject", name: "ByteOrder", identity: byteOrderIdentity, members: byteOrderMembers }],
    ["Bytes", { kind: "typeObject", name: "Bytes", value: bytesType }],
    ["UInt8Buffer", { kind: "typeObject", name: "UInt8Buffer", value: uint8BufferType }],
    ["UInt16Buffer", { kind: "typeObject", name: "UInt16Buffer", value: uint16BufferType }],
    ["UInt32Buffer", { kind: "typeObject", name: "UInt32Buffer", value: uint32BufferType }],
    ["Float32Buffer", { kind: "typeObject", name: "Float32Buffer", value: float32BufferType }],
    ["UInt32Builder", { kind: "typeObject", name: "UInt32Builder", value: uint32BuilderType }],
    ["Float32Builder", { kind: "typeObject", name: "Float32Builder", value: float32BuilderType }],
    ["uint8Buffer", apiFunction(["size"], [numberType], uint8BufferType)],
    ["uint16Buffer", apiFunction(["size"], [numberType], uint16BufferType)],
    ["uint32Buffer", apiFunction(["size"], [numberType], uint32BufferType)],
    ["float32Buffer", apiFunction(["size"], [numberType], float32BufferType)],
    ["uint8FromBytes", apiFunction(["snapshot"], [bytesType], uint8BufferType)],
    ["uint16FromBytes", apiFunction(["snapshot", "order"], [bytesType, byteOrderType], uint16BufferType)],
    ["uint32FromBytes", apiFunction(["snapshot", "order"], [bytesType, byteOrderType], uint32BufferType)],
    ["float32FromBytes", apiFunction(["snapshot", "order"], [bytesType, byteOrderType], float32BufferType)],
    ["uint32Builder", apiFunction(["maxElements"], [numberType], uint32BuilderType)],
    ["float32Builder", apiFunction(["maxElements"], [numberType], float32BuilderType)],
  ]),
  new Map(),
  binaryNamedTypes,
  new Map(),
  binaryReadonlyFields,
  new Map([
    ["Bytes", VELAR_BYTES_TYPE_IDENTITY],
    ["UInt8Buffer", VELAR_UINT8_BUFFER_TYPE_IDENTITY],
    ["UInt16Buffer", VELAR_UINT16_BUFFER_TYPE_IDENTITY],
    ["UInt32Buffer", VELAR_UINT32_BUFFER_TYPE_IDENTITY],
    ["Float32Buffer", VELAR_FLOAT32_BUFFER_TYPE_IDENTITY],
    ["UInt32Builder", "velar/binary#type:UInt32Builder"],
    ["Float32Builder", "velar/binary#type:Float32Builder"],
  ]),
  new Map([["ByteOrder", { identity: byteOrderIdentity, members: byteOrderMembers, wireValues: byteOrderWireValues }]]),
);
