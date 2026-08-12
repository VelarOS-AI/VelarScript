import Darwin
import Foundation

private let frameWrite: UInt8 = 1
private let frameResize: UInt8 = 2
private let frameClose: UInt8 = 3
private let maximumFrameBytes = 1024 * 1024
private var terminationSignal: Int32 = 0

private func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(("Velar terminal host: \(message)\n").utf8))
    Darwin.exit(1)
}

private func integer(_ value: String, minimum: Int, maximum: Int, name: String) -> Int {
    guard let parsed = Int(value), parsed >= minimum, parsed <= maximum else {
        fail("\(name) must be an integer from \(minimum) through \(maximum)")
    }
    return parsed
}

private func loginShell() -> String {
    var metadata = stat()
    guard stat("/etc/shells", &metadata) == 0, metadata.st_size >= 1, metadata.st_size <= 64 * 1024,
          let source = try? String(contentsOfFile: "/etc/shells", encoding: .utf8) else {
        fail("the trusted login-shell registry is unavailable")
    }
    let approved = Set(source.split(whereSeparator: { $0 == "\n" || $0 == "\r" })
        .map(String.init)
        .filter({ $0.hasPrefix("/") && !$0.contains("#") }))
    if let account = getpwuid(getuid()), let shell = account.pointee.pw_shell {
        let value = String(cString: shell)
        if approved.contains(value), value.utf8.count <= 4096, access(value, X_OK) == 0 { return value }
    }
    guard approved.contains("/bin/zsh"), access("/bin/zsh", X_OK) == 0 else { fail("no trusted login shell is available") }
    return "/bin/zsh"
}

private func writeAll(_ descriptor: Int32, _ data: Data) -> Bool {
    return data.withUnsafeBytes { bytes in
        guard let start = bytes.baseAddress else { return true }
        var offset = 0
        while offset < data.count {
            let count = Darwin.write(descriptor, start.advanced(by: offset), data.count - offset)
            if count > 0 { offset += count; continue }
            if count == -1 && errno == EINTR { continue }
            return false
        }
        return true
    }
}

private func signalShell(_ pid: pid_t, _ signal: Int32) {
    if Darwin.kill(-pid, signal) == -1 { _ = Darwin.kill(pid, signal) }
}

private func childExitCode(_ status: Int32) -> Int32 {
    let signal = status & 0x7f
    if signal == 0 { return (status >> 8) & 0xff }
    if signal != 0x7f { return min(255, 128 + signal) }
    return 1
}

private func decodeUInt32(_ data: Data, at offset: Int) -> UInt32 {
    return data[offset..<offset + 4].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
}

