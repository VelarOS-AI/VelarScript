import ApplicationServices
import AVFoundation
import Cocoa
import Darwin
import Foundation
import Security
import UserNotifications
import WebKit

private let bridgeScript = #"""
(() => {
  const hostApply = Reflect.apply
  const hostArray = Array
  const hostArrayIsArray = Array.isArray
  const hostAtob = atob
  const hostBtoa = btoa
  const hostClearTimeout = clearTimeout
  const hostCrypto = globalThis.crypto
  const hostCryptoGetRandomValues = hostCrypto?.getRandomValues
  const hostError = Error
  const hostJsonParse = JSON.parse
  const hostJsonStringify = JSON.stringify
  const hostMap = Map
  const hostMapDelete = Map.prototype.delete
  const hostMapGet = Map.prototype.get
  const hostMapHas = Map.prototype.has
  const hostMapSet = Map.prototype.set
  const hostMapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size").get
  const hostMathCeil = Math.ceil
  const hostMathMin = Math.min
  const hostNumberIsSafeInteger = Number.isSafeInteger
  const hostNumberMaxSafeInteger = Number.MAX_SAFE_INTEGER
  const hostObjectDefineProperty = Object.defineProperty
  const hostPromise = Promise
  const hostRangeError = RangeError
  const hostSetTimeout = setTimeout
  const hostStringCharCodeAt = String.prototype.charCodeAt
  const hostStringFromCharCode = String.fromCharCode
  const hostTextDecoder = new TextDecoder("utf-8", {fatal: true})
  const hostTextDecode = TextDecoder.prototype.decode
  const hostTextEncoder = new TextEncoder()
  const hostTextEncode = TextEncoder.prototype.encode
  const hostTypeError = TypeError
  const hostUint8Array = Uint8Array
  const hostUint8ArraySet = Uint8Array.prototype.set
  const hostUint8ArraySubarray = Uint8Array.prototype.subarray
  const hostMessageHandler = webkit.messageHandlers.velarDesktop
  const hostPostMessage = hostMessageHandler.postMessage
  let hostProjectDirectory = __VELAR_PROJECT_DIRECTORY__
  const mapDelete = (map, key) => hostApply(hostMapDelete, map, [key])
  const mapGet = (map, key) => hostApply(hostMapGet, map, [key])
  const mapHas = (map, key) => hostApply(hostMapHas, map, [key])
  const mapSet = (map, key, value) => hostApply(hostMapSet, map, [key, value])
  const mapSize = (map) => hostApply(hostMapSize, map, [])
  const key = Symbol.for("velar.desktop.bridge.v1")
  if (Object.getOwnPropertyDescriptor(globalThis, key)) throw new Error("VelarScript Desktop bridge already exists")
  if (typeof hostCryptoGetRandomValues !== "function") throw new Error("VelarScript Desktop requires Web Crypto")
  const generationBytes = new hostUint8Array(16)
  hostApply(hostCryptoGetRandomValues, hostCrypto, [generationBytes])
  const hex = "0123456789abcdef"
  let generation = ""
  for (const byte of generationBytes) generation += hex[byte >>> 4] + hex[byte & 15]
  const pending = new hostMap()
  const responseChunks = new hostMap()
  let pendingRequestBytes = 0
  let responseBytes = 0
  let nextId = 1
  const dropResponseChunks = (id) => {
    const state = mapGet(responseChunks, id)
    if (!state) return
    responseBytes -= state.bytes
    mapDelete(responseChunks, id)
  }
  const allocateId = () => {
    for (let attempt = 0; attempt <= 1024; attempt += 1) {
      const id = nextId
      nextId = nextId >= hostNumberMaxSafeInteger ? 1 : nextId + 1
      if (!mapHas(pending, id)) return id
    }
    throw new hostRangeError("Desktop request identity space is exhausted")
  }
  const complete = (owner, message) => {
    if (owner !== generation) return
    if (!message || typeof message !== "object" || !hostNumberIsSafeInteger(message.id)) return
    const request = mapGet(pending, message.id)
    if (!request) return
    mapDelete(pending, message.id)
    pendingRequestBytes -= request.bytes
    dropResponseChunks(message.id)
    if (request.timer !== null) hostClearTimeout(request.timer)
    if (message.ok === true) {
      if (request.capability === "desktop" && request.operation === "selectProjectDirectory"
        && typeof message.value === "string" && message.value.startsWith("/")
        && message.value.length <= 4096 && !message.value.includes("\0")) hostProjectDirectory = message.value
      request.resolve(message.value)
    }
    else if (message.error && typeof message.error === "object"
      && message.error.kind === "http-transport"
      && (message.error.phase === "request" || message.error.phase === "response")
      && typeof message.error.message === "string" && message.error.message.length > 0 && message.error.message.length <= 65536) {
      const failure = new hostError(message.error.message)
      hostObjectDefineProperty(failure, "name", {value: "VelarDesktopHttpTransportError", enumerable: false, configurable: false, writable: false})
      hostObjectDefineProperty(failure, "phase", {value: message.error.phase, enumerable: true, configurable: false, writable: false})
      request.reject(failure)
    } else request.reject(new hostError(typeof message.error === "string" ? message.error : "Desktop host request failed"))
  }
  Object.defineProperty(globalThis, "__velarDesktopComplete", {
    value: complete, enumerable: false, configurable: false, writable: false,
  })
  const decodeBase64 = (value) => {
    const binary = hostApply(hostAtob, globalThis, [value])
    const bytes = new hostUint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = hostApply(hostStringCharCodeAt, binary, [index])
    return bytes
  }
  const encodeBase64 = (bytes) => {
    let binary = ""
    for (let index = 0; index < bytes.length; index += 32768) {
      binary += hostApply(hostStringFromCharCode, String, hostApply(hostUint8ArraySubarray, bytes, [index, index + 32768]))
    }
    return hostApply(hostBtoa, globalThis, [binary])
  }
  const receiveChunk = (owner, id, index, total, encoded) => {
    if (owner !== generation) return
    if (!hostNumberIsSafeInteger(id) || !mapHas(pending, id) || !hostNumberIsSafeInteger(index) || index < 0
      || !hostNumberIsSafeInteger(total) || total < 1 || total > 1024 || index >= total
      || typeof encoded !== "string" || encoded.length > 262144) return
    try {
      let state = mapGet(responseChunks, id)
      if (!state) {
        state = {total, parts: new hostArray(total), count: 0, bytes: 0}
        mapSet(responseChunks, id, state)
      }
      if (state.total !== total || state.parts[index]) throw new hostError("Invalid Desktop response chunk sequence")
      const part = decodeBase64(encoded)
      state.parts[index] = part
      state.count += 1
      state.bytes += part.byteLength
      responseBytes += part.byteLength
      if (state.bytes > 65 * 1024 * 1024 || responseBytes > 128 * 1024 * 1024) throw new hostError("Desktop response exceeds its transport bound")
      if (state.count !== state.total) return
      const bytes = new hostUint8Array(state.bytes)
      let offset = 0
      for (const item of state.parts) { hostApply(hostUint8ArraySet, bytes, [item, offset]); offset += item.byteLength }
      dropResponseChunks(id)
      complete(owner, hostApply(hostJsonParse, JSON, [hostApply(hostTextDecode, hostTextDecoder, [bytes])]))
    } catch (error) {
      dropResponseChunks(id)
      complete(owner, {id, ok: false, error: error instanceof hostError ? error.message : "Invalid Desktop response transport"})
    }
  }
  Object.defineProperty(globalThis, "__velarDesktopTransportChunk", {
    value: receiveChunk, enumerable: false, configurable: false, writable: false,
  })
const bridge = Object.freeze({
    platform: "macos",
    packaged: true,
    projectDirectory: hostProjectDirectory,
    projectDirectoryValue: () => hostProjectDirectory,
    windowKind: __VELAR_WINDOW_KIND__,
    windowHandle: __VELAR_WINDOW_HANDLE__,
    environment: Object.freeze(__VELAR_ENVIRONMENT__),
    invoke(capability, operation, args, timeoutMs = 30000) {
      if (typeof capability !== "string" || typeof operation !== "string" || !hostArrayIsArray(args)) {
        return hostPromise.reject(new hostTypeError("Invalid Desktop bridge request"))
      }
      if (!hostNumberIsSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 600000) {
        return hostPromise.reject(new hostRangeError("Invalid Desktop bridge timeout"))
      }
      if (mapSize(pending) >= 1024) return hostPromise.reject(new hostRangeError("Too many pending Desktop requests"))
      const id = allocateId()
      return new hostPromise((resolve, reject) => {
        const requestState = {resolve, reject, timer: null, bytes: 0, capability, operation}
        const timer = timeoutMs === 0 ? null : hostSetTimeout(() => {
          const current = mapGet(pending, id)
          if (current !== requestState) return
          mapDelete(pending, id)
          pendingRequestBytes -= requestState.bytes
          dropResponseChunks(id)
          try {
            hostApply(hostPostMessage, hostMessageHandler, [{protocolVersion: 1, transport: "cancel", generation, id}])
          } catch {}
          reject(new hostError("Desktop host request timed out"))
        }, timeoutMs)
        requestState.timer = timer
        mapSet(pending, id, requestState)
        try {
          const request = {protocolVersion: 1, generation, id, capability, operation, args}
          const bytes = hostApply(hostTextEncode, hostTextEncoder, [hostApply(hostJsonStringify, JSON, [request])])
          if (bytes.byteLength > 128 * 1024 * 1024) throw new hostRangeError("Desktop request exceeds its transport bound")
          if (pendingRequestBytes + bytes.byteLength > 128 * 1024 * 1024) throw new hostRangeError("Pending Desktop requests exceed their aggregate transport bound")
          requestState.bytes = bytes.byteLength
          pendingRequestBytes += bytes.byteLength
          if (bytes.byteLength <= 512 * 1024) {
            hostApply(hostPostMessage, hostMessageHandler, [request])
          } else {
            const chunkBytes = 192 * 1024
            const total = hostMathCeil(bytes.byteLength / chunkBytes)
            if (total > 1024) throw new hostRangeError("Desktop request has too many transport chunks")
            for (let index = 0; index < total; index += 1) {
              const part = hostApply(hostUint8ArraySubarray, bytes, [index * chunkBytes, hostMathMin(bytes.byteLength, (index + 1) * chunkBytes)])
              hostApply(hostPostMessage, hostMessageHandler, [{protocolVersion: 1, transport: "chunk", generation, id, index, total, base64: encodeBase64(part)}])
            }
          }
        } catch (error) {
          if (timer !== null) hostClearTimeout(timer)
          mapDelete(pending, id)
          pendingRequestBytes -= requestState.bytes
          reject(error)
        }
      })
    },
  })
  Object.defineProperty(globalThis, key, {value: bridge, enumerable: false, configurable: false, writable: false})
})()
"""#

private struct WindowConfiguration: Decodable {
    let title: String
    let width: Int
    let height: Int
    let minWidth: Int
    let minHeight: Int
    let titleBar: String
    let material: String
    let style: String
    let frame: Bool
    let level: String
    let visibleOnAllWorkspaces: Bool
    let aspectRatio: Double?
    let resizable: Bool
}

/// A service as the packaged bundle declares it. The payload directory is not
/// named here: a packaged service always lives at `Resources/services/<name>/`,
/// so the project path that produced it is a build fact and not a runtime one.
private struct ServiceConfiguration: Decodable {
    let entry: String
    let restart: String
}

private struct HostConfiguration: Decodable {
    let protocolVersion: Int
    let productName: String
    let identifier: String
    let nodeMinimumMajor: Int
    let windows: [String: WindowConfiguration]
    let services: [String: ServiceConfiguration]
    let permissions: PermissionConfiguration
}

private let mainWindowKind = "main"

private struct PermissionConfiguration: Decodable {
    let files: [String]
    let network: [String]
    let environment: [String]
    let secrets: [String]
    let links: [String]
    let notifications: Bool
    let secureStorage: [String]
}

/// The bounds every host event stream keeps, stated once for the three streams
/// that keep them. The renderer states the same numbers on its own side of the
/// bridge (packages/desktop/src/compiler.ts) and the fake host in
/// packages/desktop/src/test-runtime.ts states them a third time; the three must
/// not drift.
private let maxHostEventStreams = 128
private let maxHostQueuedEvents = 64
private let maxDroppedPaths = 4096
private let maxDroppedTextUnits = 2 * 1024 * 1024
private let maxSecureStorageValueBytes = 8 * 1024
private let notificationTagKey = "velar.notification.tag"
/// The document generation `--headless-smoke` issues its own capability request
/// under. A renderer generation is 128 random bits, so this fixed one belongs to
/// nobody else, and it lets the worker's ownership bookkeeping treat the smoke
/// exactly as it treats a window.
private let smokeGeneration = "00000000000000000000000000000001"

private struct BridgeIdentity: Hashable {
    let generation: String
    let id: Int
}

private func validatedBridgeGeneration(_ value: Any?) -> String? {
    guard let value = value as? String, value.utf8.count == 32,
          value.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }) else { return nil }
    return value
}

private struct BridgeRequest {
    let generation: String
    let id: Int
    let capability: String
    let operation: String
    let arguments: [Any]

    init?(_ body: [String: Any]) {
        guard body.count <= 6,
              body["protocolVersion"] as? Int == 1,
              let generation = validatedBridgeGeneration(body["generation"]),
              let id = body["id"] as? Int, id > 0,
              let capability = body["capability"] as? String, !capability.isEmpty, capability.count <= 128,
              let operation = body["operation"] as? String, !operation.isEmpty, operation.count <= 128,
              let arguments = body["args"] as? [Any], arguments.count <= 1024,
              let encoded = try? JSONSerialization.data(withJSONObject: body), encoded.count <= 128 * 1024 * 1024 else {
            return nil
        }
        self.generation = generation
        self.id = id
        self.capability = capability
        self.operation = operation
        self.arguments = arguments
    }
}

private struct BridgeTransportChunk {
    let generation: String
    let id: Int
    let index: Int
    let total: Int
    let data: Data

    init?(_ body: [String: Any]) {
        guard body.count <= 8,
              body["protocolVersion"] as? Int == 1,
              body["transport"] as? String == "chunk",
              let generation = validatedBridgeGeneration(body["generation"]),
              let id = body["id"] as? Int, id > 0,
              let index = body["index"] as? Int, index >= 0,
              let total = body["total"] as? Int, total >= 1, total <= 1024, index < total,
              let base64 = body["base64"] as? String, base64.count <= 262144,
              let data = Data(base64Encoded: base64), data.count <= 192 * 1024 else { return nil }
        self.generation = generation
        self.id = id
        self.index = index
        self.total = total
        self.data = data
    }
}

private struct BridgeTransportCancel {
    let identity: BridgeIdentity

    init?(_ body: [String: Any]) {
        guard body.count <= 5,
              body["protocolVersion"] as? Int == 1,
              body["transport"] as? String == "cancel",
              let generation = validatedBridgeGeneration(body["generation"]),
              let id = body["id"] as? Int, id > 0 else { return nil }
        self.identity = BridgeIdentity(generation: generation, id: id)
    }
}

private func deliverBridgeResponse(_ data: Data, generation: String, to webView: WKWebView?) {
    guard validatedBridgeGeneration(generation) != nil else { return }
    guard let id = responseIdentifier(data) else { return }
    let chunkBytes = 192 * 1024
    let total = max(1, (data.count + chunkBytes - 1) / chunkBytes)
    guard total <= 1024 else { return }
    for index in 0..<total {
        let lower = index * chunkBytes
        let upper = min(data.count, lower + chunkBytes)
        let encoded = data.subdata(in: lower..<upper).base64EncodedString()
        webView?.evaluateJavaScript("globalThis.__velarDesktopTransportChunk(\"\(generation)\",\(id),\(index),\(total),\"\(encoded)\")")
    }
}

private func responseIdentifier(_ data: Data) -> Int? {
    guard let value = try? JSONSerialization.jsonObject(with: data),
          let object = value as? [String: Any],
          let id = object["id"] as? Int, id > 0 else { return nil }
    return id
}

/// The one place a machine-readable report leaves this host, and the reason it
/// is a function rather than a string literal with holes in it: the reports used
/// to be assembled by concatenation, so every value they carried was trusted to
/// contain no quote, no backslash and no newline. A bundle identifier and a
/// filesystem path are not that, and neither is an error message. Serializing
/// the object is the whole fix; the sorted keys keep the output stable enough to
/// read in a diff.
private func writeReport(_ report: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

/// Where the runtime a packaged application actually ran on came from. It is
/// reported by `--headless-smoke` so a deprivation test can prove the bundled
/// one was used rather than infer it from the absence of a failure.
private enum NodeRuntimeSource: String {
    case override = "override"
    case bundled = "bundled"
    case external = "external"
}

private struct ResolvedNodeRuntime {
    let url: URL
    let source: NodeRuntimeSource
}

/// Three sources, in one order, and the order is the whole contract.
///
/// `VELAR_DESKTOP_NODE` is first because it is an explicit act by a developer
/// who is debugging this application and needs the runtime replaced; an override
/// that a bundled runtime silently won a race against would not be an override.
///
/// The bundled runtime is second because a self-contained application is one
/// whose behaviour does not depend on what the user happens to have installed.
/// The external search below it is unchanged and still runs — for an unpackaged
/// development run, and for any bundle whose runtime is missing — which is what
/// keeps `velar dev` and the source-built host working exactly as they did.
private func resolveNodeRuntime(_ configuration: HostConfiguration) throws -> ResolvedNodeRuntime {
    var candidates: [(String, NodeRuntimeSource)] = []
    if let override = ProcessInfo.processInfo.environment["VELAR_DESKTOP_NODE"], !override.isEmpty {
        candidates.append((override, .override))
    }
    if let executable = Bundle.main.executableURL?.resolvingSymlinksInPath() {
        candidates.append((executable.deletingLastPathComponent().appendingPathComponent("node", isDirectory: false).path, .bundled))
    }
    if let path = ProcessInfo.processInfo.environment["PATH"] {
        candidates.append(contentsOf: path.split(separator: ":").map { (String($0) + "/node", .external) })
    }
    candidates.append(contentsOf: [
        ("/opt/homebrew/bin/node", .external),
        ("/usr/local/bin/node", .external),
        ("/usr/bin/node", .external),
    ])
    var visited = Set<String>()
    for (candidate, source) in candidates where candidate.hasPrefix("/") && visited.insert(candidate).inserted {
        let url = URL(fileURLWithPath: candidate).resolvingSymlinksInPath()
        guard FileManager.default.isExecutableFile(atPath: url.path),
              let major = nodeMajorVersion(url), major >= configuration.nodeMinimumMajor else { continue }
        return ResolvedNodeRuntime(url: url, source: source)
    }
    throw NSError(
        domain: "VelarDesktop",
        code: 5,
        userInfo: [NSLocalizedDescriptionKey: "Desktop application carries no usable embedded Node.js runtime and found no Node.js \(configuration.nodeMinimumMajor) or newer on this machine; set VELAR_DESKTOP_NODE to an absolute executable path"]
    )
}

/// What `applyUpdate` compares. The bundle identifier is read from the bundle
/// itself and the Team ID out of its code signature, because they answer two
/// different questions: what the application calls itself, and who signed it.
private struct BundleSigningIdentity {
    let bundleIdentifier: String
    /// Absent for an ad-hoc or unsigned build. Absence is never a match.
    let teamIdentifier: String?
}

private func bundleSigningIdentity(at url: URL, verify: Bool) throws -> BundleSigningIdentity {
    guard let bundle = Bundle(url: url), let identifier = bundle.bundleIdentifier, !identifier.isEmpty else {
        throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey:
            "Application bundle at \(url.lastPathComponent) declares no CFBundleIdentifier"])
    }
    var staticCode: SecStaticCode?
    guard SecStaticCodeCreateWithPath(url as CFURL, [], &staticCode) == errSecSuccess, let code = staticCode else {
        throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey:
            "Application bundle at \(url.lastPathComponent) carries no readable code signature"])
    }
    if verify {
        // Nested code is checked too: the embedded Node.js runtime is a second
        // Mach-O in `Contents/MacOS`, and an archive whose bundle checks out
        // while its interpreter does not is exactly the substitution this guards.
        let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSCheckNestedCode | kSecCSStrictValidate)
        let status = SecStaticCodeCheckValidity(code, flags, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey:
                "Application bundle at \(url.lastPathComponent) does not pass code signature validation (OSStatus \(status))"])
        }
    }
    var information: CFDictionary?
    guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
          let signing = information as? [String: Any] else {
        throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey:
            "Application bundle at \(url.lastPathComponent) has unreadable signing information"])
    }
    let team = signing[kSecCodeInfoTeamIdentifier as String] as? String
    return BundleSigningIdentity(bundleIdentifier: identifier, teamIdentifier: team?.isEmpty == false ? team : nil)
}

private func resolveProjectDirectory(_ fallback: URL) throws -> String {
    let value = ProcessInfo.processInfo.environment["VELAR_DESKTOP_PROJECT_ROOT"] ?? fallback.path
    guard value.hasPrefix("/"), !value.contains("\0"), value.utf8.count <= 4096 else {
        throw NSError(
            domain: "VelarDesktop",
            code: 6,
            userInfo: [NSLocalizedDescriptionKey: "VELAR_DESKTOP_PROJECT_ROOT must be an absolute path of at most 4096 UTF-8 bytes"]
        )
    }
    let directory = URL(fileURLWithPath: value, isDirectory: true).resolvingSymlinksInPath().standardizedFileURL
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory), isDirectory.boolValue else {
        throw NSError(
            domain: "VelarDesktop",
            code: 6,
            userInfo: [NSLocalizedDescriptionKey: "VELAR_DESKTOP_PROJECT_ROOT must identify an existing directory"]
        )
    }
    return directory.path
}

private final class ProjectDirectoryGrant {
    private let bookmark: URL
    private var scopedURL: URL?
    private(set) var directory: String
    private(set) var selection: String?

    init(defaultDirectory: URL, appData: URL, projectFilesGranted: Bool) throws {
        bookmark = appData.appendingPathComponent("project-directory.bookmark", isDirectory: false)
        directory = try resolveProjectDirectory(defaultDirectory)
        selection = projectFilesGranted && ProcessInfo.processInfo.environment["VELAR_DESKTOP_PROJECT_ROOT"] != nil ? directory : nil
        guard projectFilesGranted else {
            try? FileManager.default.removeItem(at: bookmark)
            return
        }
        guard selection == nil, FileManager.default.fileExists(atPath: bookmark.path) else { return }
        do {
            let data = try Data(contentsOf: bookmark)
            guard data.count <= 1024 * 1024 else { throw NSError(domain: "VelarDesktop", code: 7, userInfo: [NSLocalizedDescriptionKey: "Desktop project bookmark exceeds 1 MiB"]) }
            var stale = false
            let restored = try URL(
                resolvingBookmarkData: data,
                options: [.withSecurityScope],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            )
            let validated = try Self.validated(restored)
            if validated.startAccessingSecurityScopedResource() { scopedURL = validated }
            directory = validated.path
            selection = validated.path
            if stale { try persist(validated) }
        } catch {
            scopedURL?.stopAccessingSecurityScopedResource()
            scopedURL = nil
            selection = nil
            try? FileManager.default.removeItem(at: bookmark)
        }
    }

    func select() throws -> String? {
        let panel = NSOpenPanel()
        panel.title = "Choose a VelarScript project"
        panel.prompt = "Open"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.resolvesAliases = true
        panel.directoryURL = URL(fileURLWithPath: directory, isDirectory: true)
        guard panel.runModal() == .OK, let value = panel.url else { return nil }
        let validated = try Self.validated(value)
        try persist(validated)
        let acquired = validated.startAccessingSecurityScopedResource()
        scopedURL?.stopAccessingSecurityScopedResource()
        scopedURL = acquired ? validated : nil
        directory = validated.path
        selection = validated.path
        return validated.path
    }

    func release() {
        scopedURL?.stopAccessingSecurityScopedResource()
        scopedURL = nil
    }

    private func persist(_ value: URL) throws {
        let data = try value.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
        guard data.count <= 1024 * 1024 else { throw NSError(domain: "VelarDesktop", code: 7, userInfo: [NSLocalizedDescriptionKey: "Desktop project bookmark exceeds 1 MiB"]) }
        try data.write(to: bookmark, options: .atomic)
    }

    private static func validated(_ value: URL) throws -> URL {
        let directory = value.resolvingSymlinksInPath().standardizedFileURL
        guard directory.isFileURL, directory.path.hasPrefix("/"), !directory.path.contains("\0"), directory.path.utf8.count <= 4096 else {
            throw NSError(domain: "VelarDesktop", code: 7, userInfo: [NSLocalizedDescriptionKey: "Selected Desktop project must have a bounded absolute file path"])
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw NSError(domain: "VelarDesktop", code: 7, userInfo: [NSLocalizedDescriptionKey: "Selected Desktop project must identify an existing directory"])
        }
        return directory
    }
}

private func nodeMajorVersion(_ executable: URL) -> Int? {
    let process = Process()
    let output = Pipe()
    process.executableURL = executable
    process.arguments = ["--version"]
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    do { try process.run(); process.waitUntilExit() } catch { return nil }
    guard process.terminationStatus == 0 else { return nil }
    let data = try? output.fileHandleForReading.readToEnd()
    guard let data, data.count <= 128,
          let version = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
          version.first == "v" else { return nil }
    return Int(version.dropFirst().split(separator: ".").first ?? "")
}

private final class NodeCapabilityHost {
    private struct PendingRequest {
        let identity: BridgeIdentity
        let requestBytes: Int
        var retired: Bool
        // Every window owns its own document generation, so a response is
        // delivered to the web view that issued the request rather than to one
        // shared view. A window closed while its request was in flight drops
        // the response with the view.
        weak var webView: WKWebView?
    }

    private struct ProcessOwner {
        let pids: [pid_t]
        let generation: String
    }

    private struct PendingProjectRoot {
        let generation: String
        let completion: (String?) -> Void
    }

    private let process = Process()
    private let input = Pipe()
    private let output = Pipe()
    private let errors = Pipe()
    private var buffer = Data()
    private var pending: [Int: PendingRequest] = [:]
    private var pendingRequestBytes = 0
    private var activeIdentities = Set<BridgeIdentity>()
    // One entry per live document. A Desktop application may hold several
    // windows open at once, and each one is its own generation with its own
    // owned watchers and processes; a second window must not retire the first.
    private var activeGenerations = Set<String>()
    private var nextWorkerRequestID = 1
    private var nextProjectRootCommandID = 1
    private var processOwners: [Int: ProcessOwner] = [:]
    private var pendingProjectRoots: [Int: PendingProjectRoot] = [:]
    /// Capability requests the host itself issued, answered back into Swift
    /// rather than into a web view. `--headless-smoke` is the only caller.
    private var probes: [Int: (Bool, Any?, String?) -> Void] = [:]
    private var failure: String?
    private var reaping = false
    private let queue = DispatchQueue(label: "velar.desktop.node-worker")

    init(executable: String, worker: URL, config: URL, appData: URL, launchDirectory: String) throws {
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = [worker.path, config.path, appData.path, launchDirectory]
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errors
        process.terminationHandler = { [weak self] process in
            self?.queue.async {
                self?.fail("Desktop Node capability host exited unexpectedly with status \(process.terminationStatus)")
            }
        }
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { return }
            self?.queue.async { self?.consume(data) }
        }
        errors.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty { FileHandle.standardError.write(data) }
        }
        try process.run()
    }

    func send(_ request: BridgeRequest, body: [String: Any], to webView: WKWebView?) throws {
        let data = try JSONSerialization.data(withJSONObject: body)
        guard data.count <= 128 * 1024 * 1024 else { throw NSError(domain: "VelarDesktop", code: 413, userInfo: [NSLocalizedDescriptionKey: "Desktop request exceeds its transport bound"]) }
        queue.async { [weak self, weak webView] in
            guard let self else { return }
            let identity = BridgeIdentity(generation: request.generation, id: request.id)
            if self.activeIdentities.contains(identity) {
                self.complete(identity: identity, error: "Desktop request identity is already pending", to: webView)
                return
            }
            if let failure = self.failure {
                self.complete(identity: identity, error: failure, to: webView)
                return
            }
            guard self.process.isRunning else {
                self.fail("Desktop Node capability host is not running")
                self.complete(identity: identity, error: self.failure ?? "Desktop Node capability host is not running", to: webView)
                return
            }
            if self.pending.count >= 1024 {
                self.complete(identity: identity, error: "Too many pending Desktop capability requests", to: webView)
                return
            }
            if self.pendingRequestBytes + data.count > 128 * 1024 * 1024 {
                self.complete(identity: identity, error: "Pending Desktop capability requests exceed their aggregate transport bound", to: webView)
                return
            }
            do {
                try self.activate(generation: request.generation)
                guard let workerID = self.allocateWorkerRequestID() else {
                    self.complete(identity: identity, error: "Desktop capability request identity space is exhausted", to: webView)
                    return
                }
                var forwarded = body
                forwarded.removeValue(forKey: "generation")
                forwarded["id"] = workerID
                forwarded["owner"] = request.generation
                self.pending[workerID] = PendingRequest(identity: identity, requestBytes: data.count, retired: false, webView: webView)
                self.pendingRequestBytes += data.count
                self.activeIdentities.insert(identity)
                try self.write(forwarded)
            } catch {
                self.fail("Desktop Node capability host write failed: \(error.localizedDescription)")
            }
        }
    }

    /// One capability request the host issues on its own behalf, answered into
    /// Swift. It exists for `--headless-smoke`: a runtime that cannot execute
    /// JavaScript still answers `node --version`, so proving the interpreter
    /// works means making it run the capability worker's real dispatcher and
    /// return through the real transport.
    ///
    /// The reply is delivered whether it succeeded or failed, because a refusal
    /// the worker computed is as much proof of a working runtime as a result is
    /// — the caller decides which refusals it expected.
    func probe(capability: String, operation: String, arguments: [Any], completion: @escaping (Bool, Any?, String?) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            guard self.failure == nil, self.process.isRunning else {
                completion(false, nil, self.failure ?? "Desktop Node capability host is not running")
                return
            }
            do {
                try self.activate(generation: smokeGeneration)
                guard let workerID = self.allocateWorkerRequestID() else {
                    completion(false, nil, "Desktop capability request identity space is exhausted")
                    return
                }
                self.probes[workerID] = completion
                do {
                    try self.write([
                        "protocolVersion": 1,
                        "id": workerID,
                        "owner": smokeGeneration,
                        "capability": capability,
                        "operation": operation,
                        "args": arguments,
                    ])
                } catch {
                    self.probes.removeValue(forKey: workerID)
                    throw error
                }
            } catch {
                self.fail("Desktop Node capability host write failed: \(error.localizedDescription)")
                completion(false, nil, self.failure ?? error.localizedDescription)
            }
        }
    }

    func retire(generation: String) {
        queue.async { [weak self] in self?.retireGeneration(generation) }
    }

    func cancel(identity: BridgeIdentity) {
        queue.async { [weak self] in
            guard let self,
                  let (workerID, request) = self.pending.first(where: { $0.value.identity == identity }),
                  !request.retired else { return }
            self.pending[workerID]?.retired = true
            self.activeIdentities.remove(identity)
            guard self.failure == nil, self.process.isRunning else { return }
            do {
                try self.write([
                    "protocolVersion": 1,
                    "hostCommand": "request-cancel",
                    "owner": identity.generation,
                    "requestID": workerID,
                ])
            } catch {
                self.fail("Desktop Node capability host write failed: \(error.localizedDescription)")
            }
        }
    }

    func setProjectDirectory(_ path: String, generation: String, completion: @escaping (String?) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            guard self.failure == nil, self.process.isRunning else {
                DispatchQueue.main.async { completion(self.failure ?? "Desktop Node capability host is not running") }
                return
            }
            do {
                try self.activate(generation: generation)
                let commandID = self.nextProjectRootCommandID
                self.nextProjectRootCommandID = self.nextProjectRootCommandID >= 9_007_199_254_740_991 ? 1 : self.nextProjectRootCommandID + 1
                guard self.pendingProjectRoots[commandID] == nil else {
                    DispatchQueue.main.async { completion("Desktop project-root command identity space is exhausted") }
                    return
                }
                self.pendingProjectRoots[commandID] = PendingProjectRoot(generation: generation, completion: completion)
                do {
                    try self.write([
                        "protocolVersion": 1,
                        "hostCommand": "project-root-set",
                        "owner": generation,
                        "commandID": commandID,
                        "path": path,
                    ])
                } catch {
                    self.pendingProjectRoots.removeValue(forKey: commandID)
                    throw error
                }
            } catch {
                self.fail("Desktop Node capability host write failed: \(error.localizedDescription)")
                DispatchQueue.main.async { completion(self.failure ?? error.localizedDescription) }
            }
        }
    }

    func stop() {
        queue.async { [weak self] in self?.fail("Desktop Node capability host stopped") }
    }

    private func consume(_ data: Data) {
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer.prefix(upTo: newline)
            buffer.removeSubrange(...newline)
            // A line past this bound is a terminal host failure, so the worker
            // keeps its own response line strictly below it: MAX_RESPONSE_BYTES
            // is 64 MiB in packages/desktop/native/node/worker.js, and an
            // oversized response is reported there as a per-request error. The
            // two bounds must not drift back together.
            guard line.count <= 65 * 1024 * 1024,
                  let value = try? JSONSerialization.jsonObject(with: line),
                  let object = value as? [String: Any] else {
                fail("Desktop Node capability host returned an invalid response")
                return
            }
            if let event = object["hostEvent"] as? String {
                if event == "project-root-settled" { handleProjectRootSettled(object) }
                else { handle(event: event, object: object) }
                if failure != nil { return }
                continue
            }
            if let id = object["id"] as? Int, id > 0, let probe = probes.removeValue(forKey: id) {
                let ok = object["ok"] as? Bool == true
                let value = object["value"]
                let error = object["error"] as? String
                DispatchQueue.main.async { probe(ok, value, error) }
                continue
            }
            guard let id = object["id"] as? Int, id > 0,
                  let request = pending.removeValue(forKey: id) else {
                fail("Desktop Node capability host returned an unknown response")
                return
            }
            pendingRequestBytes -= request.requestBytes
            activeIdentities.remove(request.identity)
            if request.retired { continue }
            var response = object
            response["id"] = request.identity.id
            guard let encoded = try? JSONSerialization.data(withJSONObject: response),
                  encoded.count <= 65 * 1024 * 1024 else {
                fail("Desktop Node capability host returned an invalid response")
                return
            }
            let target = request.webView
            DispatchQueue.main.async {
                deliverBridgeResponse(encoded, generation: request.identity.generation, to: target)
            }
        }
        if buffer.count > 65 * 1024 * 1024 { fail("Desktop Node capability host response exceeded its transport bound") }
    }

    private func handle(event: String, object: [String: Any]) {
        guard object["protocolVersion"] as? Int == 1,
              let handle = object["handle"] as? Int, handle > 0,
              let generation = validatedBridgeGeneration(object["owner"]) else {
            fail("Desktop Node capability host returned an invalid lifecycle event")
            return
        }
        switch event {
        case "process-owned":
            guard let pid = object["pid"] as? Int, pid > 0, pid <= Int(Int32.max),
                  processOwners[handle] == nil,
                  activeGenerations.contains(generation) || pending.values.contains(where: { $0.identity.generation == generation }) else {
                fail("Desktop Node capability host returned an invalid process owner")
                return
            }
            processOwners[handle] = ProcessOwner(pids: [pid_t(pid)], generation: generation)
        case "process-settled":
            guard let owner = processOwners[handle], owner.generation == generation else {
                fail("Desktop Node capability host settled an unknown process owner")
                return
            }
            processOwners.removeValue(forKey: handle)
        default:
            fail("Desktop Node capability host returned an unknown lifecycle event")
        }
    }

    private func handleProjectRootSettled(_ object: [String: Any]) {
        guard object["protocolVersion"] as? Int == 1,
              let commandID = object["commandID"] as? Int, commandID > 0,
              let generation = validatedBridgeGeneration(object["owner"]),
              let pending = pendingProjectRoots.removeValue(forKey: commandID),
              pending.generation == generation,
              let ok = object["ok"] as? Bool else {
            fail("Desktop Node capability host returned an invalid project-root result")
            return
        }
        let error: String?
        if ok {
            guard object.keys.allSatisfy({ ["protocolVersion", "hostEvent", "owner", "commandID", "ok"].contains($0) }) else {
                fail("Desktop Node capability host returned an invalid project-root result")
                return
            }
            error = nil
        } else {
            guard let message = object["error"] as? String, !message.isEmpty, message.utf8.count <= 65536 else {
                fail("Desktop Node capability host returned an invalid project-root failure")
                return
            }
            error = message
        }
        DispatchQueue.main.async { pending.completion(error) }
    }

    private func fail(_ message: String) {
        guard failure == nil else { return }
        failure = message
        FileHandle.standardError.write(Data(("Velar Desktop capability host: \(message)\n").utf8))
        output.fileHandleForReading.readabilityHandler = nil
        errors.fileHandleForReading.readabilityHandler = nil
        try? input.fileHandleForWriting.close()
        if process.isRunning { process.terminate() }
        let requests = Array(pending.values)
        let projectRoots = Array(pendingProjectRoots.values)
        let outstandingProbes = Array(probes.values)
        pending.removeAll(keepingCapacity: false)
        pendingProjectRoots.removeAll(keepingCapacity: false)
        probes.removeAll(keepingCapacity: false)
        pendingRequestBytes = 0
        activeIdentities.removeAll(keepingCapacity: false)
        activeGenerations.removeAll(keepingCapacity: false)
        for request in requests where !request.retired { complete(identity: request.identity, error: message, to: request.webView) }
        for projectRoot in projectRoots { DispatchQueue.main.async { projectRoot.completion(message) } }
        for probe in outstandingProbes { DispatchQueue.main.async { probe(false, nil, message) } }
        reapProcessOwners()
    }

    private func complete(identity: BridgeIdentity, error: String, to webView: WKWebView?) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["id": identity.id, "ok": false, "error": error]) else { return }
        DispatchQueue.main.async { [weak webView] in
            deliverBridgeResponse(data, generation: identity.generation, to: webView)
        }
    }

    /// Host-global request identities are shared by renderer requests and the
    /// host's own probes, so both ledgers are consulted. One counter and one
    /// check would let a renderer request be handed an identity a probe is still
    /// waiting on, and the answer would go to whichever ledger was read first.
    private func allocateWorkerRequestID() -> Int? {
        for _ in 0...1024 {
            let candidate = nextWorkerRequestID
            nextWorkerRequestID = nextWorkerRequestID >= 9_007_199_254_740_991 ? 1 : nextWorkerRequestID + 1
            if pending[candidate] == nil && probes[candidate] == nil { return candidate }
        }
        return nil
    }

    private func write(_ object: [String: Any]) throws {
        var data = try JSONSerialization.data(withJSONObject: object)
        guard data.count <= 128 * 1024 * 1024 else {
            throw NSError(domain: "VelarDesktop", code: 413, userInfo: [NSLocalizedDescriptionKey: "Desktop request exceeds its transport bound"])
        }
        data.append(0x0A)
        try input.fileHandleForWriting.write(contentsOf: data)
    }

    // A window is a document generation, and an application may hold several
    // windows open at once, so activating one never retires another. A
    // generation leaves the live set exactly where it was always retired: when
    // its document navigates away or its window closes.
    private func activate(generation: String) throws {
        if activeGenerations.contains(generation) { return }
        guard failure == nil else { throw NSError(domain: "VelarDesktop", code: 500, userInfo: [NSLocalizedDescriptionKey: failure!]) }
        guard activeGenerations.count < 256 else {
            throw NSError(domain: "VelarDesktop", code: 500, userInfo: [NSLocalizedDescriptionKey: "Desktop capability host cannot own more than 256 document generations"])
        }
        try write(["protocolVersion": 1, "hostCommand": "owner-activate", "owner": generation])
        activeGenerations.insert(generation)
    }

    private func retireGeneration(_ generation: String) {
        for (id, request) in pending where request.identity.generation == generation {
            pending[id]?.retired = true
            activeIdentities.remove(request.identity)
        }
        activeGenerations.remove(generation)
        for owner in processOwners.values where owner.generation == generation {
            for pid in owner.pids { _ = Darwin.kill(-pid, SIGKILL) }
        }
        guard failure == nil, process.isRunning else { return }
        do {
            try write(["protocolVersion": 1, "hostCommand": "owner-retire", "owner": generation])
        } catch {
            fail("Desktop Node capability host write failed: \(error.localizedDescription)")
        }
    }

    private func reapProcessOwners() {
        guard !reaping, !processOwners.isEmpty else { return }
        reaping = true
        let reap = { [weak self] in
            guard let self else { return }
            var settled: [Int] = []
            for (handle, owner) in self.processOwners {
                for pid in owner.pids { _ = Darwin.kill(-pid, SIGKILL) }
                if owner.pids.allSatisfy({ Darwin.kill(-$0, 0) == -1 && errno == ESRCH }) { settled.append(handle) }
            }
            for handle in settled { self.processOwners.removeValue(forKey: handle) }
            if self.processOwners.isEmpty {
                self.reaping = false
            } else {
                self.queue.asyncAfter(deadline: .now() + .milliseconds(50), execute: self.reapClosure())
            }
        }
        reap()
    }

    private func reapClosure() -> @Sendable () -> Void {
        return { [weak self] in
            guard let self else { return }
            self.reaping = false
            self.reapProcessOwners()
        }
    }
}

private final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    private let rootPath: String

    init(root: URL) {
        self.root = root.standardizedFileURL
        self.rootPath = self.root.path.hasSuffix("/") ? self.root.path : self.root.path + "/"
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.scheme == "velar-app", url.host == "app" else {
            fail(task, 400, "Invalid Velar application URL")
            return
        }
        let rawPath = url.path == "/" ? "index.html" : String(url.path.drop(while: { $0 == "/" }))
        guard let decoded = rawPath.removingPercentEncoding,
              !decoded.isEmpty, !decoded.contains("\0"),
              !decoded.split(separator: "/", omittingEmptySubsequences: false).contains("..") else {
            fail(task, 400, "Invalid Velar application path")
            return
        }
        var target = root.appendingPathComponent(decoded).standardizedFileURL
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: target.path, isDirectory: &isDirectory), isDirectory.boolValue {
            target = target.appendingPathComponent("index.html").standardizedFileURL
        }
        guard target.path.hasPrefix(rootPath) else {
            fail(task, 403, "Velar application path escaped its bundle")
            return
        }
        // The Web host declares this application a single-page deployment, so a
        // route the Router owns has no file of its own and the document is the
        // fallback — the same rule `webStaticDeployment` publishes for every
        // other Desktop deployment surface. Only an extensionless path falls
        // back: a missing script or image stays a missing resource rather than
        // becoming an HTML document with a JavaScript content type.
        if target.pathExtension.isEmpty, !FileManager.default.fileExists(atPath: target.path) {
            target = root.appendingPathComponent("index.html").standardizedFileURL
        }
        do {
            let data = try Data(contentsOf: target, options: [.mappedIfSafe])
            guard let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": mimeType(target.pathExtension),
                    "Content-Length": String(data.count),
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                ]
            ) else { throw NSError(domain: "VelarDesktop", code: 500) }
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
        } catch {
            fail(task, 404, "Velar application resource was not found")
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func fail(_ task: WKURLSchemeTask, _ status: Int, _ message: String) {
        let error = NSError(domain: "VelarDesktop", code: status, userInfo: [NSLocalizedDescriptionKey: message])
        task.didFailWithError(error)
    }

    private func mimeType(_ extensionName: String) -> String {
        switch extensionName.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "gif": return "image/gif"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}

/// The `desktop` capability operations the host answers itself. Everything else
/// under that capability is a project-directory question answered below, and
/// everything under another capability goes to the worker.
private let desktopHostSurface: Set<String> = [
    "openExternal", "displays", "permissionStatus", "applyUpdate",
    "powerWatchStart", "powerWatchNext", "powerWatchClose",
    "dropWatchStart", "dropWatchNext", "dropWatchClose",
]

private final class DesktopBridge: NSObject, WKScriptMessageHandler {
    private struct IncomingChunks {
        let total: Int
        var nextIndex: Int
        var data: Data
    }
    private let identifier: String
    private let projectGrant: ProjectDirectoryGrant
    private let projectFilesGranted: Bool
    private let droppedFilesGranted: Bool
    private let worker: NodeCapabilityHost
    private var incomingChunks: [BridgeIdentity: IncomingChunks] = [:]
    private var incomingBytes = 0
    private var activeGeneration: String?
    private var retiredGenerations = Set<String>()
    private var retiredGenerationOrder: [String] = []
    weak var webView: WKWebView?
    /// The window this bridge's document lives in. One bridge per window, so
    /// `currentWindow()` is a host field rather than a round trip.
    let windowHandle: Int
    weak var registry: WindowRegistry?
    weak var services: HostServices?
    weak var supervisor: ServiceSupervisor?

    init(
        identifier: String,
        projectGrant: ProjectDirectoryGrant,
        projectFilesGranted: Bool,
        droppedFilesGranted: Bool,
        worker: NodeCapabilityHost,
        windowHandle: Int
    ) {
        self.identifier = identifier
        self.projectGrant = projectGrant
        self.projectFilesGranted = projectFilesGranted
        self.droppedFilesGranted = droppedFilesGranted
        self.worker = worker
        self.windowHandle = windowHandle
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any] else { return }
        if body["transport"] as? String == "cancel" {
            receiveCancel(body)
            return
        }
        if body["transport"] as? String == "chunk" {
            receiveChunk(body)
            return
        }
        guard let request = BridgeRequest(body) else { return }
        guard accept(generation: request.generation) else {
            complete(identity: BridgeIdentity(generation: request.generation, id: request.id), value: nil, error: "Desktop document generation is no longer active")
            return
        }
        handle(request, body: body)
    }

    func retireDocument() {
        guard let generation = activeGeneration else { return }
        activeGeneration = nil
        if retiredGenerations.insert(generation).inserted {
            retiredGenerationOrder.append(generation)
            if retiredGenerationOrder.count > 1024 {
                retiredGenerations.remove(retiredGenerationOrder.removeFirst())
            }
        }
        let discarded = incomingChunks.filter { $0.key.generation == generation }
        for (identity, _) in discarded { discardIncoming(identity: identity) }
        registry?.retire(generation: generation)
        services?.retire(generation: generation)
        supervisor?.retire(generation: generation)
        worker.retire(generation: generation)
    }

    private func receiveCancel(_ body: [String: Any]) {
        guard let cancellation = BridgeTransportCancel(body),
              activeGeneration == cancellation.identity.generation else { return }
        discardIncoming(identity: cancellation.identity)
        worker.cancel(identity: cancellation.identity)
    }

    private func discardIncoming(identity: BridgeIdentity) {
        guard let state = incomingChunks.removeValue(forKey: identity) else { return }
        incomingBytes -= state.data.count
    }

    private func receiveChunk(_ body: [String: Any]) {
        guard let chunk = BridgeTransportChunk(body) else { return }
        let identity = BridgeIdentity(generation: chunk.generation, id: chunk.id)
        guard accept(generation: chunk.generation), incomingChunks.count < 16 || incomingChunks[identity] != nil else { return }
        var state = incomingChunks[identity] ?? IncomingChunks(total: chunk.total, nextIndex: 0, data: Data())
        guard state.total == chunk.total, state.nextIndex == chunk.index,
              incomingBytes + chunk.data.count <= 128 * 1024 * 1024 else {
            discardIncoming(identity: identity)
            complete(identity: identity, value: nil, error: "Invalid Desktop request chunk sequence")
            return
        }
        state.data.append(chunk.data)
        state.nextIndex += 1
        incomingBytes += chunk.data.count
        if state.nextIndex < state.total {
            incomingChunks[identity] = state
            return
        }
        incomingChunks.removeValue(forKey: identity)
        incomingBytes -= state.data.count
        guard let value = try? JSONSerialization.jsonObject(with: state.data),
              let decoded = value as? [String: Any],
              let request = BridgeRequest(decoded), request.id == chunk.id,
              request.generation == chunk.generation else {
            complete(identity: identity, value: nil, error: "Invalid Desktop request transport")
            return
        }
        handle(request, body: decoded)
    }

    private func handle(_ request: BridgeRequest, body: [String: Any]) {
        do {
            if request.capability == "window" {
                handleWindow(request)
                return
            }
            if request.capability == "notification" || request.capability == "secure-storage" {
                handleHostService(request)
                return
            }
            if request.capability == "service" {
                handleServiceProcess(request)
                return
            }
            if request.capability != "desktop" {
                try worker.send(request, body: body, to: webView)
                return
            }
            if desktopHostSurface.contains(request.operation) {
                handleHostService(request)
                return
            }
            let value: Any
            guard request.arguments.isEmpty else {
                throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop path operations do not accept arguments"])
            }
            switch request.operation {
            case "homeDirectory":
                value = FileManager.default.homeDirectoryForCurrentUser.path
            case "appDataDirectory":
                let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let directory = base.appendingPathComponent(identifier, isDirectory: true).appendingPathComponent("data", isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                value = directory.path
            case "projectDirectory":
                value = projectGrant.directory
            case "selectedProjectDirectory":
                value = projectGrant.selection ?? NSNull()
            case "selectProjectDirectory":
                guard projectFilesGranted else {
                    throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey: "Desktop project selection requires the 'project' file grant"])
                }
                guard let selected = try projectGrant.select() else {
                    complete(identity: BridgeIdentity(generation: request.generation, id: request.id), value: NSNull(), error: nil)
                    return
                }
                worker.setProjectDirectory(selected, generation: request.generation) { [weak self] error in
                    self?.complete(identity: BridgeIdentity(generation: request.generation, id: request.id), value: selected, error: error)
                }
                return
            default:
                throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Unknown Desktop operation '\(request.operation)'"])
            }
            complete(identity: BridgeIdentity(generation: request.generation, id: request.id), value: value, error: nil)
        } catch {
            complete(identity: BridgeIdentity(generation: request.generation, id: request.id), value: nil, error: error.localizedDescription)
        }
    }

    /// Every window operation is served here, on the main thread, because a
    /// window is AppKit state the capability worker has no business holding.
    /// The registry validates the kind against the manifest a second time: the
    /// generated module already refused an undeclared kind at the call, and a
    /// renderer that reached the bridge another way is refused again here.
    private func handleWindow(_ request: BridgeRequest) {
        let identity = BridgeIdentity(generation: request.generation, id: request.id)
        guard let registry else {
            complete(identity: identity, value: nil, error: "Desktop window registry is unavailable")
            return
        }
        do {
            switch request.operation {
            case "open":
                guard request.arguments.count == 2, let kind = request.arguments[0] as? String,
                      let options = request.arguments[1] as? [String: Any], options.count <= 3,
                      let route = options["route"] as? String else { throw windowRequestFailure("open") }
                let opened = try registry.open(
                    kind: kind,
                    route: route,
                    key: options["key"] as? String,
                    bounds: windowBounds(options["bounds"])
                )
                complete(identity: identity, value: opened, error: nil)
            case "list":
                guard request.arguments.isEmpty else { throw windowRequestFailure("list") }
                complete(identity: identity, value: registry.list(), error: nil)
            case "close":
                guard request.arguments.count == 1, let handle = request.arguments[0] as? Int else { throw windowRequestFailure("close") }
                complete(identity: identity, value: registry.close(handle), error: nil)
            case "focus":
                guard request.arguments.count == 1, let handle = request.arguments[0] as? Int else { throw windowRequestFailure("focus") }
                try registry.focus(handle)
                complete(identity: identity, value: NSNull(), error: nil)
            case "bounds":
                guard request.arguments.count == 1, let handle = request.arguments[0] as? Int else { throw windowRequestFailure("bounds") }
                complete(identity: identity, value: try registry.bounds(handle), error: nil)
            case "setBounds":
                guard request.arguments.count == 2, let handle = request.arguments[0] as? Int,
                      let bounds = windowBounds(request.arguments[1]) else { throw windowRequestFailure("setBounds") }
                try registry.setBounds(handle, bounds: bounds)
                complete(identity: identity, value: NSNull(), error: nil)
            case "display":
                guard request.arguments.count == 1, let handle = request.arguments[0] as? Int else { throw windowRequestFailure("display") }
                complete(identity: identity, value: try registry.display(handle), error: nil)
            case "watchStart":
                guard request.arguments.count == 1, let handle = request.arguments[0] as? Int else { throw windowRequestFailure("watchStart") }
                complete(identity: identity, value: try registry.watchStart(handle, generation: request.generation), error: nil)
            case "watchNext":
                guard request.arguments.count == 1, let handle = request.arguments[0] as? Int else { throw windowRequestFailure("watchNext") }
                try registry.watchNext(handle, generation: request.generation) { [weak self] value in
                    self?.complete(identity: identity, value: value, error: nil)
                }
            case "watchClose":
                guard request.arguments.count == 1, let handle = request.arguments[0] as? Int else { throw windowRequestFailure("watchClose") }
                complete(identity: identity, value: registry.watchClose(handle, generation: request.generation), error: nil)
            default:
                throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Unknown Desktop window operation '\(request.operation)'"])
            }
        } catch {
            complete(identity: identity, value: nil, error: error.localizedDescription)
        }
    }

    /// The rest of the host surface: notifications, the keychain, displays,
    /// links, the two host event streams, and the read-only probes. Every one of
    /// them is AppKit or Security work the capability worker has no business
    /// holding, so it is served here on the main thread beside the windows.
    private func handleHostService(_ request: BridgeRequest) {
        let identity = BridgeIdentity(generation: request.generation, id: request.id)
        guard let services else {
            complete(identity: identity, value: nil, error: "Desktop host services are unavailable")
            return
        }
        func streamHandle() throws -> Int {
            guard request.arguments.count == 1, let handle = request.arguments[0] as? Int, handle > 0 else {
                throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey:
                    "Desktop operation '\(request.operation)' received invalid arguments"])
            }
            return handle
        }
        do {
            if request.capability == "secure-storage" {
                complete(identity: identity, value: try services.secureStorage(request.operation, arguments: request.arguments), error: nil)
                return
            }
            if request.capability == "notification" {
                switch request.operation {
                case "requestPermission":
                    guard request.arguments.isEmpty else { throw windowRequestFailure("requestPermission") }
                    services.requestNotificationPermission { [weak self] value, error in
                        self?.complete(identity: identity, value: value, error: error)
                    }
                case "show":
                    services.showNotification(request.arguments) { [weak self] value, error in
                        self?.complete(identity: identity, value: value, error: error)
                    }
                case "watchStart":
                    guard request.arguments.isEmpty else { throw windowRequestFailure("watchStart") }
                    complete(identity: identity, value: try services.watchStart(.notification, generation: request.generation), error: nil)
                case "watchNext":
                    try services.watchNext(.notification, handle: try streamHandle(), generation: request.generation) { [weak self] value in
                        self?.complete(identity: identity, value: value, error: nil)
                    }
                case "watchClose":
                    complete(identity: identity, value: services.watchClose(.notification, handle: try streamHandle(), generation: request.generation), error: nil)
                default:
                    throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Unknown Desktop notification operation '\(request.operation)'"])
                }
                return
            }
            switch request.operation {
            case "openExternal":
                complete(identity: identity, value: try services.openExternal(request.arguments), error: nil)
            case "applyUpdate":
                services.applyUpdate(request.arguments) { [weak self] value, error in
                    self?.complete(identity: identity, value: value, error: error)
                }
            case "displays":
                guard request.arguments.isEmpty else { throw windowRequestFailure("displays") }
                complete(identity: identity, value: try services.displays(), error: nil)
            case "permissionStatus":
                complete(identity: identity, value: try services.permissionStatus(request.arguments), error: nil)
            case "powerWatchStart":
                guard request.arguments.isEmpty else { throw windowRequestFailure("powerWatchStart") }
                complete(identity: identity, value: try services.watchStart(.power, generation: request.generation), error: nil)
            case "powerWatchNext":
                try services.watchNext(.power, handle: try streamHandle(), generation: request.generation) { [weak self] value in
                    self?.complete(identity: identity, value: value, error: nil)
                }
            case "powerWatchClose":
                complete(identity: identity, value: services.watchClose(.power, handle: try streamHandle(), generation: request.generation), error: nil)
            case "dropWatchStart":
                guard request.arguments.isEmpty else { throw windowRequestFailure("dropWatchStart") }
                guard droppedFilesGranted else {
                    throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey:
                        "Desktop watchDroppedFiles requires the 'dropped' root in 'desktop.permissions.files'"])
                }
                complete(identity: identity, value: try services.watchStart(.dropped, generation: request.generation), error: nil)
            case "dropWatchNext":
                try services.watchNext(.dropped, handle: try streamHandle(), generation: request.generation) { [weak self] value in
                    self?.complete(identity: identity, value: value, error: nil)
                }
            case "dropWatchClose":
                complete(identity: identity, value: services.watchClose(.dropped, handle: try streamHandle(), generation: request.generation), error: nil)
            default:
                throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Unknown Desktop operation '\(request.operation)'"])
            }
        } catch {
            complete(identity: identity, value: nil, error: error.localizedDescription)
        }
    }

    /// The service channel, served here rather than in the capability worker for
    /// the reason the token exists: the worker is where application-shaped work
    /// runs, and the credential that authenticates a service channel must not
    /// live anywhere a document's code can reach. The host dials, the host
    /// authenticates, and what crosses this bridge is an already-open channel.
    private func handleServiceProcess(_ request: BridgeRequest) {
        let identity = BridgeIdentity(generation: request.generation, id: request.id)
        guard let supervisor else {
            complete(identity: identity, value: nil, error: "This Desktop application declares no services")
            return
        }
        func serviceFailure(_ operation: String) -> NSError {
            NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop service operation '\(operation)' received invalid arguments"])
        }
        func connectionHandle() throws -> Int {
            guard let handle = request.arguments.first as? Int, handle > 0 else { throw serviceFailure(request.operation) }
            return handle
        }
        do {
            switch request.operation {
            case "connect":
                guard request.arguments.count == 1, let name = request.arguments[0] as? String else { throw serviceFailure("connect") }
                supervisor.connect(name: name, generation: request.generation) { [weak self] value, error in
                    self?.complete(identity: identity, value: value, error: error)
                }
            case "send":
                guard request.arguments.count == 2, let handle = request.arguments[0] as? Int, handle > 0,
                      let message = request.arguments[1] as? String else { throw serviceFailure("send") }
                supervisor.send(handle: handle, generation: request.generation, message: message) { [weak self] value, error in
                    self?.complete(identity: identity, value: value, error: error)
                }
            case "receive":
                guard request.arguments.count == 1 else { throw serviceFailure("receive") }
                supervisor.receive(handle: try connectionHandle(), generation: request.generation) { [weak self] value, error in
                    self?.complete(identity: identity, value: value, error: error)
                }
            case "state":
                guard request.arguments.count == 1 else { throw serviceFailure("state") }
                complete(identity: identity, value: supervisor.connectionState(handle: try connectionHandle(), generation: request.generation), error: nil)
            case "closeInfo":
                guard request.arguments.count == 1 else { throw serviceFailure("closeInfo") }
                complete(identity: identity, value: try supervisor.closeInfo(handle: try connectionHandle(), generation: request.generation), error: nil)
            case "close":
                guard request.arguments.count == 3, let handle = request.arguments[0] as? Int, handle > 0,
                      let code = request.arguments[1] as? Int, let reason = request.arguments[2] as? String else { throw serviceFailure("close") }
                complete(identity: identity, value: supervisor.close(handle: handle, generation: request.generation, code: code, reason: reason), error: nil)
            case "watchStart":
                guard request.arguments.isEmpty else { throw serviceFailure("watchStart") }
                complete(identity: identity, value: try supervisor.watchStart(generation: request.generation), error: nil)
            case "watchNext":
                guard request.arguments.count == 1 else { throw serviceFailure("watchNext") }
                try supervisor.watchNext(handle: try connectionHandle(), generation: request.generation) { [weak self] value in
                    self?.complete(identity: identity, value: value, error: nil)
                }
            case "watchClose":
                guard request.arguments.count == 1 else { throw serviceFailure("watchClose") }
                complete(identity: identity, value: supervisor.watchClose(handle: try connectionHandle(), generation: request.generation), error: nil)
            default:
                throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Unknown Desktop service operation '\(request.operation)'"])
            }
        } catch {
            complete(identity: identity, value: nil, error: error.localizedDescription)
        }
    }

    private func windowRequestFailure(_ operation: String) -> NSError {
        NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop window operation '\(operation)' received invalid arguments"])
    }

    private func windowBounds(_ value: Any?) -> WindowBounds? {
        guard let fields = value as? [String: Any], fields.count == 4,
              let x = (fields["x"] as? NSNumber)?.doubleValue, let y = (fields["y"] as? NSNumber)?.doubleValue,
              let width = (fields["width"] as? NSNumber)?.doubleValue, let height = (fields["height"] as? NSNumber)?.doubleValue,
              x.isFinite, y.isFinite, width.isFinite, height.isFinite, width >= 1, height >= 1 else { return nil }
        return WindowBounds(x: x, y: y, width: width, height: height)
    }

    private func accept(generation: String) -> Bool {
        if retiredGenerations.contains(generation) { return false }
        if let activeGeneration { return activeGeneration == generation }
        activeGeneration = generation
        return true
    }

    private func complete(identity: BridgeIdentity, value: Any?, error: String?) {
        var payload: [String: Any] = ["id": identity.id, "ok": error == nil]
        if let value { payload["value"] = value }
        if let error { payload["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              data.count <= 65 * 1024 * 1024 else { return }
        deliverBridgeResponse(data, generation: identity.generation, to: webView)
    }
}

// Handing a renderer URL to the system browser is the same question
// `desktop.permissions.network` already answers, so the granted origins govern
// it: an origin that was never granted is cancelled rather than opened. The
// match is exact on scheme, host and port, and mirrors
// `desktopExternalNavigationPermitted` in packages/desktop/src/config.ts.
private func navigationOrigin(_ url: URL) -> String? {
    guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased(), !host.isEmpty else { return nil }
    if let port = url.port, port != 443 { return "https://\(host):\(port)" }
    return "https://\(host)"
}

private final class NavigationPolicy: NSObject, WKNavigationDelegate {
    private weak var bridge: DesktopBridge?
    private let externalOrigins: Set<String>

    init(bridge: DesktopBridge, network: [String]) {
        self.bridge = bridge
        self.externalOrigins = Set(network.compactMap { URL(string: $0).flatMap(navigationOrigin) })
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        bridge?.retireDocument()
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "velar-app" && url.host == "app" {
            decisionHandler(.allow)
        } else if let origin = navigationOrigin(url), externalOrigins.contains(origin) {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.cancel)
        }
    }
}

/// Screen coordinates with the origin at the top left, the way every window API
/// a VelarScript author meets states them. AppKit puts the origin at the bottom
/// left of the primary screen, so the conversion happens once, here, rather than
/// at each call site.
private struct WindowBounds {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private func primaryScreenTop() -> Double {
    NSScreen.screens.first.map { Double($0.frame.maxY) } ?? 0
}

private func topLeftBounds(_ frame: NSRect) -> [String: Any] {
    [
        "x": Double(frame.origin.x),
        "y": primaryScreenTop() - Double(frame.maxY),
        "width": Double(frame.width),
        "height": Double(frame.height),
    ]
}

private func windowFrame(_ bounds: WindowBounds) -> NSRect {
    NSRect(
        x: bounds.x,
        y: primaryScreenTop() - bounds.y - bounds.height,
        width: bounds.width,
        height: bounds.height
    )
}

/// A window a `frame: false` manifest asked for still has to be able to take
/// the keyboard: AppKit refuses key status to a borderless window unless the
/// window itself says otherwise.
private final class VelarWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// A panel floats above the application's windows, takes the keyboard when the
/// user types into it, and never becomes the main window — which is exactly
/// what keeps it out of the window cycle and stops it activating the app.
private final class VelarPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private final class WindowStateWatcher {
    let handle: Int
    let window: Int
    let generation: String
    var events: [String] = []
    var pending: ((Any) -> Void)?
    var draining = false
    var closed = false

    init(handle: Int, window: Int, generation: String) {
        self.handle = handle
        self.window = window
        self.generation = generation
    }
}

/// One bounded pull stream. Power states, dropped-file batches and notification
/// activations all keep the same shape `WindowStateWatcher` keeps: a queue that
/// never grows past its bound, one pending pull at a time, and an owner
/// generation that releases it when its document goes away.
private final class HostEventWatcher {
    let handle: Int
    let generation: String
    var events: [Any] = []
    var pending: ((Any) -> Void)?
    var closed = false

    init(handle: Int, generation: String) {
        self.handle = handle
        self.generation = generation
    }
}

private enum HostEventStream {
    case power
    case dropped
    case notification

    var label: String {
        switch self {
        case .power: return "PowerStream"
        case .dropped: return "DroppedFilesStream"
        case .notification: return "NotificationActivationStream"
        }
    }
}

/// Everything the host owns that is not a window: the notification centre, the
/// keychain, the attached displays, the sleep/wake pair, the paths a drag
/// gesture brought in, and the read-only system probes. One instance per
/// application, shared by every window's bridge, and everything on the main
/// thread — which is where WebKit delivers script messages and where AppKit
/// requires its work.
private final class HostServices: NSObject, UNUserNotificationCenterDelegate {
    private let identifier: String
    private let permissions: PermissionConfiguration
    private let linkSchemes: Set<String>
    private let secureStorageNames: Set<String>
    private var watchers: [Int: (stream: HostEventStream, watcher: HostEventWatcher)] = [:]
    private var nextWatcherHandle = 1
    private var powerState = "resumed"
    private var observers: [NSObjectProtocol] = []
    weak var registry: WindowRegistry?

    init(identifier: String, permissions: PermissionConfiguration) {
        self.identifier = identifier
        self.permissions = permissions
        self.linkSchemes = Set(permissions.links)
        self.secureStorageNames = Set(permissions.secureStorage)
        super.init()
        let center = NSWorkspace.shared.notificationCenter
        // The sleep/wake pair AppKit publishes. A machine that is already awake
        // publishes nothing when it wakes, so the stream carries transitions.
        observers.append(center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            self?.publishPower("suspended")
        })
        observers.append(center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.publishPower("resumed")
        })
        if permissions.notifications, Bundle.main.bundleIdentifier != nil {
            UNUserNotificationCenter.current().delegate = self
        }
    }

    func stop() {
        let center = NSWorkspace.shared.notificationCenter
        for observer in observers { center.removeObserver(observer) }
        observers.removeAll(keepingCapacity: false)
    }

    // MARK: - Streams

    func watchStart(_ stream: HostEventStream, generation: String) throws -> Int {
        guard watchers.count < maxHostEventStreams else {
            throw NSError(domain: "VelarDesktop", code: 429, userInfo: [NSLocalizedDescriptionKey: "Desktop host cannot own more than \(maxHostEventStreams) host event streams"])
        }
        let handle = nextWatcherHandle
        nextWatcherHandle += 1
        watchers[handle] = (stream, HostEventWatcher(handle: handle, generation: generation))
        return handle
    }

    func watchNext(_ stream: HostEventStream, handle: Int, generation: String, deliver: @escaping (Any) -> Void) throws {
        guard let entry = watchers[handle], entry.stream == stream, entry.watcher.generation == generation else {
            throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Desktop \(stream.label) handle is unknown or already released"])
        }
        guard entry.watcher.pending == nil else {
            throw NSError(domain: "VelarDesktop", code: 409, userInfo: [NSLocalizedDescriptionKey: "\(stream.label).next already has an active pull"])
        }
        if !entry.watcher.events.isEmpty {
            deliver(entry.watcher.events.removeFirst())
            return
        }
        entry.watcher.pending = deliver
    }

    @discardableResult
    func watchClose(_ stream: HostEventStream, handle: Int, generation: String) -> Bool {
        guard let entry = watchers[handle], entry.stream == stream, entry.watcher.generation == generation else { return false }
        release(handle)
        return true
    }

    /// A document that navigated away or a window that closed no longer owns the
    /// streams it started, and a pending pull from it is dropped rather than
    /// answered: the replacement document must never receive it.
    func retire(generation: String) {
        for (handle, entry) in watchers where entry.watcher.generation == generation { release(handle) }
    }

    private func release(_ handle: Int) {
        guard let entry = watchers.removeValue(forKey: handle) else { return }
        entry.watcher.closed = true
        entry.watcher.pending = nil
    }

    private func deliver(_ stream: HostEventStream, _ value: Any, coalesce: (HostEventWatcher, Any) -> Bool) {
        for (_, entry) in watchers where entry.stream == stream && !entry.watcher.closed {
            let watcher = entry.watcher
            if let pending = watcher.pending, watcher.events.isEmpty {
                watcher.pending = nil
                pending(value)
                continue
            }
            if coalesce(watcher, value) { continue }
            watcher.events.append(value)
            if watcher.events.count > maxHostQueuedEvents { watcher.events.removeFirst() }
        }
    }

    // MARK: - Power

    /// Power is a transition stream: the machine is either asleep or awake, so a
    /// state it is already in publishes nothing.
    private func publishPower(_ state: String) {
        guard state != powerState else { return }
        powerState = state
        deliver(.power, state) { _, _ in false }
    }

    // MARK: - Dropped files

    /// The paths are registered inside the same drag operation that hands the
    /// drop to WebKit, so the batch this publishes and the DOM's own drop event
    /// are one gesture rather than two that happened to be close together.
    func registerDroppedFiles(_ pasteboard: NSPasteboard) {
        guard permissions.files.contains("dropped") else { return }
        let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
        guard let objects = pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL] else { return }
        var paths: [String] = []
        var units = 0
        for url in objects {
            let path = url.standardizedFileURL.path
            guard path.hasPrefix("/"), !path.contains("\0"), path.utf8.count <= 4096 else { continue }
            units += path.count
            guard paths.count < maxDroppedPaths, units <= maxDroppedTextUnits else { break }
            paths.append(path)
        }
        guard !paths.isEmpty else { return }
        // One batch deep. A gesture that arrives while a batch is still waiting
        // is appended to it in gesture order, so a slow consumer sees the two
        // drops as one drop rather than losing either; a merge past the bound
        // drops the oldest paths, because the newest gesture is the one the user
        // just made.
        deliver(.dropped, ["paths": paths]) { watcher, value in
            guard let batch = watcher.events.first as? [String: Any], let queued = batch["paths"] as? [String],
                  let arriving = (value as? [String: Any])?["paths"] as? [String] else { return false }
            var merged = queued + arriving
            while merged.count > maxDroppedPaths || merged.reduce(0, { $0 + $1.count }) > maxDroppedTextUnits {
                merged.removeFirst()
            }
            watcher.events = [["paths": merged]]
            return true
        }
    }

    // MARK: - Notifications

    private func notificationCentre() throws -> UNUserNotificationCenter {
        guard permissions.notifications else {
            throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey:
                "Desktop notifications require 'notifications: true' under 'desktop.permissions'"])
        }
        guard Bundle.main.bundleIdentifier != nil else {
            throw NSError(domain: "VelarDesktop", code: 500, userInfo: [NSLocalizedDescriptionKey:
                "Desktop notifications require a bundled application identity"])
        }
        return UNUserNotificationCenter.current()
    }

    private static func permissionName(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .provisional, .ephemeral: return "granted"
        case .denied: return "denied"
        default: return "undetermined"
        }
    }

    func requestNotificationPermission(_ completion: @escaping (Any?, String?) -> Void) {
        do {
            let center = try notificationCentre()
            center.requestAuthorization(options: [.alert, .sound]) { _, _ in
                center.getNotificationSettings { settings in
                    let name = Self.permissionName(settings.authorizationStatus)
                    DispatchQueue.main.async { completion(name, nil) }
                }
            }
        } catch {
            completion(nil, error.localizedDescription)
        }
    }

    func showNotification(_ arguments: [Any], completion: @escaping (Any?, String?) -> Void) {
        do {
            let center = try notificationCentre()
            guard arguments.count == 1, let fields = arguments[0] as? [String: Any], fields.count <= 3,
                  let title = fields["title"] as? String, !title.isEmpty, title.count <= 256,
                  let body = fields["body"] as? String, !body.isEmpty, body.count <= 1024 else {
                throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop show received an invalid notification"])
            }
            var tag: String?
            if let value = fields["tag"], !(value is NSNull) {
                guard let text = value as? String, !text.isEmpty, text.count <= 128 else {
                    throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop show received an invalid notification tag"])
                }
                tag = text
            }
            center.getNotificationSettings { settings in
                let name = Self.permissionName(settings.authorizationStatus)
                guard name == "granted" else {
                    DispatchQueue.main.async {
                        // Not authorized is a capability failure, never a silent
                        // no-op: an application that believes it notified the
                        // user and did not is worse off than one that is told.
                        completion(nil, "Desktop show cannot deliver a notification the operating system has not authorized (permission: \(name))")
                    }
                    return
                }
                let content = UNMutableNotificationContent()
                content.title = title
                content.body = body
                if let tag { content.userInfo = [notificationTagKey: tag] }
                // A tag is the notification's identity, so a second notification
                // carrying it replaces the first rather than stacking beside it.
                let request = UNNotificationRequest(identifier: tag ?? UUID().uuidString, content: content, trigger: nil)
                center.add(request) { error in
                    DispatchQueue.main.async {
                        if let error { completion(nil, error.localizedDescription) }
                        else { completion(NSNull(), nil) }
                    }
                }
            }
        } catch {
            completion(nil, error.localizedDescription)
        }
    }

    /// Two activations of the same notification are one activation, so a tag
    /// already queued is not queued twice.
    private func publishActivation(_ tag: String?) {
        deliver(.notification, ["tag": tag.map { $0 as Any } ?? NSNull()]) { watcher, value in
            let arriving = (value as? [String: Any])?["tag"] as? String
            return watcher.events.contains { queued in ((queued as? [String: Any])?["tag"] as? String) == arriving }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let tag = response.notification.request.content.userInfo[notificationTagKey] as? String
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.publishActivation(tag)
            // The host brings the application forward with the activation, and
            // opens the one window every manifest declares when none is left.
            self.registry?.activateForNotification()
        }
        completionHandler()
    }

    // MARK: - Secure storage

    private func secureStorageQuery(_ name: String, operation: String) throws -> [String: Any] {
        guard secureStorageNames.contains(name) else {
            throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey:
                "Desktop \(operation) cannot reach the undeclared secure storage name '\(name)'; declare it under 'desktop.permissions.secureStorage' (declared names: \(permissions.secureStorage.sorted().joined(separator: ", ")))"])
        }
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: identifier,
            kSecAttrAccount as String: name,
        ]
    }

    /// A keychain failure is reported by what failed and by the status code, and
    /// never by the value: a stored credential does not leave this file through
    /// an error message, a log line, or a diagnostic.
    private func secureStorageFailure(_ operation: String, _ status: OSStatus) -> NSError {
        NSError(domain: "VelarDesktop", code: 500, userInfo: [NSLocalizedDescriptionKey:
            "Desktop secure storage could not \(operation) the entry (keychain status \(status))"])
    }

    func secureStorage(_ operation: String, arguments: [Any]) throws -> Any {
        guard let name = arguments.first as? String, !name.isEmpty, name.count <= 128 else {
            throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop secure storage received an invalid name"])
        }
        let query = try secureStorageQuery(name, operation: operation)
        switch operation {
        case "set":
            guard arguments.count == 2, let value = arguments[1] as? String, value.utf8.count <= maxSecureStorageValueBytes else {
                throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop secure storage set requires a text value of at most 8 KiB"])
            }
            let data = Data(value.utf8)
            var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if status == errSecItemNotFound {
                var insert = query
                insert[kSecValueData as String] = data
                insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
                status = SecItemAdd(insert as CFDictionary, nil)
            }
            guard status == errSecSuccess else { throw secureStorageFailure("store", status) }
            return NSNull()
        case "get":
            guard arguments.count == 1 else {
                throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop secure storage get takes one name"])
            }
            var read = query
            read[kSecReturnData as String] = true
            read[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            let status = SecItemCopyMatching(read as CFDictionary, &item)
            if status == errSecItemNotFound { return NSNull() }
            guard status == errSecSuccess, let data = item as? Data, data.count <= maxSecureStorageValueBytes,
                  let text = String(data: data, encoding: .utf8) else {
                throw secureStorageFailure("read", status)
            }
            return text
        case "remove":
            guard arguments.count == 1 else {
                throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop secure storage remove takes one name"])
            }
            let status = SecItemDelete(query as CFDictionary)
            // Removing what is not there is the state it is already in.
            guard status == errSecSuccess || status == errSecItemNotFound else { throw secureStorageFailure("remove", status) }
            return NSNull()
        default:
            throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Unknown Desktop secure storage operation '\(operation)'"])
        }
    }

    // MARK: - Displays, links and probes

    func displays() throws -> [[String: Any]] {
        let screens = NSScreen.screens
        guard !screens.isEmpty else {
            throw NSError(domain: "VelarDesktop", code: 500, userInfo: [NSLocalizedDescriptionKey: "Desktop host found no attached display"])
        }
        return screens.map { screen in
            let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
            return [
                "id": number.map { "display-\($0.uint32Value)" } ?? "display-unknown",
                "bounds": topLeftBounds(screen.frame),
                "workArea": topLeftBounds(screen.visibleFrame),
                "scale": Double(screen.backingScaleFactor),
                "primary": screen == screens.first,
            ]
        }
    }

    /// The renderer already refused an ungranted scheme at the call; the host
    /// asks the same question again before anything is handed to the system,
    /// because a boundary that trusts the last one is a boundary that is not
    /// there. `linkSchemeOf` in packages/desktop/src/compiler.ts is the other
    /// copy of this rule.
    func openExternal(_ arguments: [Any]) throws -> Any {
        guard arguments.count == 1, let text = arguments[0] as? String, !text.isEmpty, text.utf8.count <= 2048,
              let url = URL(string: text), let scheme = url.scheme?.lowercased() else {
            throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop openExternal received an invalid URL"])
        }
        guard linkSchemes.contains(scheme) else {
            throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey:
                "Desktop openExternal cannot open a '\(scheme)' URL; declare the scheme under 'desktop.permissions.links' (granted schemes: \(permissions.links.sorted().joined(separator: ", ")))"])
        }
        NSWorkspace.shared.open(url)
        return NSNull()
    }

    /// Replace this application with the one inside `archivePath`, then relaunch.
    ///
    /// The mechanism is the language's; the policy is the product's. There is no
    /// feed, no channel, no automatic check and no delta: what arrives here is a
    /// local archive the product downloaded under its own rules, and what this
    /// does is decide whether that archive is *this application* and, if it is,
    /// swap it in atomically.
    ///
    /// Identity is two questions asked of the staged copy before anything on
    /// disk is touched: does its bundle identifier equal ours, and does the Team
    /// ID in its signature equal ours. A build with no Team ID — an ad-hoc or
    /// unsigned development install — cannot answer the second, so it is refused
    /// by name rather than waved through: an update path that accepts "no team
    /// matches no team" is an update path that accepts anything.
    ///
    /// Every refusal happens before the replacement, and the staged copy lives
    /// in a directory of its own that is removed on every path, so a failure
    /// leaves the installed application exactly as it was.
    func applyUpdate(_ arguments: [Any], completion: @escaping (Any?, String?) -> Void) {
        guard arguments.count == 1, let path = arguments[0] as? String, path.hasPrefix("/"),
              !path.contains("\0"), path.utf8.count <= 4096 else {
            completion(nil, "Desktop applyUpdate requires one bounded absolute archive path")
            return
        }
        let installed = Bundle.main.bundleURL
        guard installed.pathExtension == "app" else {
            completion(nil, "Desktop applyUpdate replaces an installed application bundle; this host is not running from one")
            return
        }
        let current: BundleSigningIdentity
        do {
            current = try bundleSigningIdentity(at: installed, verify: false)
        } catch {
            completion(nil, "Desktop applyUpdate cannot read this application's own signature: \(error.localizedDescription)")
            return
        }
        guard let currentTeam = current.teamIdentifier else {
            completion(nil, "Desktop applyUpdate refuses to update an application signed with no Team ID. "
                + "This install is ad-hoc or unsigned, so there is no signing identity an update could be required to match, "
                + "and accepting one anyway would accept every archive. Install a Developer ID signed build to update in place.")
            return
        }
        let archive = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: archive.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
            completion(nil, "Desktop applyUpdate archive does not identify an ordinary file")
            return
        }
        let staging = installed.deletingLastPathComponent().appendingPathComponent(".velar-update-\(UUID().uuidString)", isDirectory: true)
        DispatchQueue.global(qos: .userInitiated).async {
            let replacement: URL
            do {
                replacement = try Self.stageUpdate(archive: archive, staging: staging, identifier: current.bundleIdentifier, team: currentTeam)
            } catch {
                try? FileManager.default.removeItem(at: staging)
                DispatchQueue.main.async { completion(nil, error.localizedDescription) }
                return
            }
            do {
                _ = try FileManager.default.replaceItemAt(installed, withItemAt: replacement, backupItemName: nil, options: [])
            } catch {
                try? FileManager.default.removeItem(at: staging)
                DispatchQueue.main.async { completion(nil, "Desktop applyUpdate could not replace the installed application: \(error.localizedDescription)") }
                return
            }
            try? FileManager.default.removeItem(at: staging)
            DispatchQueue.main.async {
                // The renderer is answered before the relaunch, so the call it
                // made resolves rather than disappearing with the process.
                completion(NSNull(), nil)
                let configuration = NSWorkspace.OpenConfiguration()
                configuration.createsNewApplicationInstance = true
                NSWorkspace.shared.openApplication(at: installed, configuration: configuration) { _, _ in
                    DispatchQueue.main.async { NSApp.terminate(nil) }
                }
            }
        }
    }

    private static func stageUpdate(archive: URL, staging: URL, identifier: String, team: String) throws -> URL {
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: false)
        let expand = Process()
        expand.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        expand.arguments = ["-x", "-k", archive.path, staging.path]
        expand.standardInput = FileHandle.nullDevice
        expand.standardOutput = FileHandle.nullDevice
        expand.standardError = FileHandle.nullDevice
        try expand.run()
        expand.waitUntilExit()
        guard expand.terminationStatus == 0 else {
            throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop applyUpdate could not expand the archive"])
        }
        let entries = try FileManager.default.contentsOfDirectory(at: staging, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
        let bundles = entries.filter { $0.pathExtension == "app" }
        guard bundles.count == 1, let candidate = bundles.first else {
            throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey:
                "Desktop applyUpdate archive must contain exactly one application bundle; it contains \(bundles.count)"])
        }
        // Validity first: an identifier read out of an archive whose signature
        // does not check is a claim, not evidence.
        let update = try bundleSigningIdentity(at: candidate, verify: true)
        guard update.bundleIdentifier == identifier else {
            throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey:
                "Desktop applyUpdate refuses an archive whose bundle identifier is '\(update.bundleIdentifier)' and not '\(identifier)'"])
        }
        guard let updateTeam = update.teamIdentifier else {
            throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey:
                "Desktop applyUpdate refuses an archive signed with no Team ID"])
        }
        guard updateTeam == team else {
            throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey:
                "Desktop applyUpdate refuses an archive signed by Team ID '\(updateTeam)' and not '\(team)'"])
        }
        return candidate
    }

    /// Read-only probes. `microphone` is the only one of the three macOS answers
    /// in three states; screen recording and accessibility answer "granted" or
    /// "not yet", which is `undetermined` here — reporting `denied` for a
    /// checkbox the user has simply never seen would be a guess.
    func permissionStatus(_ arguments: [Any]) throws -> Any {
        guard arguments.count == 1, let kind = arguments[0] as? String else {
            throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop permissionStatus received an invalid kind"])
        }
        switch kind {
        case "screenRecording":
            return CGPreflightScreenCaptureAccess() ? "granted" : "undetermined"
        case "accessibility":
            return AXIsProcessTrusted() ? "granted" : "undetermined"
        case "microphone":
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized: return "granted"
            case .denied, .restricted: return "denied"
            default: return "undetermined"
            }
        default:
            throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Unknown Desktop system permission '\(kind)'"])
        }
    }
}

// MARK: - Service processes

/// The bounds one service channel keeps. The renderer states the receive bounds
/// again on its own side of the bridge (packages/desktop/src/compiler.ts) and
/// the fake host states them a third time
/// (packages/desktop/src/test-runtime.ts); the three must not drift.
private let maxServiceConnections = 64
private let maxServiceQueuedMessages = 1024
private let maxServiceQueuedBytes = 8 * 1024 * 1024
private let maxServiceMessageBytes = 8 * 1024 * 1024
private let maxServicePendingSendBytes = 8 * 1024 * 1024
private let maxServiceStreams = 32
/// Both sides of the handshake wait the same 30 seconds, and the same 30 seconds
/// is the grace a service gets between SIGTERM and SIGKILL. One number, three
/// places, because a service that is slow to start and a service that is slow to
/// stop are the same service.
private let serviceHandshakeTimeout: TimeInterval = 30
private let serviceTerminationGrace: TimeInterval = 30
private let serviceRestartInitialDelay: TimeInterval = 1
private let serviceRestartMaximumDelay: TimeInterval = 30
private let serviceRestartFailureLimit = 5
/// What a failed service is allowed to say for itself in a state event, and what
/// it may keep on disk. The renderer states the first of the two again on its own
/// side (packages/desktop/src/compiler.ts) and the fake host a third time
/// (packages/desktop/src/test-runtime.ts); the three must not drift.
///
/// 4 KiB is a stack trace and the lines around it — enough for an application to
/// show a person why a service died, and far short of a channel that would carry
/// a log. The log is the file below, which is where a whole log belongs.
private let maxServiceDetailBytes = 4 * 1024
private let maxServiceLogBytes = 1024 * 1024
private let serviceLogDirectoryName = "service-logs"

/// The frames the host and a service exchange before anything else crosses the
/// channel, pinned here and in `packages/desktop/README.md`. The host opens
/// every connection — the readiness probe and each `connect()` alike — by
/// sending the hello, and a service answers `service-ready` or it is not a
/// service this host will talk to. The token is the only authority on the
/// channel: a loopback port is reachable by every process on the machine, so a
/// service that answers before checking it has no authentication at all.
///
/// A hello this host will not accept is closed with 1008 — RFC 6455's policy
/// violation — and a service owes the host the same code. It is the difference
/// between a service that read the token and said no and a service that has not
/// finished binding its port yet; without it both are "the connection ended",
/// and a misconfigured token would be retried for thirty seconds and then
/// reported as a service that is merely slow.
private let serviceHelloKey = "velar"
private let serviceHelloValue = "service-hello"
private let serviceReadyValue = "service-ready"
private let serviceRefusedCloseCode = 1008

private enum ServiceState: String {
    case starting
    case ready
    case restarting
    case failed
    case stopped
}

/// What one handshake found. `unavailable` covers everything that is not yet a
/// service — nothing listening, no answer, an answer that is not the ready frame
/// — and `refused` is the one case the service said out loud.
private enum ServiceHandshakeOutcome {
    case ready
    case refused
    case unavailable
}

/// A service's whole output, on disk, where a person can read it after the fact.
/// `watchServices()` carries a 4 KiB tail because a state event is not a log
/// transport; this is the log, and it is bounded the way a log has to be — one
/// megabyte live, one rotation kept, nothing older. Both streams land in the
/// same file in arrival order, because a service's stdout and stderr interleave
/// in the story of what it was doing when it died.
private final class ServiceLog {
    private let path: URL
    private let rotated: URL
    private var handle: FileHandle?
    private var written = 0

    init(directory: URL, name: String) {
        self.path = directory.appendingPathComponent("\(name).log", isDirectory: false)
        self.rotated = directory.appendingPathComponent("\(name).log.1", isDirectory: false)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        open()
    }

    private func open() {
        let manager = FileManager.default
        if !manager.fileExists(atPath: path.path) { manager.createFile(atPath: path.path, contents: nil) }
        handle = try? FileHandle(forWritingTo: path)
        if let handle {
            written = Int((try? handle.seekToEnd()) ?? 0)
        }
    }

    /// Rotation is a rename and a fresh file, so an open reader keeps reading
    /// the bytes it already had rather than watching them be overwritten.
    private func rotate() {
        guard let handle else { return }
        try? handle.close()
        self.handle = nil
        let manager = FileManager.default
        try? manager.removeItem(at: rotated)
        try? manager.moveItem(at: path, to: rotated)
        written = 0
        open()
    }

    func append(_ data: Data) {
        guard !data.isEmpty else { return }
        if written + data.count > maxServiceLogBytes { rotate() }
        guard let handle else { return }
        // A log that cannot be written is not a reason to lose a service: the
        // write is attempted and its failure is not propagated anywhere.
        try? handle.write(contentsOf: data)
        written += data.count
    }

    func close() {
        try? handle?.close()
        handle = nil
    }
}

/// The tail of a service's stderr, kept as bytes rather than as text because the
/// bound is a byte bound and a service writes bytes. It is decoded once, when a
/// state event needs it.
private struct ServiceErrorTail {
    private var bytes = Data()

    mutating func append(_ data: Data) {
        bytes.append(data)
        if bytes.count > maxServiceDetailBytes {
            bytes = Data(bytes.suffix(maxServiceDetailBytes))
        }
    }

    mutating func clear() { bytes = Data() }

    /// A byte tail can begin inside a UTF-8 sequence and end inside another, so
    /// both partial sequences are dropped rather than decoded into replacement
    /// characters that say nothing. Control characters go too — a service that
    /// writes ANSI colour or a progress bar's carriage returns should not be
    /// able to rewrite the line an application shows a person — except the
    /// newline, which is what makes a stack trace readable.
    func text() -> String? {
        var tail = bytes[...]
        while let first = tail.first, first & 0xC0 == 0x80 { tail = tail.dropFirst() }
        tail = tail.prefix(tail.count - incompleteTrailingBytes(tail))
        guard !tail.isEmpty else { return nil }
        var text = ""
        for scalar in String(decoding: tail, as: UTF8.self).unicodeScalars {
            if scalar == "\n" { text.unicodeScalars.append(scalar); continue }
            if scalar.value < 0x20 || scalar.value == 0x7F || (scalar.value >= 0x80 && scalar.value <= 0x9F) { continue }
            text.unicodeScalars.append(scalar)
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// How many bytes at the end belong to a sequence whose remaining bytes were
    /// never written — a service killed mid-character, or a tail cut at 4 KiB.
    private func incompleteTrailingBytes(_ tail: Data.SubSequence) -> Int {
        var scanned = 0
        var index = tail.endIndex
        while scanned < 4, index > tail.startIndex {
            index = tail.index(before: index)
            let byte = tail[index]
            scanned += 1
            if byte & 0xC0 == 0x80 { continue }
            let expected: Int
            if byte & 0x80 == 0 { expected = 1 }
            else if byte & 0xE0 == 0xC0 { expected = 2 }
            else if byte & 0xF0 == 0xE0 { expected = 3 }
            else if byte & 0xF8 == 0xF0 { expected = 4 }
            else { return scanned }
            return scanned < expected ? scanned : 0
        }
        return 0
    }
}

/// One service's captured output for the whole of its life across restarts: the
/// log file it all goes to, and the stderr tail the current start is allowed to
/// quote. Foundation delivers a file handle's readability callbacks on its own
/// queue, so everything here is under one lock — the two streams share a file,
/// and a state event reads the tail from the main thread while a service is
/// still writing to it.
private final class ServiceOutputCapture {
    private let lock = NSLock()
    private let log: ServiceLog
    private var tail = ServiceErrorTail()
    private var outputHandle: FileHandle?
    private var errorHandle: FileHandle?

    init(directory: URL, name: String) {
        log = ServiceLog(directory: directory, name: name)
    }

    /// The two streams of one start. The tail is cleared here because a failure
    /// is explained by the run that failed, not by the run before it.
    func begin(output: Pipe, errors: Pipe) {
        end()
        lock.lock()
        tail.clear()
        lock.unlock()
        let readOutput = output.fileHandleForReading
        let readErrors = errors.fileHandleForReading
        outputHandle = readOutput
        errorHandle = readErrors
        readOutput.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard let self, !data.isEmpty else { return }
            self.lock.lock()
            self.log.append(data)
            self.lock.unlock()
        }
        readErrors.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard let self, !data.isEmpty else { return }
            self.lock.lock()
            self.log.append(data)
            self.tail.append(data)
            self.lock.unlock()
        }
    }

    /// The end of one start: the handlers are removed and whatever the process
    /// wrote on the way out is drained before anything asks what it said. The
    /// drain is non-blocking on purpose — a service's last words are worth
    /// waiting for, and not worth deadlocking the main thread over.
    func end() {
        let readOutput = outputHandle
        let readErrors = errorHandle
        outputHandle = nil
        errorHandle = nil
        readOutput?.readabilityHandler = nil
        readErrors?.readabilityHandler = nil
        let remainingOutput = readOutput.map { drainAvailable($0) } ?? Data()
        let remainingErrors = readErrors.map { drainAvailable($0) } ?? Data()
        lock.lock()
        if !remainingOutput.isEmpty { log.append(remainingOutput) }
        if !remainingErrors.isEmpty {
            log.append(remainingErrors)
            tail.append(remainingErrors)
        }
        lock.unlock()
        try? readOutput?.close()
        try? readErrors?.close()
    }

    func detail() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return tail.text()
    }

    func close() {
        end()
        lock.lock()
        log.close()
        lock.unlock()
    }
}

/// Everything a descriptor already holds, and nothing more: the descriptor is
/// put in non-blocking mode first, so a write end this host still owns cannot
/// turn "read what is left" into "wait for a writer that will never write".
private func drainAvailable(_ handle: FileHandle) -> Data {
    let descriptor = handle.fileDescriptor
    guard descriptor >= 0 else { return Data() }
    let flags = fcntl(descriptor, F_GETFL, 0)
    guard flags >= 0, fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0 else { return Data() }
    var collected = Data()
    var buffer = [UInt8](repeating: 0, count: 16 * 1024)
    while collected.count < maxServiceLogBytes {
        let read = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
        if read <= 0 { break }
        collected.append(contentsOf: buffer[0..<read])
    }
    _ = fcntl(descriptor, F_SETFL, flags)
    return collected
}

/// One bounded pull stream of `{name, state}` events. A slow consumer keeps the
/// latest state per service rather than a history of transitions: a reader that
/// woke up late wants to know what is true now, and an unbounded transition log
/// is a queue that grows while nobody reads it.
private final class ServiceStateWatcher {
    let handle: Int
    let generation: String
    var events: [(name: String, state: ServiceState, detail: String?)] = []
    var pending: ((Any) -> Void)?
    var closed = false

    init(handle: Int, generation: String) {
        self.handle = handle
        self.generation = generation
    }
}

private final class ServiceConnectionRecord {
    let handle: Int
    let name: String
    let generation: String
    let task: URLSessionWebSocketTask
    var queue: [String] = []
    var queuedBytes = 0
    var pendingSendBytes = 0
    var pending: ((Any?, String?) -> Void)?
    var closed = false
    var closeCode = 1006
    var closeReason = "the service channel ended without a close frame"

    init(handle: Int, name: String, generation: String, task: URLSessionWebSocketTask) {
        self.handle = handle
        self.name = name
        self.generation = generation
        self.task = task
    }
}

private final class ServiceRecord {
    let name: String
    let entry: URL
    let payload: URL
    let restartAlways: Bool
    var state: ServiceState = .starting
    var detail: String?
    var process: Process?
    var token = ""
    var port: UInt16 = 0
    var consecutiveFailures = 0
    /// Bumped on every start and carried by that start's probe and termination
    /// handler, so a reply belonging to a process this supervisor has already
    /// replaced is discarded instead of moving the current one's state.
    var generation = 0
    /// The generation whose failure has already been counted. A start can be
    /// found to have failed twice — the readiness deadline and the token
    /// refusal both end the process, and the process ending is itself a
    /// failure report — and one start is one failure, so the second report is
    /// the same news arriving by the other route. `0` is before the first
    /// start, which is never a counted generation.
    var countedFailure = 0
    /// This service's log file and the stderr tail of its current start.
    var capture: ServiceOutputCapture?
    /// The host's own account of the last failure, for the case where the
    /// service produced no stderr to quote — it refused the token, or never got
    /// far enough to say anything at all.
    var hostReason: String?

    init(name: String, entry: URL, payload: URL, restartAlways: Bool) {
        self.name = name
        self.entry = entry
        self.payload = payload
        self.restartAlways = restartAlways
    }

    /// What a failing state carries: the service's own last words when it left
    /// any, and the host's account of the failure when it did not.
    func failureDetail() -> String? {
        if let quoted = capture?.detail() { return quoted }
        return hostReason
    }
}

/// The four things the language does for a product's service processes: start
/// them, supervise them, converge them when the application quits, and hand the
/// renderer one authenticated loopback channel to each. It does not sandbox
/// them, inspect their traffic, or route anything between them — a service is
/// the product's code under the product's policy, and the manifest declares it
/// so that it is auditable rather than so that it is confined.
///
/// One instance per application, on the main thread beside `HostServices`,
/// because a service belongs to the application's lifetime rather than to any
/// window's.
private final class ServiceSupervisor: NSObject, URLSessionDelegate {
    private let runtime: URL
    private let logDirectory: URL
    /// The directory `velar/desktop.appDataDirectory()` answers, which every
    /// service is told in its environment. It is the one thing a service cannot
    /// work out for itself and cannot be given at build time: it is derived from
    /// the bundle identity at run time, and a service that guessed at it would
    /// be reimplementing the host's own rule beside the host.
    private let appDataDirectory: URL
    private let records: [String: ServiceRecord]
    private let order: [String]
    private var watchers: [Int: ServiceStateWatcher] = [:]
    private var connections: [Int: ServiceConnectionRecord] = [:]
    private var nextWatcherHandle = 1
    private var nextConnectionHandle = 1
    private var converging = false
    private lazy var session = URLSession(configuration: .ephemeral)

    var declaredNames: [String] { order }

    init(runtime: URL, servicesRoot: URL, logDirectory: URL, appDataDirectory: URL, services: [String: ServiceConfiguration]) {
        self.runtime = runtime
        self.logDirectory = logDirectory
        self.appDataDirectory = appDataDirectory
        self.order = services.keys.sorted()
        var records: [String: ServiceRecord] = [:]
        for name in order {
            guard let declared = services[name] else { continue }
            let payload = servicesRoot.appendingPathComponent(name, isDirectory: true)
            records[name] = ServiceRecord(
                name: name,
                entry: payload.appendingPathComponent(declared.entry),
                payload: payload,
                restartAlways: declared.restart == "always"
            )
        }
        self.records = records
        super.init()
    }

    /// Started before the renderer loads and never awaited. An application that
    /// needs a service reads `watchServices()` or calls `connect()`; an
    /// application that does not is not made to wait for one.
    func start() {
        for name in order {
            guard let record = records[name] else { continue }
            launch(record)
        }
    }

    func state(of name: String) -> ServiceState? { records[name]?.state }

    func report() -> [[String: Any]] {
        order.compactMap { name in
            guard let record = records[name] else { return nil }
            return ["name": name, "state": record.state.rawValue]
        }
    }

    /// The one-line account the headless smoke prints when a service did not come
    /// up. It carries the detail because a smoke that said only `notes=failed`
    /// would make a person open the log to learn what `watchServices()` was
    /// already prepared to tell them.
    func settlement() -> String {
        order.compactMap { name -> String? in
            guard let record = records[name] else { return nil }
            guard let detail = record.detail else { return "\(name)=\(record.state.rawValue)" }
            return "\(name)=\(record.state.rawValue): \(detail.replacingOccurrences(of: "\n", with: " "))"
        }.joined(separator: ", ")
    }

    // MARK: - Lifecycle

    private func launch(_ record: ServiceRecord) {
        guard !converging else { return }
        guard let port = allocateLoopbackPort(), let token = randomServiceToken() else {
            fail(record, "VelarScript Desktop could not allocate a loopback endpoint for service '\(record.name)'")
            return
        }
        record.port = port
        record.token = token
        record.generation += 1
        // This start's failure is this start's to explain, so the previous run's
        // account of itself does not survive into it.
        record.hostReason = nil
        let generation = record.generation
        let process = Process()
        process.executableURL = runtime
        process.arguments = [record.entry.path]
        process.currentDirectoryURL = record.payload
        // Both streams are captured: they go to this service's log file whole,
        // and the last 4 KiB of stderr is what a `failed` or `restarting` event
        // carries. A service whose output went to the host's own stderr would be
        // a service nobody can read after the window it crashed behind is gone.
        let capture = record.capture ?? ServiceOutputCapture(directory: logDirectory, name: record.name)
        record.capture = capture
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        capture.begin(output: output, errors: errors)
        // The product's own process, so the product's own environment: a service
        // is not capability-scoped and `desktop.permissions.environment` governs
        // what the *renderer* may read, not what the product's process inherits.
        //
        // Three variables, and only three. The endpoint and the token are this
        // start's channel; the app-data directory is the application's identity
        // resolved to a path, which a payload cannot carry because it is not
        // known until this bundle runs on this machine.
        var environment = ProcessInfo.processInfo.environment
        environment["VELAR_SERVICE_ENDPOINT"] = "127.0.0.1:\(port)"
        environment["VELAR_SERVICE_TOKEN"] = token
        environment["VELAR_SERVICE_APP_DATA"] = appDataDirectory.path
        process.environment = environment
        process.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async {
                self?.processEnded(record, generation: generation, status: finished.terminationStatus)
            }
        }
        do {
            try process.run()
        } catch {
            record.process = nil
            record.hostReason = "the service could not be started: \(error.localizedDescription)"
            capture.end()
            publish(record, .starting)
            recordFailure(record, generation: generation)
            return
        }
        record.process = process
        publish(record, .starting)
        probeReadiness(record, generation: generation, deadline: Date().addingTimeInterval(serviceHandshakeTimeout))
    }

    /// Readiness is the handshake, retried until its deadline: a process that has
    /// started is not a service until something answers on the endpoint it was
    /// given, and an unreachable endpoint a millisecond after `spawn` is the
    /// normal case rather than a failure.
    ///
    /// A service that closes the hello with 1008 is the one answer worth ending
    /// the probe on. It read the token and refused it, and it will refuse the
    /// same token for the whole of the deadline, so retrying for thirty seconds
    /// and then reporting a slow start would describe the wrong problem.
    private func probeReadiness(_ record: ServiceRecord, generation: Int, deadline: Date) {
        guard !converging, record.generation == generation, record.state != .ready else { return }
        guard Date() < deadline else {
            // The readiness deadline is a start that failed, not a service that
            // is merely slow: the process is ended and the restart policy is
            // asked what to do next.
            record.hostReason = "the service did not answer the authenticated handshake within \(Int(serviceHandshakeTimeout))s"
            record.process?.terminate()
            recordFailure(record, generation: generation)
            return
        }
        handshake(port: record.port, token: record.token) { [weak self] outcome, task in
            guard let self else { return }
            // The probe's own connection is closed once it has its answer. It
            // proved the service authenticates; it is not an application channel.
            task?.cancel()
            guard !self.converging, record.generation == generation else { return }
            if outcome == .ready {
                record.consecutiveFailures = 0
                self.publish(record, .ready)
                return
            }
            if outcome == .refused {
                record.hostReason = "the service refused the token this host issued it (close \(serviceRefusedCloseCode)); it is reading something other than VELAR_SERVICE_TOKEN"
                record.process?.terminate()
                self.recordFailure(record, generation: generation)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                self?.probeReadiness(record, generation: generation, deadline: deadline)
            }
        }
    }

    private func processEnded(_ record: ServiceRecord, generation: Int, status: Int32) {
        guard !converging, record.generation == generation else { return }
        record.process = nil
        // Whatever the process wrote on its way out is drained before the state
        // event that quotes it goes anywhere.
        record.capture?.end()
        if record.hostReason == nil {
            record.hostReason = status == 0
                ? "the service process exited with status 0"
                : "the service process exited with status \(status)"
        }
        closeConnections(of: record.name, code: 1001, reason: "the service process ended")
        recordFailure(record, generation: generation)
    }

    /// One failure, and what the declared policy makes of it. `never` records the
    /// exit and stops; `always` backs off exponentially from one second to a
    /// thirty-second cap, and five consecutive failures end in `failed`, which is
    /// terminal — a restart loop nobody is watching is worse than a state the
    /// application can show a person.
    ///
    /// A start is counted once. The generation guard is the same one `launch`
    /// already stands behind, extended from "this reply belongs to the current
    /// start" to "this start has not been declared failed yet": the readiness
    /// deadline terminates the process and reports the failure, and the
    /// termination it caused arrives immediately afterwards carrying the same
    /// generation. Both are true and both are this one start, so counting both
    /// spent the five-failure budget at twice the rate the manifest promises
    /// and reached the terminal `failed` after three real timeouts.
    private func recordFailure(_ record: ServiceRecord, generation: Int) {
        guard record.generation == generation, record.countedFailure != generation else { return }
        record.countedFailure = generation
        guard record.restartAlways else {
            publish(record, .stopped)
            return
        }
        record.consecutiveFailures += 1
        guard record.consecutiveFailures < serviceRestartFailureLimit else {
            publish(record, .failed, detail: record.failureDetail())
            return
        }
        publish(record, .restarting, detail: record.failureDetail())
        let delay = min(serviceRestartMaximumDelay, serviceRestartInitialDelay * pow(2, Double(record.consecutiveFailures - 1)))
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, !self.converging, record.generation == generation, record.state == .restarting else { return }
            self.launch(record)
        }
    }

    private func fail(_ record: ServiceRecord, _ message: String) {
        FileHandle.standardError.write(Data("\(message)\n".utf8))
        record.hostReason = message
        publish(record, .failed, detail: record.failureDetail())
    }

    /// SIGTERM, then SIGKILL after the grace period, and no restart in between:
    /// once the application is quitting a service that exits is converging rather
    /// than crashing. Blocking here is deliberate — `applicationWillTerminate` is
    /// the last moment this process can still reap what it started.
    func converge() {
        guard !converging else { return }
        converging = true
        for (_, connection) in connections { connection.task.cancel() }
        connections.removeAll(keepingCapacity: false)
        var running: [ServiceRecord] = []
        for name in order {
            guard let record = records[name] else { continue }
            guard let process = record.process, process.isRunning else {
                publish(record, .stopped)
                continue
            }
            process.terminate()
            running.append(record)
        }
        let deadline = Date().addingTimeInterval(serviceTerminationGrace)
        while Date() < deadline, running.contains(where: { $0.process?.isRunning == true }) {
            usleep(20_000)
        }
        for record in running {
            if let process = record.process, process.isRunning {
                kill(process.processIdentifier, SIGKILL)
            }
            record.process = nil
            publish(record, .stopped)
        }
        // The log files are the one thing that outlives this process, so they are
        // closed rather than left to the exit that follows.
        for name in order { records[name]?.capture?.close() }
    }

    // MARK: - The channel

    /// The host dials, the host authenticates, and the renderer receives an
    /// already-authenticated channel. The token never reaches application code:
    /// it is generated here, handed to the service process in its environment,
    /// and spent here on the first frame of every connection.
    func connect(name: String, generation: String, completion: @escaping (Any?, String?) -> Void) {
        guard let record = records[name] else {
            completion(nil, "Desktop service '\(name)' is not declared in 'desktop.services'")
            return
        }
        guard !converging else {
            completion(nil, "Desktop service '\(name)' is unavailable while the application is quitting")
            return
        }
        guard connections.count < maxServiceConnections else {
            completion(nil, "Desktop cannot own more than \(maxServiceConnections) service connections")
            return
        }
        guard record.state == .ready else {
            completion(nil, "Desktop service '\(name)' is \(record.state.rawValue) rather than ready; watchServices() reports when it becomes ready")
            return
        }
        handshake(port: record.port, token: record.token) { [weak self] outcome, task in
            guard let self else { return }
            guard outcome == .ready, let task else {
                task?.cancel()
                completion(nil, outcome == .refused
                    ? "Desktop service '\(name)' refused the token this host issued it"
                    : "Desktop service '\(name)' did not complete the authenticated handshake")
                return
            }
            guard !self.converging, self.connections.count < maxServiceConnections else {
                task.cancel()
                completion(nil, "Desktop service '\(name)' is unavailable")
                return
            }
            let handle = self.nextConnectionHandle
            self.nextConnectionHandle += 1
            let connection = ServiceConnectionRecord(handle: handle, name: name, generation: generation, task: task)
            self.connections[handle] = connection
            self.receiveNext(connection)
            completion(handle, nil)
        }
    }

    func send(handle: Int, generation: String, message: String, completion: @escaping (Any?, String?) -> Void) {
        guard let connection = connections[handle], connection.generation == generation, !connection.closed else {
            completion(nil, "Desktop service connection is closed or unknown")
            return
        }
        let bytes = message.utf8.count
        guard bytes <= maxServiceMessageBytes else {
            completion(nil, "Desktop service message exceeds the \(maxServiceMessageBytes)-byte channel bound")
            return
        }
        guard connection.pendingSendBytes + bytes <= maxServicePendingSendBytes else {
            completion(nil, "Desktop service connection has \(connection.pendingSendBytes) bytes of unsent messages; await send before sending more")
            return
        }
        connection.pendingSendBytes += bytes
        connection.task.send(.string(message)) { [weak self] error in
            DispatchQueue.main.async {
                connection.pendingSendBytes -= bytes
                guard let error else {
                    completion(NSNull(), nil)
                    return
                }
                self?.close(handle: handle, generation: generation, code: 1006, reason: "send failed")
                completion(nil, "Desktop service send failed: \(error.localizedDescription)")
            }
        }
    }

    func receive(handle: Int, generation: String, completion: @escaping (Any?, String?) -> Void) {
        guard let connection = connections[handle], connection.generation == generation else {
            completion(NSNull(), nil)
            return
        }
        guard connection.pending == nil else {
            completion(nil, "ServiceConnection.next already has an active pull")
            return
        }
        if !connection.queue.isEmpty {
            completion(connection.queue.removeFirst(), nil)
            connection.queuedBytes = connection.queue.reduce(0) { $0 + $1.utf8.count }
            return
        }
        if connection.closed {
            connections.removeValue(forKey: handle)
            completion(NSNull(), nil)
            return
        }
        connection.pending = completion
    }

    func closeInfo(handle: Int, generation: String) throws -> [String: Any] {
        guard let connection = connections[handle], connection.generation == generation else {
            throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Desktop service connection is unknown"])
        }
        return ["code": connection.closeCode, "reason": connection.closeReason]
    }

    func connectionState(handle: Int, generation: String) -> String {
        guard let connection = connections[handle], connection.generation == generation else { return "closed" }
        return connection.closed ? "closed" : "open"
    }

    @discardableResult
    func close(handle: Int, generation: String, code: Int, reason: String) -> Bool {
        guard let connection = connections[handle], connection.generation == generation else { return false }
        finish(connection, code: code, reason: reason)
        connections.removeValue(forKey: handle)
        return true
    }

    private func receiveNext(_ connection: ServiceConnectionRecord) {
        connection.task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, self.connections[connection.handle] === connection else { return }
                switch result {
                case .failure(let error):
                    self.finish(connection, code: connection.closeCode, reason: error.localizedDescription)
                case .success(let message):
                    var text: String
                    switch message {
                    case .string(let value):
                        text = value
                    case .data(let value):
                        // The Desktop bridge carries text, so a binary frame is
                        // refused rather than silently decoded into something
                        // that is not what the service sent.
                        _ = value
                        self.finish(connection, code: 1003, reason: "a Desktop service channel carries text frames")
                        return
                    @unknown default:
                        self.finish(connection, code: 1003, reason: "a Desktop service channel carries text frames")
                        return
                    }
                    self.deliver(connection, text)
                    if !connection.closed { self.receiveNext(connection) }
                }
            }
        }
    }

    private func deliver(_ connection: ServiceConnectionRecord, _ text: String) {
        let bytes = text.utf8.count
        guard bytes <= maxServiceMessageBytes else {
            finish(connection, code: 1009, reason: "the service sent a message above the \(maxServiceMessageBytes)-byte channel bound")
            return
        }
        if let pending = connection.pending, connection.queue.isEmpty {
            connection.pending = nil
            pending(text, nil)
            return
        }
        // A bounded pull stream that dropped messages would be a channel that
        // silently loses a product's data, so the answer to a reader that never
        // reads is to end the channel and say why.
        guard connection.queue.count < maxServiceQueuedMessages, connection.queuedBytes + bytes <= maxServiceQueuedBytes else {
            finish(connection, code: 1009, reason: "the application did not read this service channel and its receive queue reached its bound")
            return
        }
        connection.queue.append(text)
        connection.queuedBytes += bytes
    }

    private func finish(_ connection: ServiceConnectionRecord, code: Int, reason: String) {
        guard !connection.closed else { return }
        connection.closed = true
        connection.closeCode = code
        connection.closeReason = reason
        connection.task.cancel(with: URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure, reason: nil)
        if let pending = connection.pending {
            connection.pending = nil
            pending(NSNull(), nil)
        }
    }

    private func closeConnections(of name: String, code: Int, reason: String) {
        for (handle, connection) in connections where connection.name == name {
            finish(connection, code: code, reason: reason)
            connections.removeValue(forKey: handle)
        }
    }

    /// One connection, one hello, one answer. Every channel this host opens —
    /// the readiness probe and each application connection — starts the same way,
    /// so a service implements authentication once.
    ///
    /// `refused` is the service closing with 1008 rather than answering, and it
    /// is separated from `unavailable` because only one of the two is worth
    /// telling a person about: an endpoint that is not up yet becomes one that
    /// is, and a token a service will not accept stays one.
    private func handshake(port: UInt16, token: String, completion: @escaping (ServiceHandshakeOutcome, URLSessionWebSocketTask?) -> Void) {
        guard let url = URL(string: "ws://127.0.0.1:\(port)/"),
              let hello = try? JSONSerialization.data(withJSONObject: [serviceHelloKey: serviceHelloValue, "token": token]),
              let helloText = String(data: hello, encoding: .utf8) else {
            completion(.unavailable, nil)
            return
        }
        let task = session.webSocketTask(with: url)
        var settled = false
        let settle: (ServiceHandshakeOutcome, URLSessionWebSocketTask?) -> Void = { outcome, value in
            DispatchQueue.main.async {
                guard !settled else { return }
                settled = true
                completion(outcome, value)
            }
        }
        // A hello that was delivered and then answered with nothing may have been
        // refused, and the close frame carrying the code races the read failure
        // that reports it. A quarter of a second is the grace that lets the code
        // arrive before it is read; its absence simply means `unavailable`. A
        // hello that never left at all had nobody to refuse it, so that path
        // settles immediately and the probe retries at its usual pace.
        let settleAfterDeliveredHello: () -> Void = {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                let outcome: ServiceHandshakeOutcome = task.closeCode.rawValue == serviceRefusedCloseCode ? .refused : .unavailable
                settle(outcome, nil)
                task.cancel()
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + serviceHandshakeTimeout) {
            guard !settled else { return }
            task.cancel()
            settle(.unavailable, nil)
        }
        task.resume()
        task.send(.string(helloText)) { error in
            if error != nil {
                task.cancel()
                settle(.unavailable, nil)
                return
            }
            task.receive { result in
                guard case .success(.string(let answer)) = result,
                      let data = answer.data(using: .utf8),
                      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      object[serviceHelloKey] as? String == serviceReadyValue else {
                    settleAfterDeliveredHello()
                    return
                }
                settle(.ready, task)
            }
        }
    }

    // MARK: - State stream

    func watchStart(generation: String) throws -> Int {
        guard watchers.count < maxServiceStreams else {
            throw NSError(domain: "VelarDesktop", code: 429, userInfo: [NSLocalizedDescriptionKey: "Desktop host cannot own more than \(maxServiceStreams) service state streams"])
        }
        let handle = nextWatcherHandle
        nextWatcherHandle += 1
        let watcher = ServiceStateWatcher(handle: handle, generation: generation)
        // A stream that started after the services did would otherwise report
        // nothing until the next transition, so it opens with what is true now.
        for name in order {
            guard let record = records[name] else { continue }
            watcher.events.append((name: name, state: record.state, detail: record.detail))
        }
        watchers[handle] = watcher
        return handle
    }

    func watchNext(handle: Int, generation: String, deliver: @escaping (Any) -> Void) throws {
        guard let watcher = watchers[handle], watcher.generation == generation else {
            throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Desktop ServiceStateStream handle is unknown or already released"])
        }
        guard watcher.pending == nil else {
            throw NSError(domain: "VelarDesktop", code: 409, userInfo: [NSLocalizedDescriptionKey: "ServiceStateStream.next already has an active pull"])
        }
        if !watcher.events.isEmpty {
            let event = watcher.events.removeFirst()
            deliver(serviceEvent(event.name, event.state, event.detail))
            return
        }
        watcher.pending = deliver
    }

    @discardableResult
    func watchClose(handle: Int, generation: String) -> Bool {
        guard let watcher = watchers[handle], watcher.generation == generation else { return false }
        watcher.closed = true
        watcher.pending = nil
        watchers.removeValue(forKey: handle)
        return true
    }

    func retire(generation: String) {
        for (handle, watcher) in watchers where watcher.generation == generation {
            watcher.closed = true
            watcher.pending = nil
            watchers.removeValue(forKey: handle)
        }
        for (handle, connection) in connections where connection.generation == generation {
            finish(connection, code: 1001, reason: "the document that owned this service connection went away")
            connections.removeValue(forKey: handle)
        }
    }

    /// A detail rides with the two states that failed at something and with no
    /// other, so a reader never has to ask whether the text it is holding
    /// describes the state it arrived beside.
    private func publish(_ record: ServiceRecord, _ state: ServiceState, detail: String? = nil) {
        let carried = (state == .failed || state == .restarting) ? detail : nil
        record.state = state
        record.detail = carried
        for (_, watcher) in watchers where !watcher.closed {
            if let pending = watcher.pending, watcher.events.isEmpty {
                watcher.pending = nil
                pending(serviceEvent(record.name, state, carried))
                continue
            }
            // Keep-latest per service: a slow reader learns what each service is
            // now, not every transition it missed.
            if let index = watcher.events.firstIndex(where: { $0.name == record.name }) {
                watcher.events[index] = (name: record.name, state: state, detail: carried)
                continue
            }
            watcher.events.append((name: record.name, state: state, detail: carried))
        }
    }

    /// The one place a state event is shaped, so the renderer's three fields and
    /// the host's three fields are the same three fields.
    private func serviceEvent(_ name: String, _ state: ServiceState, _ detail: String?) -> [String: Any] {
        ["name": name, "state": state.rawValue, "detail": detail ?? NSNull()]
    }
}

/// A port the operating system chose, released immediately so the service can
/// bind it. The window between the two is a race this host accepts: the
/// alternative is passing a bound descriptor into a process the product wrote,
/// which would make every service implementation depend on inheriting a file
/// descriptor by number.
private func allocateLoopbackPort() -> UInt16? {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else { return nil }
    defer { Darwin.close(descriptor) }
    var address = sockaddr_in()
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = 0
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    let bound = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { rebound in
            Darwin.bind(descriptor, rebound, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    guard bound == 0 else { return nil }
    var assigned = sockaddr_in()
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let named = withUnsafeMutablePointer(to: &assigned) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { rebound in
            getsockname(descriptor, rebound, &length)
        }
    }
    guard named == 0 else { return nil }
    let port = UInt16(bigEndian: assigned.sin_port)
    return port == 0 ? nil : port
}

/// 128 bits from the system's own generator, hex-encoded. It is the whole
/// authentication of a loopback channel every process on the machine can reach,
/// so it is neither derived from a path nor seeded from a clock.
private func randomServiceToken() -> String? {
    var bytes = [UInt8](repeating: 0, count: 16)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
    return bytes.map { String(format: "%02x", $0) }.joined()
}

/// The web view a Desktop window renders into. It exists for one reason: a drag
/// gesture's real filesystem paths are on the pasteboard of the very operation
/// that hands the drop to WebKit, and nowhere afterwards.
private final class VelarWebView: WKWebView {
    weak var services: HostServices?

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        services?.registerDroppedFiles(sender.draggingPasteboard)
        return super.performDragOperation(sender)
    }
}

private final class WindowRecord {
    let handle: Int
    let kind: String
    let key: String?
    let window: NSWindow
    let webView: WKWebView
    let bridge: DesktopBridge
    let navigation: NavigationPolicy
    var watchers = Set<Int>()
    var closed = false

    init(handle: Int, kind: String, key: String?, window: NSWindow, webView: WKWebView, bridge: DesktopBridge, navigation: NavigationPolicy) {
        self.handle = handle
        self.kind = kind
        self.key = key
        self.window = window
        self.webView = webView
        self.bridge = bridge
        self.navigation = navigation
    }
}

/// The window system: kind plus optional key is a window's identity, and one
/// registry owns every window, its document bridge, and the bounded state
/// streams watching it. Everything here runs on the main thread, which is where
/// WebKit delivers script messages and where AppKit requires window work.
private final class WindowRegistry: NSObject, NSWindowDelegate {
    private let host: HostConfiguration
    private let resources: URL
    private let schemeHandler: AssetSchemeHandler
    private let projectGrant: ProjectDirectoryGrant
    private let projectFilesGranted: Bool
    private let worker: NodeCapabilityHost
    private let services: HostServices
    private let supervisor: ServiceSupervisor?
    private let environmentJSON: String
    private let headless: Bool
    private var records: [Int: WindowRecord] = [:]
    private var watchers: [Int: WindowStateWatcher] = [:]
    private var handlesByWindow: [ObjectIdentifier: Int] = [:]
    private var nextHandle = 1
    private var nextWatcherHandle = 1
    private var closingAll = false

    init(
        host: HostConfiguration,
        resources: URL,
        schemeHandler: AssetSchemeHandler,
        projectGrant: ProjectDirectoryGrant,
        projectFilesGranted: Bool,
        worker: NodeCapabilityHost,
        services: HostServices,
        supervisor: ServiceSupervisor?,
        environmentJSON: String,
        headless: Bool
    ) {
        self.host = host
        self.resources = resources
        self.schemeHandler = schemeHandler
        self.projectGrant = projectGrant
        self.projectFilesGranted = projectFilesGranted
        self.worker = worker
        self.services = services
        self.supervisor = supervisor
        self.environmentJSON = environmentJSON
        self.headless = headless
    }

    // MARK: - Operations

    @discardableResult
    func open(kind: String, route: String, key: String?, bounds: WindowBounds?) throws -> Int {
        guard let declared = host.windows[kind] else {
            throw NSError(domain: "VelarDesktop", code: 403, userInfo: [NSLocalizedDescriptionKey:
                "Desktop window kind '\(kind)' is not declared under 'desktop.windows' (declared kinds: \(host.windows.keys.sorted().joined(separator: ", ")))"])
        }
        try validate(route: route)
        if let key { try validate(key: key) }
        if let existing = identity(kind: kind, key: key) {
            try focus(existing.handle)
            return existing.handle
        }
        guard records.count < 64 else {
            throw NSError(domain: "VelarDesktop", code: 429, userInfo: [NSLocalizedDescriptionKey: "Desktop application cannot hold more than 64 windows open"])
        }
        let handle = nextHandle
        nextHandle += 1
        let record = try build(handle: handle, kind: kind, key: key, declared: declared, route: route, bounds: bounds)
        records[handle] = record
        handlesByWindow[ObjectIdentifier(record.window)] = handle
        if !headless {
            if declared.style == "panel" {
                // A panel is shown without activating the application, which is
                // the behaviour that makes it a panel rather than a window.
                record.window.orderFrontRegardless()
            } else {
                record.window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
            }
        }
        return handle
    }

    func focus(_ handle: Int) throws {
        let record = try owned(handle)
        guard !headless else { return }
        record.window.makeKeyAndOrderFront(nil)
        if record.window is NSPanel { return }
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Releasing a window handle closes the window, and a handle whose window is
    /// already gone answers false rather than failing: the release is idempotent
    /// because closing what is already closed is the state it is already in.
    @discardableResult
    func close(_ handle: Int) -> Bool {
        guard let record = records[handle], !record.closed else { return false }
        record.window.performClose(nil)
        // `performClose` consults the delegate; a window that refuses is closed
        // outright, because the application asked rather than the user.
        if records[handle] != nil, !record.closed { record.window.close() }
        return true
    }

    func bounds(_ handle: Int) throws -> [String: Any] {
        topLeftBounds(try owned(handle).window.frame)
    }

    func setBounds(_ handle: Int, bounds: WindowBounds) throws {
        let record = try owned(handle)
        record.window.setFrame(clamp(windowFrame(bounds), to: record.window), display: true)
    }

    func display(_ handle: Int) throws -> [String: Any] {
        let record = try owned(handle)
        let screen = record.window.screen ?? NSScreen.main ?? NSScreen.screens.first
        guard let screen else {
            throw NSError(domain: "VelarDesktop", code: 500, userInfo: [NSLocalizedDescriptionKey: "Desktop host found no attached display"])
        }
        let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        return [
            "id": number.map { "display-\($0.uint32Value)" } ?? "display-unknown",
            "bounds": topLeftBounds(screen.frame),
            "workArea": topLeftBounds(screen.visibleFrame),
            "scale": Double(screen.backingScaleFactor),
            "primary": screen == NSScreen.screens.first,
        ]
    }

    func list() -> [[String: Any]] {
        records.values
            .filter { !$0.closed }
            .sorted { $0.handle < $1.handle }
            .map { ["kind": $0.kind, "key": $0.key.map { $0 as Any } ?? NSNull(), "focused": $0.window.isKeyWindow] }
    }

    // MARK: - Bounded state streams

    func watchStart(_ handle: Int, generation: String) throws -> Int {
        let record = try owned(handle)
        guard watchers.count < 128 else {
            throw NSError(domain: "VelarDesktop", code: 429, userInfo: [NSLocalizedDescriptionKey: "Desktop host cannot own more than 128 window state streams"])
        }
        let watcherHandle = nextWatcherHandle
        nextWatcherHandle += 1
        watchers[watcherHandle] = WindowStateWatcher(handle: watcherHandle, window: handle, generation: generation)
        record.watchers.insert(watcherHandle)
        return watcherHandle
    }

    func watchNext(_ handle: Int, generation: String, deliver: @escaping (Any) -> Void) throws {
        guard let watcher = watchers[handle], watcher.generation == generation else {
            throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Desktop window state stream handle is unknown or already released"])
        }
        guard watcher.pending == nil else {
            throw NSError(domain: "VelarDesktop", code: 409, userInfo: [NSLocalizedDescriptionKey: "WindowStateStream.next already has an active pull"])
        }
        if !watcher.events.isEmpty {
            deliver(watcher.events.removeFirst())
            return
        }
        if watcher.draining {
            release(watcher)
            deliver(NSNull())
            return
        }
        watcher.pending = deliver
    }

    @discardableResult
    func watchClose(_ handle: Int, generation: String) -> Bool {
        guard let watcher = watchers[handle], watcher.generation == generation else { return false }
        release(watcher)
        return true
    }

    /// A document that navigated away or a window that closed no longer owns
    /// the streams it started, and a pending pull from it is dropped rather than
    /// answered: the replacement document must never receive it.
    func retire(generation: String) {
        for watcher in watchers.values where watcher.generation == generation { release(watcher) }
    }

    private func release(_ watcher: WindowStateWatcher) {
        guard !watcher.closed else { return }
        watcher.closed = true
        watcher.pending = nil
        watchers.removeValue(forKey: watcher.handle)
        records[watcher.window]?.watchers.remove(watcher.handle)
    }

    /// A slow consumer never grows the queue. `moved` and `resized` carry no
    /// payload, so a repeat of one already queued is the latest of its kind and
    /// is dropped; a queue at its bound drops its oldest entry, because the
    /// newest is the state the window is actually in.
    private func publish(_ state: String, for record: WindowRecord) {
        for handle in record.watchers {
            guard let watcher = watchers[handle], !watcher.closed else { continue }
            if let pending = watcher.pending, watcher.events.isEmpty {
                watcher.pending = nil
                pending(state)
                continue
            }
            if (state == "moved" || state == "resized") && watcher.events.contains(state) { continue }
            watcher.events.append(state)
            if watcher.events.count > 64 { watcher.events.removeFirst() }
        }
    }

    // MARK: - Window construction

    private func identity(kind: String, key: String?) -> WindowRecord? {
        records.values.first { !$0.closed && $0.kind == kind && $0.key == key }
    }

    private func owned(_ handle: Int) throws -> WindowRecord {
        guard let record = records[handle], !record.closed else {
            throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Desktop window handle is unknown or already closed"])
        }
        return record
    }

    private func validate(route: String) throws {
        guard route.count <= 2048, route.hasPrefix("/"), !route.hasPrefix("//"), !route.hasPrefix("/\\"),
              !route.contains("\0"), URL(string: "velar-app://app" + route) != nil else {
            throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop window route must be a bounded path inside this application"])
        }
    }

    /// The native half of the instance-key rule; `windowKeyOf` in
    /// packages/desktop/src/compiler.ts and `windowKeyValue` in
    /// packages/desktop/src/test-runtime.ts are the other two.
    private func validate(key: String) throws {
        guard !key.isEmpty, key.count <= 128,
              key.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "." || $0 == "_" || $0 == ":" || $0 == "-") }) else {
            throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop window key must be at most 128 characters of letters, digits, '.', '_', ':' or '-'"])
        }
    }

    private func clamp(_ frame: NSRect, to window: NSWindow) -> NSRect {
        let area = (window.screen ?? NSScreen.main ?? NSScreen.screens.first)?.visibleFrame
        guard let area else { return frame }
        var result = frame
        result.size.width = min(result.width, area.width)
        result.size.height = min(result.height, area.height)
        result.origin.x = min(max(result.origin.x, area.minX), area.maxX - result.width)
        result.origin.y = min(max(result.origin.y, area.minY), area.maxY - result.height)
        return result
    }

    private func build(handle: Int, kind: String, key: String?, declared: WindowConfiguration, route: String, bounds: WindowBounds?) throws -> WindowRecord {
        let bridge = DesktopBridge(
            identifier: host.identifier,
            projectGrant: projectGrant,
            projectFilesGranted: projectFilesGranted,
            droppedFilesGranted: host.permissions.files.contains("dropped"),
            worker: worker,
            windowHandle: handle
        )
        bridge.registry = self
        bridge.services = services
        bridge.supervisor = supervisor
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "velar-app")
        let projectDirectoryJSON = try jsonText(projectGrant.directory)
        let injected = bridgeScript
            .replacingOccurrences(of: "__VELAR_PROJECT_DIRECTORY__", with: projectDirectoryJSON)
            .replacingOccurrences(of: "__VELAR_WINDOW_KIND__", with: try jsonText(kind))
            .replacingOccurrences(of: "__VELAR_WINDOW_HANDLE__", with: String(handle))
            .replacingOccurrences(of: "__VELAR_ENVIRONMENT__", with: environmentJSON)
        configuration.userContentController.addUserScript(WKUserScript(source: injected, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.add(bridge, name: "velarDesktop")
        let webView = VelarWebView(frame: .zero, configuration: configuration)
        webView.services = services
        let navigation = NavigationPolicy(bridge: bridge, network: host.permissions.network)
        webView.navigationDelegate = navigation
        bridge.webView = webView

        var styleMask: NSWindow.StyleMask = declared.frame
            ? [.titled, .closable, .miniaturizable]
            : [.borderless, .closable]
        if declared.resizable { styleMask.insert(.resizable) }
        if declared.titleBar == "hidden-inset" { styleMask.insert(.fullSizeContentView) }
        if declared.style == "panel" { styleMask.insert(.nonactivatingPanel) }
        let frame = NSRect(x: 0, y: 0, width: Double(declared.width), height: Double(declared.height))
        let window: NSWindow = declared.style == "panel"
            ? VelarPanel(contentRect: frame, styleMask: styleMask, backing: .buffered, defer: false)
            : VelarWindow(contentRect: frame, styleMask: styleMask, backing: .buffered, defer: false)
        window.title = declared.title
        window.minSize = NSSize(width: declared.minWidth, height: declared.minHeight)
        if !declared.resizable { window.maxSize = NSSize(width: declared.width, height: declared.height) }
        if let ratio = declared.aspectRatio, ratio > 0 { window.contentAspectRatio = NSSize(width: ratio, height: 1) }
        if declared.titleBar == "hidden-inset" {
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
        }
        window.level = declared.level == "floating" ? .floating : .normal
        if declared.visibleOnAllWorkspaces { window.collectionBehavior.insert([.canJoinAllSpaces, .fullScreenAuxiliary]) }
        if let panel = window as? NSPanel {
            panel.isFloatingPanel = true
            panel.hidesOnDeactivate = false
            panel.becomesKeyOnlyIfNeeded = false
        }
        window.isExcludedFromWindowsMenu = declared.style == "panel"
        window.isReleasedWhenClosed = false
        if declared.material == "sidebar" {
            // Vibrancy is a surface behind the page, so the page must not paint
            // its own. `underPageBackgroundColor` is the public control for that
            // backdrop; the document still owns whether its own body is
            // transparent, which is what the manifest field implies.
            let effect = NSVisualEffectView(frame: frame)
            effect.material = .sidebar
            effect.blendingMode = .behindWindow
            effect.state = .active
            effect.autoresizingMask = [.width, .height]
            webView.frame = effect.bounds
            webView.autoresizingMask = [.width, .height]
            webView.underPageBackgroundColor = .clear
            effect.addSubview(webView)
            window.contentView = effect
        } else {
            window.contentView = webView
        }
        window.delegate = self
        if let bounds { window.setFrame(clamp(windowFrame(bounds), to: window), display: false) }
        else { window.center() }
        guard let url = URL(string: "velar-app://app" + route) else {
            throw NSError(domain: "VelarDesktop", code: 400, userInfo: [NSLocalizedDescriptionKey: "Desktop window route must be a bounded path inside this application"])
        }
        webView.load(URLRequest(url: url))
        return WindowRecord(handle: handle, kind: kind, key: key, window: window, webView: webView, bridge: bridge, navigation: navigation)
    }

    private func jsonText(_ value: String) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        guard let text = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "VelarDesktop", code: 500, userInfo: [NSLocalizedDescriptionKey: "Desktop host could not encode a window value"])
        }
        return text
    }

    // MARK: - NSWindowDelegate

    private func record(for notification: Notification) -> WindowRecord? {
        guard let window = notification.object as? NSWindow, let handle = handlesByWindow[ObjectIdentifier(window)] else { return nil }
        return records[handle]
    }

    func windowDidMove(_ notification: Notification) {
        if let record = record(for: notification) { publish("moved", for: record) }
    }

    func windowDidResize(_ notification: Notification) {
        if let record = record(for: notification) { publish("resized", for: record) }
    }

    func windowDidBecomeKey(_ notification: Notification) {
        if let record = record(for: notification) { publish("focused", for: record) }
    }

    func windowDidResignKey(_ notification: Notification) {
        if let record = record(for: notification) { publish("blurred", for: record) }
    }

    /// The two lifecycle rules the host fixes and no manifest field softens:
    /// closing the main window closes every other window first and then quits,
    /// and closing the last window quits. There is no knob for either.
    func windowWillClose(_ notification: Notification) {
        guard let record = record(for: notification), !record.closed else { return }
        record.closed = true
        publish("closed", for: record)
        for handle in record.watchers {
            guard let watcher = watchers[handle] else { continue }
            watcher.draining = true
            if watcher.events.isEmpty, let pending = watcher.pending {
                watcher.pending = nil
                release(watcher)
                pending(NSNull())
            }
        }
        record.bridge.retireDocument()
        record.webView.configuration.userContentController.removeScriptMessageHandler(forName: "velarDesktop")
        handlesByWindow.removeValue(forKey: ObjectIdentifier(record.window))
        records.removeValue(forKey: record.handle)
        guard record.kind == mainWindowKind, !closingAll else { return }
        closingAll = true
        for other in records.values.sorted(by: { $0.handle > $1.handle }) { other.window.close() }
        DispatchQueue.main.async { NSApp.terminate(nil) }
    }

    func closeAll() {
        closingAll = true
        for record in records.values.sorted(by: { $0.handle > $1.handle }) { record.window.close() }
    }

    func activateExistingWindows() {
        guard !headless else { return }
        for record in records.values.sorted(by: { $0.handle < $1.handle }) where !record.closed && !(record.window is NSPanel) {
            record.window.makeKeyAndOrderFront(nil)
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    /// A notification the user clicked brings the application forward, and opens
    /// the one window every manifest declares when no window is left to bring.
    func activateForNotification() {
        if records.values.contains(where: { !$0.closed }) {
            activateExistingWindows()
            return
        }
        _ = try? open(kind: mainWindowKind, route: "/index.html", key: nil, bounds: nil)
    }
}

private final class ApplicationDelegate: NSObject, NSApplicationDelegate {
    private let headless: Bool
    /// `--headless-smoke`: start everything, prove the runtime actually executes
    /// a capability, report what it proved, and exit. `--headless` is the same
    /// application with no visible windows and no ending.
    private let smoke: Bool
    private var schemeHandler: AssetSchemeHandler?
    private var nodeHost: NodeCapabilityHost?
    private var projectGrant: ProjectDirectoryGrant?
    private var registry: WindowRegistry?
    private var services: HostServices?
    private var supervisor: ServiceSupervisor?

    init(headless: Bool, smoke: Bool) {
        self.headless = headless
        self.smoke = smoke
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            guard let resources = Bundle.main.resourceURL else { throw NSError(domain: "VelarDesktop", code: 1) }
            let configData = try Data(contentsOf: resources.appendingPathComponent("desktop.json"))
            let host = try JSONDecoder().decode(HostConfiguration.self, from: configData)
            guard host.protocolVersion == 1 else { throw NSError(domain: "VelarDesktop", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unsupported Desktop host protocol"])}
            guard host.windows[mainWindowKind] != nil else {
                throw NSError(domain: "VelarDesktop", code: 2, userInfo: [NSLocalizedDescriptionKey: "Desktop bundle declares no 'main' window kind"])
            }
            let schemeHandler = AssetSchemeHandler(root: resources.appendingPathComponent("renderer", isDirectory: true))
            let appDataBase = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let appData = appDataBase.appendingPathComponent(host.identifier, isDirectory: true)
            try FileManager.default.createDirectory(at: appData, withIntermediateDirectories: true)
            let dataDirectory = appData.appendingPathComponent("data", isDirectory: true)
            try FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
            let defaultProject = appData.appendingPathComponent("project", isDirectory: true)
            try FileManager.default.createDirectory(at: defaultProject, withIntermediateDirectories: true)
            let projectFilesGranted = host.permissions.files.contains("project")
            let projectGrant = try ProjectDirectoryGrant(defaultDirectory: defaultProject, appData: appData, projectFilesGranted: projectFilesGranted)
            let launchDirectory = projectGrant.directory
            let nodeRuntime = try resolveNodeRuntime(host)
            let nodeHost = try NodeCapabilityHost(
                executable: nodeRuntime.url.path,
                worker: resources.appendingPathComponent("host/worker.js"),
                config: resources.appendingPathComponent("desktop.json"),
                appData: appData,
                launchDirectory: launchDirectory
            )
            var environment: [String: String] = [:]
            var environmentBytes = 0
            for name in host.permissions.environment {
                guard let value = ProcessInfo.processInfo.environment[name] else { continue }
                let valueBytes = value.utf8.count
                let entryBytes = name.utf8.count + valueBytes
                guard valueBytes <= 64 * 1024, environmentBytes + entryBytes <= 1024 * 1024 else {
                    throw NSError(domain: "VelarDesktop", code: 4, userInfo: [NSLocalizedDescriptionKey: "Granted Desktop environment snapshot exceeds its size boundary"])
                }
                environment[name] = value
                environmentBytes += entryBytes
            }
            let environmentData = try JSONSerialization.data(withJSONObject: environment)
            let environmentJSON = String(data: environmentData, encoding: .utf8)!
            let services = HostServices(identifier: host.identifier, permissions: host.permissions)
            // Services start before the renderer loads and are not awaited: an
            // application that needs one reads `watchServices()`, and an
            // application that does not is never made to wait for a process it
            // will not talk to.
            let supervisor = host.services.isEmpty ? nil : ServiceSupervisor(
                runtime: nodeRuntime.url,
                servicesRoot: resources.appendingPathComponent("services", isDirectory: true),
                // Beside the application's own `app-data` scope rather than
                // inside it: a service's log is the host's record of what the
                // product's process said, and an application that can rewrite
                // the evidence is an application whose crash report proves
                // nothing.
                logDirectory: appData.appendingPathComponent(serviceLogDirectoryName, isDirectory: true),
                // The same directory `appDataDirectory()` answers the renderer,
                // handed to every service in its environment.
                appDataDirectory: dataDirectory,
                services: host.services
            )
            supervisor?.start()
            let registry = WindowRegistry(
                host: host,
                resources: resources,
                schemeHandler: schemeHandler,
                projectGrant: projectGrant,
                projectFilesGranted: projectFilesGranted,
                worker: nodeHost,
                services: services,
                supervisor: supervisor,
                environmentJSON: environmentJSON,
                headless: headless
            )
            services.registry = registry
            // The `main` kind is the one window the manifest always declares and
            // the host always opens; every other kind waits for `openWindow`.
            try registry.open(kind: mainWindowKind, route: "/index.html", key: nil, bounds: nil)
            self.schemeHandler = schemeHandler
            self.nodeHost = nodeHost
            self.projectGrant = projectGrant
            self.services = services
            self.supervisor = supervisor
            self.registry = registry
            if smoke { runHeadlessSmoke(host: host, runtime: nodeRuntime, worker: nodeHost, supervisor: supervisor) }
        } catch {
            if smoke { endSmoke(supervisor, 1, error.localizedDescription) }
            let alert = NSAlert(error: error)
            alert.messageText = "VelarScript Desktop could not start"
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    /// The packaging gate's acceptance, and the reason it is not
    /// `--verify-bundle`.
    ///
    /// `--verify-bundle` proves a runtime can be *resolved*: it runs
    /// `node --version`, which returns before V8 has created an Isolate. A runtime that cannot
    /// reserve its code range under the hardened runtime passes that and dies on
    /// the first real call — so this one starts the host, starts the capability
    /// worker on whichever runtime was resolved, and makes it answer a real
    /// capability request through the real dispatcher and the real transport.
    ///
    /// An application that grants no filesystem scope at all still proves the
    /// same thing: the refusal it gets back was *computed by the worker*, which
    /// only a working interpreter could have done. What is never accepted is
    /// silence, a transport failure, or a different error.
    private func runHeadlessSmoke(host: HostConfiguration, runtime: ResolvedNodeRuntime, worker: NodeCapabilityHost, supervisor: ServiceSupervisor?) {
        let deadline = DispatchWorkItem { [weak self] in
            self?.endSmoke(supervisor, 1, "the capability round-trip did not answer within 60s")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: deadline)
        let granted = host.permissions.files.contains("app-data") || host.permissions.files.contains("project")
        worker.probe(capability: "fs", operation: "list", arguments: ["."]) { [weak self] ok, value, error in
            deadline.cancel()
            guard let self else { return }
            if granted {
                guard ok, value is [Any] else {
                    self.endSmoke(supervisor, 1, "fs.list answered \(error ?? "an unusable value")")
                }
            } else {
                guard !ok, let error, error.contains("no granted filesystem scope") else {
                    self.endSmoke(supervisor, 1, "an application with no file grant answered \(error ?? "a result")")
                }
            }
            // The worker answered, so the interpreter runs. What is left is the
            // other half of a packaged application: every declared service was
            // started, answered the authenticated handshake, and reached ready.
            self.awaitServices(supervisor, deadline: Date().addingTimeInterval(serviceHandshakeTimeout * 2)) {
                self.reportSmoke(host: host, runtime: runtime, granted: granted, supervisor: supervisor)
            }
        }
    }

    /// The smoke waits for readiness where the application deliberately does not.
    /// An application reads `watchServices()` and carries on; the acceptance has
    /// to answer "did this bundle's services come up", so it is the one caller
    /// that blocks on the answer.
    private func awaitServices(_ supervisor: ServiceSupervisor?, deadline: Date, then finish: @escaping () -> Void) {
        guard let supervisor else {
            finish()
            return
        }
        let states = supervisor.declaredNames.map { supervisor.state(of: $0) ?? .failed }
        if states.allSatisfy({ $0 == .ready }) {
            finish()
            return
        }
        // Only when every service has settled somewhere terminal, never on the
        // first one: a service that stops immediately would otherwise end the
        // smoke before a service that is still backing off has finished proving
        // what its restart policy does.
        if states.allSatisfy({ $0 == .failed || $0 == .stopped }) {
            endSmoke(supervisor, 1, "every declared service settled without becoming ready (\(supervisor.settlement()))")
        }
        guard Date() < deadline else {
            endSmoke(supervisor, 1, "a declared service did not reach ready in time (\(supervisor.settlement()))")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.awaitServices(supervisor, deadline: deadline, then: finish)
        }
    }

    private func reportSmoke(host: HostConfiguration, runtime: ResolvedNodeRuntime, granted: Bool, supervisor: ServiceSupervisor?) {
        do {
            try writeReport([
                "kind": "velar-desktop-headless-smoke",
                "protocolVersion": 1,
                "identifier": host.identifier,
                "runtimeSource": runtime.source.rawValue,
                "runtime": runtime.url.path,
                "capability": "fs.list",
                "fileScope": granted,
                "windowKinds": host.windows.keys.sorted(),
                "services": supervisor?.report() ?? [],
            ])
        } catch {
            endSmoke(supervisor, 1, "the report could not be serialized")
        }
        endSmoke(supervisor, 0, nil)
    }

    /// Every exit out of the smoke, and the reason there is only one: this path
    /// calls `exit` rather than terminating the application, so
    /// `applicationWillTerminate` never runs and nothing it converges is
    /// converged. A service process that outlived the host that started it would
    /// be a leak this acceptance produced.
    private func endSmoke(_ supervisor: ServiceSupervisor?, _ status: Int32, _ failure: String?) -> Never {
        if let failure {
            FileHandle.standardError.write(Data("VelarScript Desktop headless smoke failed: \(failure)\n".utf8))
        }
        supervisor?.converge()
        exit(status)
    }

    /// A packaged application is a single instance: LaunchServices activates the
    /// running one rather than starting a second, and the reopen it sends is
    /// answered by bringing the windows this instance already owns forward.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        registry?.activateExistingWindows()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        registry?.closeAll()
        services?.stop()
        // Before the capability worker, because a service is the product's own
        // process: it is given its SIGTERM and its grace while this host is
        // still alive to send the SIGKILL that follows.
        supervisor?.converge()
        projectGrant?.release()
        nodeHost?.stop()
    }
}

@main
private enum VelarDesktopHost {
    static func main() {
        if CommandLine.arguments.dropFirst() == ["--verify-bundle"] {
            do {
                guard let resources = Bundle.main.resourceURL else { throw NSError(domain: "VelarDesktop", code: 1) }
                let configData = try Data(contentsOf: resources.appendingPathComponent("desktop.json"))
                let host = try JSONDecoder().decode(HostConfiguration.self, from: configData)
                // `--verify-bundle` answers "is this bundle complete and is
                // there a runtime": a static check, still worth having, and
                // deliberately not the packaging gate's acceptance. It used to
                // be spelled `--smoke`, and that name was a lie that cost a
                // release — it exits 0 on a bundle whose interpreter cannot
                // execute JavaScript. `--headless-smoke` is the smoke.
                _ = try resolveNodeRuntime(host)
                _ = try resolveProjectDirectory(resources)
                guard host.protocolVersion == 1,
                      host.windows[mainWindowKind] != nil,
                      FileManager.default.fileExists(atPath: resources.appendingPathComponent("renderer/index.html").path),
                      FileManager.default.fileExists(atPath: resources.appendingPathComponent("host/worker.js").path) else {
                    throw NSError(domain: "VelarDesktop", code: 2, userInfo: [NSLocalizedDescriptionKey: "Desktop bundle is incomplete"])
                }
                guard let request = BridgeRequest([
                    "protocolVersion": 1,
                    "generation": "00000000000000000000000000000001",
                    "id": 1,
                    "capability": "fs",
                    "operation": "list",
                    "args": ["."],
                ]), request.arguments.count == 1 else {
                    throw NSError(domain: "VelarDesktop", code: 3, userInfo: [NSLocalizedDescriptionKey: "Desktop bridge rejected a bounded request with arguments"])
                }
                let report: [String: Any] = [
                    "kind": "velar-desktop-bundle-verification",
                    "protocolVersion": 1,
                    "identifier": host.identifier,
                    "windowKinds": host.windows.keys.sorted(),
                    "services": host.services.keys.sorted(),
                ]
                try writeReport(report)
                return
            } catch {
                FileHandle.standardError.write(Data("VelarScript Desktop bundle verification failed: \(error.localizedDescription)\n".utf8))
                exit(1)
            }
        }
        let arguments = CommandLine.arguments.dropFirst()
        let smoke = arguments == ["--headless-smoke"]
        let headless = smoke || arguments == ["--headless"]
        let application = NSApplication.shared
        let delegate = ApplicationDelegate(headless: headless, smoke: smoke)
        application.setActivationPolicy(headless ? .prohibited : .regular)
        application.delegate = delegate
        application.run()
        _ = delegate
    }
}
