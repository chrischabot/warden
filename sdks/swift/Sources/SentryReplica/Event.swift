import Foundation

public let SDK_NAME = "sentry-replica.swift"
public let SDK_VERSION = "0.0.0"

public enum Level: String, Codable, CaseIterable, Sendable {
    case fatal, error, warning, info, debug
}

/// Recursive JSON value type. Used in event.extra / event.contexts where
/// arbitrary structured data may appear.
public indirect enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let v = try? c.decode(Bool.self) {
            self = .bool(v)
        } else if let v = try? c.decode(Int.self) {
            self = .int(v)
        } else if let v = try? c.decode(Double.self) {
            self = .double(v)
        } else if let v = try? c.decode(String.self) {
            self = .string(v)
        } else if let v = try? c.decode([JSONValue].self) {
            self = .array(v)
        } else if let v = try? c.decode([String: JSONValue].self) {
            self = .object(v)
        } else {
            throw DecodingError.dataCorruptedError(
                in: c, debugDescription: "unknown JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
}

public struct Frame: Codable, Equatable, Sendable {
    public var function: String?
    public var absPath: String?
    public var filename: String?
    public var lineno: Int?
    public var colno: Int?
    public var inApp: Bool?

    enum CodingKeys: String, CodingKey {
        case function
        case absPath = "abs_path"
        case filename
        case lineno
        case colno
        case inApp = "in_app"
    }

    public init(
        function: String? = nil,
        absPath: String? = nil,
        filename: String? = nil,
        lineno: Int? = nil,
        colno: Int? = nil,
        inApp: Bool? = nil
    ) {
        self.function = function
        self.absPath = absPath
        self.filename = filename
        self.lineno = lineno
        self.colno = colno
        self.inApp = inApp
    }
}

public struct Stacktrace: Codable, Equatable, Sendable {
    public var frames: [Frame]
    public init(frames: [Frame]) { self.frames = frames }
}

public struct ExceptionValue: Codable, Equatable, Sendable {
    public var type: String
    public var value: String
    public var stacktrace: Stacktrace?
    public init(type: String, value: String, stacktrace: Stacktrace? = nil) {
        self.type = type
        self.value = value
        self.stacktrace = stacktrace
    }
}

public struct ExceptionInterface: Codable, Equatable, Sendable {
    public var values: [ExceptionValue]
    public init(values: [ExceptionValue]) { self.values = values }
}

public struct User: Codable, Equatable, Sendable {
    public var id: String?
    public var email: String?
    public var username: String?
    public var ipAddress: String?

    enum CodingKeys: String, CodingKey {
        case id, email, username
        case ipAddress = "ip_address"
    }

    public init(
        id: String? = nil,
        email: String? = nil,
        username: String? = nil,
        ipAddress: String? = nil
    ) {
        self.id = id
        self.email = email
        self.username = username
        self.ipAddress = ipAddress
    }
}

public struct SDKInfo: Codable, Equatable, Sendable {
    public var name: String
    public var version: String
    public init(name: String, version: String) {
        self.name = name
        self.version = version
    }
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

    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"
        case timestamp, platform, level, message, exception, sdk, user
        case tags, extra, contexts, release, environment, fingerprint
    }

    public init(
        eventId: String,
        timestamp: String,
        platform: String? = nil,
        level: Level? = nil,
        message: String? = nil,
        exception: ExceptionInterface? = nil,
        sdk: SDKInfo? = nil,
        user: User? = nil,
        tags: [String: String]? = nil,
        extra: [String: JSONValue]? = nil,
        contexts: [String: JSONValue]? = nil,
        release: String? = nil,
        environment: String? = nil,
        fingerprint: [String]? = nil
    ) {
        self.eventId = eventId
        self.timestamp = timestamp
        self.platform = platform
        self.level = level
        self.message = message
        self.exception = exception
        self.sdk = sdk
        self.user = user
        self.tags = tags
        self.extra = extra
        self.contexts = contexts
        self.release = release
        self.environment = environment
        self.fingerprint = fingerprint
    }
}

/// 32-char lowercase hex UUID v4.
public func newEventID() -> String {
    let uuid = UUID().uuidString.lowercased()
    return uuid.replacingOccurrences(of: "-", with: "")
}

/// Sentry-compatible ISO 8601 timestamp in UTC.
public func nowISO() -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'"
    f.timeZone = TimeZone(identifier: "UTC")
    f.locale = Locale(identifier: "en_US_POSIX")
    return f.string(from: Date())
}

/// Build an event from a Swift Error.
public func eventFromError(_ error: Error?, level: Level = .error) -> Event {
    let value: String
    let typeName: String
    if let error = error {
        value = String(describing: error)
        typeName = String(describing: type(of: error))
    } else {
        value = ""
        typeName = "Error"
    }
    let frames = captureFrames()
    var stacktrace: Stacktrace?
    if !frames.isEmpty {
        stacktrace = Stacktrace(frames: frames)
    }
    return Event(
        eventId: newEventID(),
        timestamp: nowISO(),
        platform: "swift",
        level: level,
        exception: ExceptionInterface(values: [
            ExceptionValue(type: typeName, value: value, stacktrace: stacktrace)
        ]),
        sdk: SDKInfo(name: SDK_NAME, version: SDK_VERSION)
    )
}

/// Build a message-shaped event.
public func eventFromMessage(_ message: String, level: Level = .info) -> Event {
    Event(
        eventId: newEventID(),
        timestamp: nowISO(),
        platform: "swift",
        level: level,
        message: message,
        sdk: SDKInfo(name: SDK_NAME, version: SDK_VERSION)
    )
}

/// Capture current call-stack symbols as Frames. Linux backtrace text is
/// included verbatim; Apple platforms get the demangled form when run
/// through `swift-demangle`. Either way, useful enough for grouping.
public func captureFrames() -> [Frame] {
    let symbols = Thread.callStackSymbols
    // Reverse so the oldest call (root of the trace) comes first, matching
    // Sentry's expected order.
    return symbols.reversed().map { line in
        Frame(function: line)
    }
}