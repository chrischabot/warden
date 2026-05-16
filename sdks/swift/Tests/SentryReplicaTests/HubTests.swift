import XCTest
@testable import SentryReplica

final class HubTests: XCTestCase {
    private func newHub() throws -> (Hub, NoopTransport) {
        let transport = NoopTransport()
        var opts = ClientOptions(dsn: "https://abc@relay.test/1")
        opts.transport = transport
        let client = try Client(options: opts)
        return (Hub(client: client), transport)
    }

    func testGetScopeStable() throws {
        let (hub, _) = try newHub()
        XCTAssertTrue(hub.getScope() === hub.getScope())
    }

    func testPushPop() throws {
        let (hub, _) = try newHub()
        hub.getScope().setTag("a", "1")
        let pushed = hub.pushScope()
        XCTAssertEqual(pushed.tags["a"], "1")
        pushed.setTag("a", "2")
        XCTAssertEqual(hub.getScope().tags["a"], "2")
        hub.popScope()
        XCTAssertEqual(hub.getScope().tags["a"], "1")
    }

    func testPopRefusesToPopRoot() throws {
        let (hub, _) = try newHub()
        hub.popScope()
        hub.popScope()
        XCTAssertNotNil(hub.getScope())
    }

    func testWithScopeIsolates() throws {
        let (hub, _) = try newHub()
        hub.getScope().setTag("outer", "parent")
        hub.withScope { s in s.setTag("outer", "child") }
        XCTAssertEqual(hub.getScope().tags["outer"], "parent")
    }

    func testCaptureExceptionAppliesScope() throws {
        let (hub, transport) = try newHub()
        hub.configureScope { s in
            s.setUser(User(id: "u42"))
            s.setTag("request_id", "rid-1")
        }
        struct Boom: Error {}
        let id = hub.captureException(Boom())
        XCTAssertFalse(id.isEmpty)
        XCTAssertEqual(transport.count, 1)
        let envelope = try parseEnvelope(transport.sent[0])
        let body = try JSONDecoder().decode(Event.self, from: envelope.items[0].payload)
        XCTAssertEqual(body.user?.id, "u42")
        XCTAssertEqual(body.tags?["request_id"], "rid-1")
    }

    func testCaptureMessageReturnsEventID() throws {
        let (hub, transport) = try newHub()
        let id = hub.captureMessage("hello")
        XCTAssertEqual(id.count, 32)
        XCTAssertEqual(transport.count, 1)
    }

    func testCaptureWithoutClientReturnsEmpty() {
        let hub = Hub()
        struct Boom: Error {}
        XCTAssertEqual(hub.captureException(Boom()), "")
    }

    func testCloneIsIndependent() throws {
        let (hub, _) = try newHub()
        hub.getScope().setTag("a", "1")
        let clone = hub.clone()
        clone.getScope().setTag("a", "2")
        XCTAssertEqual(hub.getScope().tags["a"], "1")
        XCTAssertEqual(clone.getScope().tags["a"], "2")
    }

    func testTopLevelCaptureViaSingleton() throws {
        let original = SentryReplica.currentHub()
        defer { SentryReplica.setCurrentHub(original) }
        let transport = NoopTransport()
        var opts = ClientOptions(dsn: "https://abc@relay.test/1")
        opts.transport = transport
        let client = try Client(options: opts)
        SentryReplica.setCurrentHub(Hub(client: client))
        struct Boom: Error {}
        let id = SentryReplica.captureException(Boom())
        XCTAssertFalse(id.isEmpty)
        XCTAssertEqual(transport.count, 1)
    }
}