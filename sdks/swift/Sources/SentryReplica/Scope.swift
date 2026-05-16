import Foundation

public final class Scope: @unchecked Sendable {
    private let lock = NSLock()
    private var _user: User?
    private var _level: Level?
    private var _fingerprint: [String]?
    private var _tags: [String: String] = [:]
    private var _extras: [String: JSONValue] = [:]
    private var _contexts: [String: JSONValue] = [:]

    public init() {}

    @discardableResult
    public func setUser(_ user: User?) -> Scope {
        lock.lock(); defer { lock.unlock() }
        _user = user
        return self
    }

    @discardableResult
    public func setTag(_ key: String, _ value: String) -> Scope {
        lock.lock(); defer { lock.unlock() }
        _tags[key] = value
        return self
    }

    @discardableResult
    public func setExtra(_ key: String, _ value: JSONValue) -> Scope {
        lock.lock(); defer { lock.unlock() }
        _extras[key] = value
        return self
    }

    @discardableResult
    public func setContext(_ key: String, _ value: JSONValue) -> Scope {
        lock.lock(); defer { lock.unlock() }
        _contexts[key] = value
        return self
    }

    @discardableResult
    public func setLevel(_ level: Level?) -> Scope {
        lock.lock(); defer { lock.unlock() }
        _level = level
        return self
    }

    @discardableResult
    public func setFingerprint(_ fp: [String]?) -> Scope {
        lock.lock(); defer { lock.unlock() }
        _fingerprint = fp
        return self
    }

    @discardableResult
    public func clear() -> Scope {
        lock.lock(); defer { lock.unlock() }
        _user = nil
        _level = nil
        _fingerprint = nil
        _tags.removeAll()
        _extras.removeAll()
        _contexts.removeAll()
        return self
    }

    public func clone() -> Scope {
        lock.lock(); defer { lock.unlock() }
        let c = Scope()
        c._user = _user
        c._level = _level
        c._fingerprint = _fingerprint
        c._tags = _tags
        c._extras = _extras
        c._contexts = _contexts
        return c
    }

    /// Merge scope values into event. Event-level values win on conflict.
    public func applyToEvent(_ event: Event) -> Event {
        lock.lock(); defer { lock.unlock() }
        var e = event
        if e.user == nil, let u = _user { e.user = u }
        if e.level == nil { e.level = _level }
        if e.fingerprint == nil, let fp = _fingerprint { e.fingerprint = fp }
        if !_tags.isEmpty {
            var t = e.tags ?? [:]
            for (k, v) in _tags where t[k] == nil { t[k] = v }
            e.tags = t
        }
        if !_extras.isEmpty {
            var x = e.extra ?? [:]
            for (k, v) in _extras where x[k] == nil { x[k] = v }
            e.extra = x
        }
        if !_contexts.isEmpty {
            var c = e.contexts ?? [:]
            for (k, v) in _contexts where c[k] == nil { c[k] = v }
            e.contexts = c
        }
        return e
    }

    // ---- diagnostics ----

    public var user: User? {
        lock.lock(); defer { lock.unlock() }
        return _user
    }
    public var level: Level? {
        lock.lock(); defer { lock.unlock() }
        return _level
    }
    public var fingerprint: [String]? {
        lock.lock(); defer { lock.unlock() }
        return _fingerprint
    }
    public var tags: [String: String] {
        lock.lock(); defer { lock.unlock() }
        return _tags
    }
    public var extras: [String: JSONValue] {
        lock.lock(); defer { lock.unlock() }
        return _extras
    }
    public var contexts: [String: JSONValue] {
        lock.lock(); defer { lock.unlock() }
        return _contexts
    }
}