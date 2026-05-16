# Swift SDK reference

Source: [`sdks/swift/Sources/SentryReplica/`](../../sdks/swift/Sources/SentryReplica/).

Pure-Swift, Sendable throughout. Works on iOS, macOS, and Linux (Swift 5.10+). HTTP transport uses `URLSession`.

## Install

Swift Package Manager:

```swift
// Package.swift
.package(url: "https://github.com/chrischabot/warden.git", from: "0.0.0"),
.target(name: "MyApp", dependencies: [
    .product(name: "SentryReplica", package: "warden")
])
```

```swift
import SentryReplica
```

## Initialisation

### `SentryReplica.initialize(options:)`

```swift
let client = try SentryReplica.initialize(options: ClientOptions(
    dsn: "https://abc123@warden.example.com/1",
    release: "myapp@1.0.0",
    environment: "production"
))
```

Throws `DSNError` on a malformed DSN. Creates a `Client`, binds it to the current `Hub`. Returns the client (discardableResult).

### `ClientOptions`

```swift
public struct ClientOptions: Sendable {
    public var dsn: String
    public var transport: (any Transport)?
    public var release: String?
    public var environment: String?
}
```

If `transport` is nil, the SDK uses `HTTPTransport(envelopeURL: ...)`.

## Top-level API

```swift
@discardableResult public static func initialize(options: ClientOptions) throws -> Client
public static func currentHub() -> Hub
public static func setCurrentHub(_ hub: Hub)
@discardableResult public static func captureMessage(_ message: String, level: Level = .info) -> String
@discardableResult public static func captureException(_ error: Error?, level: Level = .error) -> String
@discardableResult public static func captureEvent(_ event: Event) -> String
public static func withScope(_ body: (Scope) -> Void)
public static func configureScope(_ body: (Scope) -> Void)
public static func setUser(_ user: User?)
public static func setTag(_ key: String, _ value: String)
public static func setExtra(_ key: String, _ value: JSONValue)
public static func setContext(_ key: String, _ value: JSONValue)
public static func setLevel(_ level: Level?)
@discardableResult public static func flush(timeout: TimeInterval) -> Bool
@discardableResult public static func close(timeout: TimeInterval) -> Bool
```

All `Hub` mutations are NSLock-protected; the top-level API is safe to call from any thread/Task.

## Hub

```swift
public final class Hub: @unchecked Sendable {
    public init(client: Client? = nil)
    public func bindClient(_ client: Client?)
    public func getClient() -> Client?
    public func getScope() -> Scope
    @discardableResult public func pushScope() -> Scope
    public func popScope()
    public func withScope(_ body: (Scope) -> Void)
    public func configureScope(_ body: (Scope) -> Void)
    @discardableResult public func captureMessage(_ message: String, level: Level = .info) -> String
    @discardableResult public func captureException(_ error: Error?, level: Level = .error) -> String
    @discardableResult public func captureEvent(_ event: Event) -> String
    @discardableResult public func flush(timeout: TimeInterval) -> Bool
    @discardableResult public func close(timeout: TimeInterval) -> Bool
    public func clone() -> Hub
}
```

`clone()` returns an independent Hub for use across `Task` boundaries when you want to avoid shared mutations.

## Client

```swift
public final class Client: @unchecked Sendable {
    public let dsn: DSN
    public let transport: any Transport
    public let release: String?
    public let environment: String?

    public init(options: ClientOptions) throws

    @discardableResult public func captureMessage(_ message: String, level: Level = .info) -> String
    @discardableResult public func captureException(_ error: Error?, level: Level = .error) -> String
    @discardableResult public func captureEvent(_ event: Event) -> String
    @discardableResult public func flush(timeout: TimeInterval) -> Bool
    @discardableResult public func close(timeout: TimeInterval) -> Bool
}
```

## Scope

```swift
public final class Scope: @unchecked Sendable {
    public init()

    @discardableResult public func setUser(_ user: User?) -> Scope
    @discardableResult public func setTag(_ key: String, _ value: String) -> Scope
    @discardableResult public func setExtra(_ key: String, _ value: JSONValue) -> Scope
    @discardableResult public func setContext(_ key: String, _ value: JSONValue) -> Scope
    @discardableResult public func setLevel(_ level: Level?) -> Scope
    @discardableResult public func setFingerprint(_ fp: [String]?) -> Scope
    @discardableResult public func clear() -> Scope

    public func clone() -> Scope
    public func applyToEvent(_ event: Event) -> Event

    public var user: User? { get }
    public var level: Level? { get }
    public var fingerprint: [String]? { get }
    public var tags: [String: String] { get }
    public var extras: [String: JSONValue] { get }
    public var contexts: [String: JSONValue] { get }
}
```

## Event types