private func run() -> Never {
    guard CommandLine.arguments.count == 4 else { fail("expected project directory, columns, and rows") }
    let directory = CommandLine.arguments[1]
    guard directory.hasPrefix("/"), directory.utf8.count <= 4096, !directory.contains("\0") else {
        fail("project directory must be a bounded absolute path")
    }
    let columns = integer(CommandLine.arguments[2], minimum: 20, maximum: 1000, name: "columns")
    let rows = integer(CommandLine.arguments[3], minimum: 5, maximum: 1000, name: "rows")
    let shell = loginShell()
    var window = winsize(ws_row: UInt16(rows), ws_col: UInt16(columns), ws_xpixel: 0, ws_ypixel: 0)
    var master: Int32 = -1
    let child = forkpty(&master, nil, nil, &window)
    guard child >= 0 else { fail("forkpty failed: \(String(cString: strerror(errno)))") }

    if child == 0 {
        _ = Darwin.close(3)
        guard chdir(directory) == 0 else { _exit(126) }
        let name = URL(fileURLWithPath: shell).lastPathComponent
        let argument = strdup("-\(name)")
        let path = strdup(shell)
        guard let argument, let path else { _exit(126) }
        var arguments: [UnsafeMutablePointer<CChar>?] = [argument, nil]
        arguments.withUnsafeMutableBufferPointer { buffer in
            _ = execv(path, buffer.baseAddress)
        }
        _exit(126)
    }

    let metadata = Data("{\"protocolVersion\":1,\"pid\":\(child)}\n".utf8)
    guard writeAll(3, metadata) else {
        signalShell(child, SIGKILL)
        _ = waitpid(child, nil, 0)
        fail("could not publish shell ownership")
    }
    _ = Darwin.close(3)
    signal(SIGTERM) { value in terminationSignal = value }
    signal(SIGHUP) { value in terminationSignal = value }
    signal(SIGINT) { value in terminationSignal = value }

    var input = Data()
    var shellStatus: Int32 = 0
    var shellSettled = false
    var masterClosed = false
    var closeRequested = false
    var bytes = [UInt8](repeating: 0, count: 64 * 1024)

    while !shellSettled || !masterClosed {
        if terminationSignal != 0 && !closeRequested {
            closeRequested = true
            signalShell(child, SIGTERM)
        }
        if !shellSettled {
            let result = waitpid(child, &shellStatus, WNOHANG)
            if result == child { shellSettled = true }
            else if result == -1 && errno != EINTR { shellSettled = true; shellStatus = 1 << 8 }
        }

        var descriptors = [
            pollfd(fd: masterClosed ? -1 : master, events: Int16(POLLIN | POLLHUP), revents: 0),
            pollfd(fd: closeRequested ? -1 : STDIN_FILENO, events: Int16(POLLIN | POLLHUP), revents: 0),
        ]
        let polled = poll(&descriptors, nfds_t(descriptors.count), shellSettled ? 25 : 100)
        if polled == -1 && errno != EINTR {
            signalShell(child, SIGKILL)
            if !shellSettled { _ = waitpid(child, &shellStatus, 0); shellSettled = true }
            fail("poll failed: \(String(cString: strerror(errno)))")
        }

        if !masterClosed && descriptors[0].revents & Int16(POLLIN | POLLHUP | POLLERR) != 0 {
            let count = Darwin.read(master, &bytes, bytes.count)
            if count > 0 {
                if !writeAll(STDOUT_FILENO, Data(bytes[0..<count])) {
                    signalShell(child, SIGKILL)
                    if !shellSettled { _ = waitpid(child, &shellStatus, 0); shellSettled = true }
                    masterClosed = true
                }
            } else if count == 0 || count == -1 && (errno == EIO || errno != EINTR) {
                _ = Darwin.close(master)
                masterClosed = true
            }
        }

        if !closeRequested && descriptors[1].revents & Int16(POLLIN | POLLHUP | POLLERR) != 0 {
            let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
            if count > 0 { input.append(contentsOf: bytes[0..<count]) }
            else if count == 0 || count == -1 && errno != EINTR {
                closeRequested = true
                signalShell(child, SIGHUP)
            }
        }

        while !closeRequested && input.count >= 5 {
            let kind = input[0]
            let length = Int(decodeUInt32(input, at: 1))
            if length > maximumFrameBytes {
                closeRequested = true
                signalShell(child, SIGKILL)
                break
            }
            if input.count < 5 + length { break }
            let payload = Data(input[5..<5 + length])
            input.removeSubrange(0..<5 + length)
            if kind == frameWrite {
                if length == 0 || !writeAll(master, payload) {
                    closeRequested = true
                    signalShell(child, SIGKILL)
                }
            } else if kind == frameResize && length == 8 {
                let nextColumns = decodeUInt32(payload, at: 0)
                let nextRows = decodeUInt32(payload, at: 4)
                if nextColumns < 20 || nextColumns > 1000 || nextRows < 5 || nextRows > 1000 {
                    closeRequested = true
                    signalShell(child, SIGKILL)
                } else {
                    var size = winsize(ws_row: UInt16(nextRows), ws_col: UInt16(nextColumns), ws_xpixel: 0, ws_ypixel: 0)
                    if ioctl(master, TIOCSWINSZ, &size) == -1 {
                        closeRequested = true
                        signalShell(child, SIGKILL)
                    }
                }
            } else if kind == frameClose && length == 0 {
                closeRequested = true
                signalShell(child, SIGHUP)
            } else {
                closeRequested = true
                signalShell(child, SIGKILL)
            }
        }

        if shellSettled && masterClosed { break }
    }
    if !shellSettled { _ = waitpid(child, &shellStatus, 0) }
    Darwin.exit(childExitCode(shellStatus))
}

run()
