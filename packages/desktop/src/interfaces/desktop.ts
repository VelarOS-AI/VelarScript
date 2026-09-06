import { optionalOf, type ValueType } from "@velarscript/compiler";
import { stringType, boolType, nullType, optionalStringType, functionType, promiseOf, listOf, objectType, moduleInterface, displayType, enumEntry } from "./types.ts";

const desktopPlatformIdentity = "velar/desktop#enum:DesktopPlatform";
const desktopPlatforms = new Set(["macos", "test"]);
const desktopPlatformWireValues = new Map([...desktopPlatforms].map((member) => [member, member]));
export const desktopPlatformType: ValueType = { kind: "enum", name: "DesktopPlatform", identity: desktopPlatformIdentity };
// The read-only system probes `permissionStatus` answers. `screenRecording` is
// one word here and `screen-recording` nowhere: an enum member is an identifier
// in this language, and the runtime gate requires the member to equal its own
// value, so the hyphenated spelling has no place to live.
export const systemPermission = enumEntry("velar/desktop", "SystemPermission", ["screenRecording", "accessibility", "microphone"]);
export const permissionStatus = enumEntry("velar/desktop", "PermissionStatus", ["granted", "denied", "undetermined"]);
export const powerState = enumEntry("velar/desktop", "PowerState", ["suspended", "resumed"]);
const powerStreamType: ValueType = { kind: "named", name: "PowerStream", identity: "velar/desktop#type:PowerStream" };
const droppedFilesStreamType: ValueType = { kind: "named", name: "DroppedFilesStream", identity: "velar/desktop#type:DroppedFilesStream" };
const droppedFilesType = objectType({ paths: listOf(stringType) });

export const desktopModuleInterface = moduleInterface(
  new Map<string, ValueType>([
    ["DesktopPlatform", { kind: "enumObject", name: "DesktopPlatform", identity: desktopPlatformIdentity, members: desktopPlatforms }],
    ["Display", { kind: "typeObject", name: "Display" }],
    ["DroppedFiles", { kind: "typeObject", name: "DroppedFiles" }],
    ["DroppedFilesStream", { kind: "typeObject", name: "DroppedFilesStream" }],
    ["PermissionStatus", permissionStatus.object],
    ["PowerState", powerState.object],
    ["PowerStream", { kind: "typeObject", name: "PowerStream" }],
    ["SystemPermission", systemPermission.object],
    ["platform", functionType([], desktopPlatformType)],
    ["packaged", functionType([], boolType)],
    ["homeDirectory", functionType([], promiseOf(stringType))],
    ["appDataDirectory", functionType([], promiseOf(stringType))],
    ["projectDirectory", functionType([], promiseOf(stringType))],
    ["selectedProjectDirectory", functionType([], promiseOf(optionalStringType))],
    ["selectProjectDirectory", functionType([], promiseOf(optionalStringType))],
    ["openExternal", functionType([stringType], promiseOf(nullType))],
    ["applyUpdate", functionType([stringType], promiseOf(nullType))],
    ["displays", functionType([], promiseOf(listOf(displayType)))],
    ["permissionStatus", functionType([systemPermission.value], promiseOf(permissionStatus.value))],
    ["watchPower", functionType([], promiseOf(powerStreamType))],
    ["watchDroppedFiles", functionType([], promiseOf(droppedFilesStreamType))],
  ]),
  new Map([
    ["PowerStream", new Map<string, ValueType>([
      ["next", functionType([], promiseOf(optionalOf(powerState.value)))],
      ["close", functionType([], promiseOf(nullType))],
    ])],
    ["DroppedFilesStream", new Map<string, ValueType>([
      ["next", functionType([], promiseOf(optionalOf(droppedFilesType)))],
      ["close", functionType([], promiseOf(nullType))],
    ])],
  ]),
  new Map([
    ["PowerStream", "velar/desktop#type:PowerStream"],
    ["DroppedFilesStream", "velar/desktop#type:DroppedFilesStream"],
  ]),
  new Map([
    ["DesktopPlatform", { identity: desktopPlatformIdentity, members: desktopPlatforms, wireValues: desktopPlatformWireValues }],
    ["PermissionStatus", permissionStatus.info],
    ["PowerState", powerState.info],
    ["SystemPermission", systemPermission.info],
  ]),
  new Map([["Display", displayType], ["DroppedFiles", droppedFilesType]]),
);