```swift
public enum Level: String, Codable, CaseIterable, Sendable {
    case fatal, error, warning, info, debug
}

public indirect enum JSONValue: Codable, Equatable, Sendable {
    case null, bool(Bool), int(Int), double(Double), string(String)
    case array([JSONValue])
    case object([String: JSONValue])
}

public struct User: Codable, Equatable, Sendable {
    public var id, email, username, ipAddress: String?
}

public struct Frame: Codable, Equatable, Sendable {
    public var function, absPath, filename: String?
    public var lineno, colno: Int?
    public var inApp: Bool?
}

public struct Stacktrace: Codable, Equatable, Sendable {
    public var frames: [Frame]
}

public struct ExceptionValue: Codable, Equatable, Sendable {
    public var type, value: String
    public var stacktrace: Stacktrace?
}

public struct ExceptionInterface: Codable, Equatable, Sendable {
    public var values: [ExceptionValue]
}

public struct SDKInfo: Codable, Equatable, Sendable {
    public var name, version: String
}

public struct Event: Codable, Equatable, Sendable {
    public var eventId: String
    public var timestamp: String
    public var platform: String?
    public var level: Level?
    public var message: String?
    public var exception: ExceptionInterface?
    public var sdk: SDKInfo?
    public var user: User?
    public var tags: [String: String]?
    public var extra: [String: JSONValue]?
    public var contexts: [String: JSONValue]?
    public var release: String?
    public var environment: String?
    public var fingerprint: [String]?
}
```

## Event helpers

```swift
public func newEventID() -> String                                 // 32 hex chars
public func nowISO() -> String                                     // ISO 8601 UTC
public func eventFromError(_ error: Error?, level: Level = .error) -> Event
public func eventFromMessage(_ message: String, level: Level = .info) -> Event
public func captureFrames() -> [Frame]                             // Thread.callStackSymbols, reversed
```

## DSN

```swift
public struct DSN: Equatable, Sendable {
    public let scheme: String
    public let publicKey: String
    public let secret: String?
    public let host: String
    public let port: Int?
    public let path: String
    public let projectID: String
    public let envelopeURL: String
    public let storeURL: String
}

public enum DSNError: Error, Equatable, Sendable {
    case empty
    case badScheme(String)
    case missingPublicKey
    case missingHost
    case missingProjectID
    case nonNumericProjectID(String)
    case portOutOfRange(String)
    case badShape(String)
}

public func parseDSN(_ raw: String) throws -> DSN
```

## Transport

```swift
public protocol Transport: AnyObject, Sendable {
    func send(_ envelope: Data) throws
    func flush(timeout: TimeInterval) -> Bool
    func close(timeout: TimeInterval) -> Bool
}

public enum TransportError: Error, Equatable, Sendable {
    case send(String)
    case closed
}
```

### `HTTPTransport`

```swift
public final class HTTPTransport: Transport, @unchecked Sendable {
    public let envelopeURL: URL
    public init(envelopeURL: URL, timeout: TimeInterval = 10.0)
    public func send(_ envelope: Data) throws
    public func flush(timeout: TimeInterval) -> Bool                  // always true
    public func close(timeout: TimeInterval) -> Bool                  // always true
}
```

Sends `Content-Type: application/x-sentry-envelope` synchronously via URLSession; throws `TransportError.send(_:)` on failure.

### `NoopTransport`

```swift
public final class NoopTransport: Transport, @unchecked Sendable {
    public init()
    public var sent: [Data] { get }                                   // snapshot
    public var count: Int { get }
}
```

## Envelope codec

```swift
public struct EnvelopeItem {
    public var header: [String: Any]
    public var payload: Data
}

public struct ParsedEnvelope {
    public let header: [String: Any]
    public let items: [EnvelopeItem]
}

public enum EnvelopeError: Error, Equatable {
    case empty, json(String), truncatedPayload
}

public func encodeEnvelope(header: [String: Any], items: [EnvelopeItem]) throws -> Data
public func parseEnvelope(_ data: Data) throws -> ParsedEnvelope
```

## Constants

```swift
public let SDK_NAME = "sentry-replica.swift"
public let SDK_VERSION = "0.0.0"
```

## Usage patterns

### App startup (iOS)

```swift
@main
struct MyApp: App {
    init() {
        do {
            _ = try SentryReplica.initialize(options: ClientOptions(
                dsn: ProcessInfo.processInfo.environment["WARDEN_DSN"] ?? "",
                release: "myapp@1.0.0",
                environment: "production"
            ))
        } catch {
            print("Warden init failed: \(error)")
        }
    }
    var body: some Scene { /* ... */ }
}
```

### Capture from `do/catch`

```swift
do {
    try riskyWork()
} catch {
    SentryReplica.captureException(error)
}
```

### Per-task scope

```swift
SentryReplica.withScope { scope in
    scope.setTag("operation", "checkout")
    scope.setUser(User(id: userID, email: email, username: nil, ipAddress: nil))
    SentryReplica.captureMessage("checkout failed", level: .error)
}
```

### Graceful shutdown

```swift
defer {
    _ = SentryReplica.flush(timeout: 2.0)
    _ = SentryReplica.close(timeout: 2.0)
}
```

## Limitations today

- No bundled UIKit/AppKit/SwiftUI integrations.
- No transaction/span/breadcrumb API.
- Stack capture uses `Thread.callStackSymbols`; symbolication relies on dSYM upload server-side.
