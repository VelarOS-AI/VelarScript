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
  const mapDelete = (map, key) => hostApply(hostMapDelete, map, [key])
  const mapGet = (map, key) => hostApply(hostMapGet, map, [key])
  const mapHas = (map, key) => hostApply(hostMapHas, map, [key])
  const mapSet = (map, key, value) => hostApply(hostMapSet, map, [key, value])
  const mapSize = (map) => hostApply(hostMapSize, map, [])
  const key = Symbol.for("velar.desktop.bridge.v1")
  if (Object.getOwnPropertyDescriptor(globalThis, key)) throw new Error("VelarScript Desktop bridge already exists")
  const pending = new hostMap()
  const responseChunks = new hostMap()
  let nextId = 1
  const complete = (message) => {
    if (!message || typeof message !== "object" || !hostNumberIsSafeInteger(message.id)) return
    const request = mapGet(pending, message.id)
    if (!request) return
    mapDelete(pending, message.id)
    if (request.timer !== null) hostClearTimeout(request.timer)
    if (message.ok === true) request.resolve(message.value)
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
  const receiveChunk = (id, index, total, encoded) => {
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
      if (state.bytes > 65 * 1024 * 1024) throw new hostError("Desktop response exceeds its transport bound")
      if (state.count !== state.total) return
      const bytes = new hostUint8Array(state.bytes)
      let offset = 0
      for (const item of state.parts) { hostApply(hostUint8ArraySet, bytes, [item, offset]); offset += item.byteLength }
      mapDelete(responseChunks, id)
      complete(hostApply(hostJsonParse, JSON, [hostApply(hostTextDecode, hostTextDecoder, [bytes])]))
    } catch (error) {
      mapDelete(responseChunks, id)
      complete({id, ok: false, error: error instanceof hostError ? error.message : "Invalid Desktop response transport"})
    }
  }
  Object.defineProperty(globalThis, "__velarDesktopTransportChunk", {
    value: receiveChunk, enumerable: false, configurable: false, writable: false,
  })
