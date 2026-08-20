import Cocoa
import Darwin
import Foundation
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
}

private struct HostConfiguration: Decodable {
    let protocolVersion: Int
    let productName: String
    let identifier: String
    let nodeMinimumMajor: Int
    let window: WindowConfiguration
    let permissions: PermissionConfiguration
}

private struct PermissionConfiguration: Decodable {
    let files: [String]
    let environment: [String]
    let secrets: [String]
}

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

private func resolveNodeRuntime(_ configuration: HostConfiguration) throws -> URL {
    var candidates: [String] = []
    if let override = ProcessInfo.processInfo.environment["VELAR_DESKTOP_NODE"], !override.isEmpty {
        candidates.append(override)
    }
    if let path = ProcessInfo.processInfo.environment["PATH"] {
        candidates.append(contentsOf: path.split(separator: ":").map { String($0) + "/node" })
    }
    candidates.append(contentsOf: ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"])
    var visited = Set<String>()
    for candidate in candidates where candidate.hasPrefix("/") && visited.insert(candidate).inserted {
        let url = URL(fileURLWithPath: candidate).resolvingSymlinksInPath()
        guard FileManager.default.isExecutableFile(atPath: url.path),
              let major = nodeMajorVersion(url), major >= configuration.nodeMinimumMajor else { continue }
        return url
    }
    throw NSError(
        domain: "VelarDesktop",
        code: 5,
        userInfo: [NSLocalizedDescriptionKey: "Desktop thin runtime requires Node.js \(configuration.nodeMinimumMajor) or newer; set VELAR_DESKTOP_NODE to an absolute executable path"]
    )
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
    private var activeGeneration: String?
    private var nextWorkerRequestID = 1
    private var nextProjectRootCommandID = 1
    private var processOwners: [Int: ProcessOwner] = [:]
    private var pendingProjectRoots: [Int: PendingProjectRoot] = [:]
    private var failure: String?
    private var reaping = false
    private let queue = DispatchQueue(label: "velar.desktop.node-worker")
    weak var webView: WKWebView?

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

    func send(_ request: BridgeRequest, body: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: body)
        guard data.count <= 128 * 1024 * 1024 else { throw NSError(domain: "VelarDesktop", code: 413, userInfo: [NSLocalizedDescriptionKey: "Desktop request exceeds its transport bound"]) }
        queue.async { [weak self] in
            guard let self else { return }
            let identity = BridgeIdentity(generation: request.generation, id: request.id)
            if self.activeIdentities.contains(identity) {
                self.complete(identity: identity, error: "Desktop request identity is already pending")
                return
            }
            if let failure = self.failure {
                self.complete(identity: identity, error: failure)
                return
            }
            guard self.process.isRunning else {
                self.fail("Desktop Node capability host is not running")
                self.complete(identity: identity, error: self.failure ?? "Desktop Node capability host is not running")
                return
            }
            if self.pending.count >= 1024 {
                self.complete(identity: identity, error: "Too many pending Desktop capability requests")
                return
            }
            if self.pendingRequestBytes + data.count > 128 * 1024 * 1024 {
                self.complete(identity: identity, error: "Pending Desktop capability requests exceed their aggregate transport bound")
                return
            }
            do {
                try self.activate(generation: request.generation)
                guard let workerID = self.allocateWorkerRequestID() else {
                    self.complete(identity: identity, error: "Desktop capability request identity space is exhausted")
                    return
                }
                var forwarded = body
                forwarded.removeValue(forKey: "generation")
                forwarded["id"] = workerID
                forwarded["owner"] = request.generation
                self.pending[workerID] = PendingRequest(identity: identity, requestBytes: data.count, retired: false)
                self.pendingRequestBytes += data.count
                self.activeIdentities.insert(identity)
                try self.write(forwarded)
            } catch {
                self.fail("Desktop Node capability host write failed: \(error.localizedDescription)")
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
            DispatchQueue.main.async { [weak self] in
                deliverBridgeResponse(encoded, generation: request.identity.generation, to: self?.webView)
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
                  generation == activeGeneration || pending.values.contains(where: { $0.identity.generation == generation }) else {
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
        pending.removeAll(keepingCapacity: false)
        pendingProjectRoots.removeAll(keepingCapacity: false)
        pendingRequestBytes = 0
        activeIdentities.removeAll(keepingCapacity: false)
        activeGeneration = nil
        for request in requests where !request.retired { complete(identity: request.identity, error: message) }
        for projectRoot in projectRoots { DispatchQueue.main.async { projectRoot.completion(message) } }
        reapProcessOwners()
    }

    private func complete(identity: BridgeIdentity, error: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["id": identity.id, "ok": false, "error": error]) else { return }
        DispatchQueue.main.async { [weak self] in
            deliverBridgeResponse(data, generation: identity.generation, to: self?.webView)
        }
    }

    private func allocateWorkerRequestID() -> Int? {
        for _ in 0...1024 {
            let candidate = nextWorkerRequestID
            nextWorkerRequestID = nextWorkerRequestID >= 9_007_199_254_740_991 ? 1 : nextWorkerRequestID + 1
            if pending[candidate] == nil { return candidate }
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

    private func activate(generation: String) throws {
        if activeGeneration == generation { return }
        if let previous = activeGeneration { retireGeneration(previous) }
        guard failure == nil else { throw NSError(domain: "VelarDesktop", code: 500, userInfo: [NSLocalizedDescriptionKey: failure!]) }
        try write(["protocolVersion": 1, "hostCommand": "owner-activate", "owner": generation])
        activeGeneration = generation
    }

    private func retireGeneration(_ generation: String) {
        for (id, request) in pending where request.identity.generation == generation {
            pending[id]?.retired = true
            activeIdentities.remove(request.identity)
        }
        if activeGeneration == generation { activeGeneration = nil }
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

private final class DesktopBridge: NSObject, WKScriptMessageHandler {
    private struct IncomingChunks {
        let total: Int
        var nextIndex: Int
        var data: Data
    }
    private let identifier: String
    private let projectGrant: ProjectDirectoryGrant
    private let projectFilesGranted: Bool
    private let worker: NodeCapabilityHost
    private var incomingChunks: [BridgeIdentity: IncomingChunks] = [:]
    private var incomingBytes = 0
    private var activeGeneration: String?
    private var retiredGenerations = Set<String>()
    private var retiredGenerationOrder: [String] = []
    weak var webView: WKWebView?

    init(identifier: String, projectGrant: ProjectDirectoryGrant, projectFilesGranted: Bool, worker: NodeCapabilityHost) {
        self.identifier = identifier
        self.projectGrant = projectGrant
        self.projectFilesGranted = projectFilesGranted
        self.worker = worker
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
            if request.capability != "desktop" {
                try worker.send(request, body: body)
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

private final class NavigationPolicy: NSObject, WKNavigationDelegate {
    private weak var bridge: DesktopBridge?

    init(bridge: DesktopBridge) { self.bridge = bridge }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        bridge?.retireDocument()
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "velar-app" && url.host == "app" {
            decisionHandler(.allow)
        } else if url.scheme == "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.cancel)
        }
    }
}

private final class ApplicationDelegate: NSObject, NSApplicationDelegate {
    private let headless: Bool
    private var window: NSWindow?
    private var schemeHandler: AssetSchemeHandler?
    private var bridge: DesktopBridge?
    private var navigationPolicy: NavigationPolicy?
    private var nodeHost: NodeCapabilityHost?
    private var projectGrant: ProjectDirectoryGrant?

    init(headless: Bool) {
        self.headless = headless
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            guard let resources = Bundle.main.resourceURL else { throw NSError(domain: "VelarDesktop", code: 1) }
            let configData = try Data(contentsOf: resources.appendingPathComponent("desktop.json"))
            let host = try JSONDecoder().decode(HostConfiguration.self, from: configData)
            guard host.protocolVersion == 1 else { throw NSError(domain: "VelarDesktop", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unsupported Desktop host protocol"])}
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
                executable: nodeRuntime.path,
                worker: resources.appendingPathComponent("host/worker.js"),
                config: resources.appendingPathComponent("desktop.json"),
                appData: appData,
                launchDirectory: launchDirectory
            )
            let bridge = DesktopBridge(
                identifier: host.identifier,
                projectGrant: projectGrant,
                projectFilesGranted: projectFilesGranted,
                worker: nodeHost
            )
            let navigationPolicy = NavigationPolicy(bridge: bridge)
            let webConfiguration = WKWebViewConfiguration()
            webConfiguration.setURLSchemeHandler(schemeHandler, forURLScheme: "velar-app")
            let projectDirectoryData = try JSONSerialization.data(withJSONObject: launchDirectory, options: [.fragmentsAllowed])
            let projectDirectoryJSON = String(data: projectDirectoryData, encoding: .utf8)!
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
            let injectedBridge = bridgeScript
                .replacingOccurrences(of: "__VELAR_PROJECT_DIRECTORY__", with: projectDirectoryJSON)
                .replacingOccurrences(of: "__VELAR_ENVIRONMENT__", with: environmentJSON)
            webConfiguration.userContentController.addUserScript(WKUserScript(source: injectedBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            webConfiguration.userContentController.add(bridge, name: "velarDesktop")
            let webView = WKWebView(frame: .zero, configuration: webConfiguration)
            webView.navigationDelegate = navigationPolicy
            bridge.webView = webView
            nodeHost.webView = webView

            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: host.window.width, height: host.window.height),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            window.title = host.window.title
            window.minSize = NSSize(width: host.window.minWidth, height: host.window.minHeight)
            window.contentView = webView
            window.center()
            if !headless {
                window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
            }
            webView.load(URLRequest(url: URL(string: "velar-app://app/index.html")!))
            self.window = window
            self.schemeHandler = schemeHandler
            self.bridge = bridge
            self.navigationPolicy = navigationPolicy
            self.nodeHost = nodeHost
            self.projectGrant = projectGrant
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = "VelarScript Desktop could not start"
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        projectGrant?.release()
        nodeHost?.stop()
    }
}

@main
private enum VelarDesktopHost {
    static func main() {
        if CommandLine.arguments.dropFirst() == ["--smoke"] {
            do {
                guard let resources = Bundle.main.resourceURL else { throw NSError(domain: "VelarDesktop", code: 1) }
                let configData = try Data(contentsOf: resources.appendingPathComponent("desktop.json"))
                let host = try JSONDecoder().decode(HostConfiguration.self, from: configData)
                _ = try resolveNodeRuntime(host)
                _ = try resolveProjectDirectory(resources)
                guard host.protocolVersion == 1,
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
                print("{\"kind\":\"velar-desktop-smoke\",\"protocolVersion\":1,\"identifier\":\"\(host.identifier)\"}")
                return
            } catch {
                FileHandle.standardError.write(Data("VelarScript Desktop smoke failed: \(error.localizedDescription)\n".utf8))
                exit(1)
            }
        }
        let headlessSmoke = CommandLine.arguments.dropFirst() == ["--headless-smoke"]
        let application = NSApplication.shared
        let delegate = ApplicationDelegate(headless: headlessSmoke)
        application.setActivationPolicy(headlessSmoke ? .prohibited : .regular)
        application.delegate = delegate
        application.run()
        _ = delegate
    }
}
