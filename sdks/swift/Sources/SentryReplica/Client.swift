import Foundation

public struct ClientOptions: Sendable {
    public var dsn: String
    public var transport: (any Transport)?
    public var release: String?
    public var environment: String?
    public init(
        dsn: String,
        transport: (any Transport)? = nil,
        release: String? = nil,
        environment: String? = nil
    ) {
        self.dsn = dsn
        self.transport = transport
        self.release = release
        self.environment = environment
    }
}

public final class Client: @unchecked Sendable {
    public let dsn: DSN
    public let transport: any Transport
    public let release: String?
    public let environment: String?

    public init(options: ClientOptions) throws {
        self.dsn = try parseDSN(options.dsn)
        self.release = options.release
        self.environment = options.environment
        if let t = options.transport {
            self.transport = t
        } else if let url = URL(string: dsn.envelopeURL) {
            self.transport = HTTPTransport(envelopeURL: url)
        } else {
            self.transport = NoopTransport()
        }
    }

    @discardableResult
    public func captureMessage(_ message: String, level: Level = .info) -> String {
        captureEvent(eventFromMessage(message, level: level))
    }

    @discardableResult
    public func captureException(_ error: Error?, level: Level = .error) -> String {
        captureEvent(eventFromError(error, level: level))
    }

    @discardableResult
    public func captureEvent(_ event: Event) -> String {
        var ev = event
        applyDefaults(&ev)
        let body: Data
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            body = try encoder.encode(ev)
        } catch {
            return ""
        }
        let envelopeHeader: [String: Any] = [
            "event_id": ev.eventId,
            "sent_at": ev.timestamp,
            "dsn": dsn.envelopeURL,
            "sdk": ["name": SDK_NAME, "version": SDK_VERSION],
        ]
        let items = [
            EnvelopeItem(header: ["type": "event"], payload: body)
        ]
        do {
            let envelope = try encodeEnvelope(header: envelopeHeader, items: items)
            // Fire-and-forget; transport errors don't propagate from capture.
            try? transport.send(envelope)
        } catch {
            return ""
        }
        return ev.eventId
    }

    public func flush(timeout: TimeInterval) -> Bool {
        transport.flush(timeout: timeout)
    }

    public func close(timeout: TimeInterval) -> Bool {
        transport.close(timeout: timeout)
    }

    private func applyDefaults(_ event: inout Event) {
        if event.eventId.isEmpty { event.eventId = newEventID() }
        if event.timestamp.isEmpty { event.timestamp = nowISO() }
        if event.release == nil { event.release = release }
        if event.environment == nil { event.environment = environment }
    }
}