const bridge = Object.freeze({
    platform: "macos",
    packaged: true,
    projectDirectory: __VELAR_PROJECT_DIRECTORY__,
    environment: Object.freeze(__VELAR_ENVIRONMENT__),
    invoke(capability, operation, args, timeoutMs = 30000) {
      if (typeof capability !== "string" || typeof operation !== "string" || !hostArrayIsArray(args)) {
        return hostPromise.reject(new hostTypeError("Invalid Desktop bridge request"))
      }
      if (!hostNumberIsSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 600000) {
        return hostPromise.reject(new hostRangeError("Invalid Desktop bridge timeout"))
      }
      if (mapSize(pending) >= 1024) return hostPromise.reject(new hostRangeError("Too many pending Desktop requests"))
      const id = nextId++
      return new hostPromise((resolve, reject) => {
        const timer = timeoutMs === 0 ? null : hostSetTimeout(() => {
          mapDelete(pending, id)
          mapDelete(responseChunks, id)
          reject(new hostError("Desktop host request timed out"))
        }, timeoutMs)
        mapSet(pending, id, {resolve, reject, timer})
        try {
          const request = {protocolVersion: 1, id, capability, operation, args}
          const bytes = hostApply(hostTextEncode, hostTextEncoder, [hostApply(hostJsonStringify, JSON, [request])])
          if (bytes.byteLength > 128 * 1024 * 1024) throw new hostRangeError("Desktop request exceeds its transport bound")
          if (bytes.byteLength <= 512 * 1024) {
            hostApply(hostPostMessage, hostMessageHandler, [request])
          } else {
            const chunkBytes = 192 * 1024
            const total = hostMathCeil(bytes.byteLength / chunkBytes)
            if (total > 1024) throw new hostRangeError("Desktop request has too many transport chunks")
            for (let index = 0; index < total; index += 1) {
              const part = hostApply(hostUint8ArraySubarray, bytes, [index * chunkBytes, hostMathMin(bytes.byteLength, (index + 1) * chunkBytes)])
              hostApply(hostPostMessage, hostMessageHandler, [{protocolVersion: 1, transport: "chunk", id, index, total, base64: encodeBase64(part)}])
            }
          }
        } catch (error) {
          if (timer !== null) hostClearTimeout(timer)
          mapDelete(pending, id)
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
    let environment: [String]
    let secrets: [String]
}

private struct BridgeRequest {
    let id: Int
    let capability: String
    let operation: String
    let arguments: [Any]

    init?(_ body: [String: Any]) {
        guard body.count <= 6,
              body["protocolVersion"] as? Int == 1,
              let id = body["id"] as? Int, id > 0,
              let capability = body["capability"] as? String, !capability.isEmpty, capability.count <= 128,
              let operation = body["operation"] as? String, !operation.isEmpty, operation.count <= 128,
              let arguments = body["args"] as? [Any], arguments.count <= 1024,
              let encoded = try? JSONSerialization.data(withJSONObject: body), encoded.count <= 128 * 1024 * 1024 else {
            return nil
        }
        self.id = id
        self.capability = capability
        self.operation = operation
        self.arguments = arguments
    }
}

private struct BridgeTransportChunk {
    let id: Int
    let index: Int
    let total: Int
    let data: Data

    init?(_ body: [String: Any]) {
        guard body.count <= 7,
              body["protocolVersion"] as? Int == 1,
              body["transport"] as? String == "chunk",
              let id = body["id"] as? Int, id > 0,
              let index = body["index"] as? Int, index >= 0,
              let total = body["total"] as? Int, total >= 1, total <= 1024, index < total,
              let base64 = body["base64"] as? String, base64.count <= 262144,
              let data = Data(base64Encoded: base64), data.count <= 192 * 1024 else { return nil }
        self.id = id
        self.index = index
        self.total = total
        self.data = data
    }
}

private func deliverBridgeResponse(_ data: Data, to webView: WKWebView?) {
    guard let id = responseIdentifier(data) else { return }
    let chunkBytes = 192 * 1024
    let total = max(1, (data.count + chunkBytes - 1) / chunkBytes)
    guard total <= 1024 else { return }
    for index in 0..<total {
        let lower = index * chunkBytes
        let upper = min(data.count, lower + chunkBytes)
        let encoded = data.subdata(in: lower..<upper).base64EncodedString()
        webView?.evaluateJavaScript("globalThis.__velarDesktopTransportChunk(\(id),\(index),\(total),\"\(encoded)\")")
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
    private let process = Process()
    private let input = Pipe()
    private let output = Pipe()
    private let errors = Pipe()
    private var buffer = Data()
    private var pending = Set<Int>()
    private var processOwners: [Int: pid_t] = [:]
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
            if self.pending.contains(request.id) {
                self.complete(id: request.id, error: "Desktop request identity is already pending")
                return
            }
            self.pending.insert(request.id)
            if let failure = self.failure {
                self.pending.remove(request.id)
                self.complete(id: request.id, error: failure)
                return
            }
            guard self.process.isRunning else {
                self.fail("Desktop Node capability host is not running")
                return
            }
            do {
                try self.input.fileHandleForWriting.write(contentsOf: data)
                try self.input.fileHandleForWriting.write(contentsOf: Data([0x0A]))
            } catch {
                self.fail("Desktop Node capability host write failed: \(error.localizedDescription)")
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
                handle(event: event, object: object)
                if failure != nil { return }
                continue
            }
            guard let id = object["id"] as? Int, id > 0, pending.remove(id) != nil else {
                fail("Desktop Node capability host returned an unknown response")
                return
            }
            let encoded = Data(line)
            DispatchQueue.main.async { [weak self] in
                deliverBridgeResponse(encoded, to: self?.webView)
            }
        }
        if buffer.count > 65 * 1024 * 1024 { fail("Desktop Node capability host response exceeded its transport bound") }
    }

    private func handle(event: String, object: [String: Any]) {
        guard object["protocolVersion"] as? Int == 1,
              let handle = object["handle"] as? Int, handle > 0 else {
            fail("Desktop Node capability host returned an invalid lifecycle event")
            return
        }
        switch event {
        case "process-owned":
            guard let pid = object["pid"] as? Int, pid > 0, pid <= Int(Int32.max), processOwners[handle] == nil else {
                fail("Desktop Node capability host returned an invalid process owner")
                return
            }
            processOwners[handle] = pid_t(pid)
        case "process-settled":
            guard processOwners.removeValue(forKey: handle) != nil else {
                fail("Desktop Node capability host settled an unknown process owner")
                return
            }
        default:
            fail("Desktop Node capability host returned an unknown lifecycle event")
        }
    }

    private func fail(_ message: String) {
        guard failure == nil else { return }
        failure = message
        output.fileHandleForReading.readabilityHandler = nil
        errors.fileHandleForReading.readabilityHandler = nil
        try? input.fileHandleForWriting.close()
        if process.isRunning { process.terminate() }
        let ids = Array(pending)
        pending.removeAll(keepingCapacity: false)
        for id in ids { complete(id: id, error: message) }
        reapProcessOwners()
    }

    private func complete(id: Int, error: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["id": id, "ok": false, "error": error]) else { return }
        DispatchQueue.main.async { [weak self] in deliverBridgeResponse(data, to: self?.webView) }
    }

    private func reapProcessOwners() {
        guard !reaping, !processOwners.isEmpty else { return }
        reaping = true
        let reap = { [weak self] in
            guard let self else { return }
            var settled: [Int] = []
            for (handle, pid) in self.processOwners {
                _ = Darwin.kill(-pid, SIGKILL)
                if Darwin.kill(-pid, 0) == -1 && errno == ESRCH { settled.append(handle) }
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
    private let projectDirectory: String
    private let worker: NodeCapabilityHost
    private var incomingChunks: [Int: IncomingChunks] = [:]
    private var incomingBytes = 0
    weak var webView: WKWebView?

    init(identifier: String, projectDirectory: String, worker: NodeCapabilityHost) {
        self.identifier = identifier
        self.projectDirectory = projectDirectory
        self.worker = worker
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any] else { return }
        if body["transport"] as? String == "chunk" {
            receiveChunk(body)
            return
        }
        guard let request = BridgeRequest(body) else { return }
        handle(request, body: body)
    }

    private func receiveChunk(_ body: [String: Any]) {
        guard let chunk = BridgeTransportChunk(body), incomingChunks.count < 16 || incomingChunks[chunk.id] != nil else { return }
        var state = incomingChunks[chunk.id] ?? IncomingChunks(total: chunk.total, nextIndex: 0, data: Data())
        guard state.total == chunk.total, state.nextIndex == chunk.index,
              incomingBytes + chunk.data.count <= 128 * 1024 * 1024 else {
            incomingBytes -= state.data.count
            incomingChunks.removeValue(forKey: chunk.id)
            complete(id: chunk.id, value: nil, error: "Invalid Desktop request chunk sequence")
            return
        }
        state.data.append(chunk.data)
        state.nextIndex += 1
        incomingBytes += chunk.data.count
        if state.nextIndex < state.total {
            incomingChunks[chunk.id] = state
            return
        }
        incomingChunks.removeValue(forKey: chunk.id)
        incomingBytes -= state.data.count
        guard let value = try? JSONSerialization.jsonObject(with: state.data),
              let decoded = value as? [String: Any],
              let request = BridgeRequest(decoded), request.id == chunk.id else {
            complete(id: chunk.id, value: nil, error: "Invalid Desktop request transport")
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
            let value: String
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
                value = projectDirectory
            default:
                throw NSError(domain: "VelarDesktop", code: 404, userInfo: [NSLocalizedDescriptionKey: "Unknown Desktop operation '\(request.operation)'"])
            }
            complete(id: request.id, value: value, error: nil)
        } catch {
            complete(id: request.id, value: nil, error: error.localizedDescription)
        }
    }

    private func complete(id: Int, value: String?, error: String?) {
        var payload: [String: Any] = ["id": id, "ok": error == nil]
        if let value { payload["value"] = value }
        if let error { payload["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              data.count <= 65 * 1024 * 1024 else { return }
        deliverBridgeResponse(data, to: webView)
    }
}

private final class NavigationPolicy: NSObject, WKNavigationDelegate {
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
    private var window: NSWindow?
    private var schemeHandler: AssetSchemeHandler?
    private var bridge: DesktopBridge?
    private var navigationPolicy: NavigationPolicy?
    private var nodeHost: NodeCapabilityHost?

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
            let launchDirectory = try resolveProjectDirectory(defaultProject)
            let nodeRuntime = try resolveNodeRuntime(host)
            let nodeHost = try NodeCapabilityHost(
                executable: nodeRuntime.path,
                worker: resources.appendingPathComponent("host/worker.js"),
                config: resources.appendingPathComponent("desktop.json"),
                appData: appData,
                launchDirectory: launchDirectory
            )
            let bridge = DesktopBridge(identifier: host.identifier, projectDirectory: launchDirectory, worker: nodeHost)
            let navigationPolicy = NavigationPolicy()
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
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            webView.load(URLRequest(url: URL(string: "velar-app://app/index.html")!))
            self.window = window
            self.schemeHandler = schemeHandler
            self.bridge = bridge
            self.navigationPolicy = navigationPolicy
            self.nodeHost = nodeHost
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = "VelarScript Desktop could not start"
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { nodeHost?.stop() }
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
        let application = NSApplication.shared
        let delegate = ApplicationDelegate()
        application.setActivationPolicy(.regular)
        application.delegate = delegate
        application.run()
        _ = delegate
    }
}
