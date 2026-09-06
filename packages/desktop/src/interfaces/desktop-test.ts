import { stringType, boolType, numberType, nullType, optionalStringType, functionType, promiseOf, listOf, moduleInterface, windowBoundsType } from "./types.ts";
import { desktopPlatformType, permissionStatus, powerState, systemPermission } from "./desktop.ts";
import { notificationInputType, notificationPermission } from "./notification.ts";
import { serviceStateType } from "./service.ts";
import { windowInfoType } from "./window.ts";

export const desktopTestModuleInterface = moduleInterface(new Map([
  ["setPlatform", functionType([desktopPlatformType], { kind: "promise", value: nullType })],
  ["appDataDirectory", functionType([], { kind: "promise", value: stringType })],
  ["projectDirectory", functionType([], { kind: "promise", value: stringType })],
  ["makeDirectory", functionType([stringType], { kind: "promise", value: nullType })],
  ["readText", functionType([stringType, { kind: "number" }], { kind: "promise", value: stringType })],
  ["writeText", functionType([stringType, stringType], { kind: "promise", value: nullType })],
  ["removeFile", functionType([stringType], { kind: "promise", value: nullType })],
  // The fake window registry. `setWindowKind` is the `setPlatform` shape — one
  // pre-navigation choice, sealed by the first `browser.open()` — and the four
  // below are the host events a real window system produces, so a test drives
  // the same stream the native host feeds rather than a second mechanism.
  ["setWindowKind", functionType([stringType], promiseOf(nullType))],
  ["openWindows", functionType([], promiseOf(listOf(windowInfoType)))],
  ["focusWindow", functionType([stringType, optionalStringType], promiseOf(nullType), 1)],
  ["moveWindow", functionType([stringType, optionalStringType, windowBoundsType], promiseOf(nullType))],
  ["closeWindow", functionType([stringType, optionalStringType], promiseOf(nullType), 1)],
  // The fake notification centre. `setNotificationPermission` is the answer the
  // operating system would give the user's dialog, `shownNotifications` is the
  // inbox the host delivered to, and `activateNotification` is the click.
  ["setNotificationPermission", functionType([notificationPermission.value], promiseOf(nullType))],
  ["shownNotifications", functionType([], promiseOf(listOf(notificationInputType)))],
  ["activateNotification", functionType([optionalStringType], promiseOf(nullType), 0)],
  // The fake service registry. `setServiceState` injects the transitions a real
  // supervisor would publish — with the failure detail a real one would carry,
  // so an application's failure path is testable rather than only reachable;
  // `serveService` runs a real loopback WebSocket server in the test process so
  // a `connect()` round trip crosses a socket rather than a stub, and the
  // handler stays here in VelarScript. `pushService` is the other leg of the
  // same envelope: `serveService`'s handler answers what was asked, and this
  // emits what nobody asked for, which is what a streaming service does. It
  // answers how many open connections took the frame.
  ["setServiceState", functionType([stringType, serviceStateType, optionalStringType], promiseOf(nullType), 2)],
  ["serveService", functionType([stringType, functionType([stringType], promiseOf(stringType))], promiseOf(nullType))],
  ["serviceRejectsWrongToken", functionType([stringType], promiseOf(boolType))],
  ["pushService", functionType([stringType, stringType], promiseOf(numberType))],
  ["stopService", functionType([stringType], promiseOf(nullType))],
  // The fake keychain reports the names it holds and never the values it holds:
  // a stored credential does not leave `velar/secure-storage`, and a test seam
  // that handed one back would be the exception that ends that rule.
  ["secureStorageNames", functionType([], promiseOf(listOf(stringType)))],
  // The remaining host event sources: the sleep/wake pair, a drag gesture's
  // real paths, the read-only system probes, and what was handed to the system
  // link handler.
  ["publishPower", functionType([powerState.value], promiseOf(nullType))],
  ["dropFiles", functionType([listOf(stringType)], promiseOf(nullType))],
  ["setSystemPermission", functionType([systemPermission.value, permissionStatus.value], promiseOf(nullType))],
  ["openedLinks", functionType([], promiseOf(listOf(stringType)))],
  // The update identity a running application cannot read about itself: what
  // Team ID this install carries, what an archive on disk claims to be, and
  // which archives the host actually applied.
  ["setSigningTeam", functionType([optionalStringType], promiseOf(nullType), 0)],
  ["stageUpdate", functionType([stringType, stringType, optionalStringType], promiseOf(nullType), 2)],
  ["appliedUpdates", functionType([], promiseOf(listOf(stringType)))],
]));
