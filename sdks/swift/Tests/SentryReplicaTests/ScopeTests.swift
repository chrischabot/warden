import XCTest
@testable import SentryReplica

final class ScopeTests: XCTestCase {
    func testChainableSetters() {
        let s = Scope()
        s.setUser(User(id: "u1"))
            .setTag("region", "eu-west")
            .setExtra("ctx", .int(42))
            .setLevel(.warning)
            .setFingerprint(["custom"])
        XCTAssertEqual(s.user?.id, "u1")
        XCTAssertEqual(s.tags["region"], "eu-west")
        XCTAssertEqual(s.extras["ctx"], .int(42))
        XCTAssertEqual(s.level, .warning)
        XCTAssertEqual(s.fingerprint?.count, 1)
    }

    func testClearWipesEverything() {
        let s = Scope()
            .setUser(User(id: "u"))
            .setTag("k", "v")
            .setLevel(.error)
            .setFingerprint(["f"])
        s.clear()
        XCTAssertNil(s.user)
        XCTAssertTrue(s.tags.isEmpty)
        XCTAssertNil(s.level)
        XCTAssertNil(s.fingerprint)
    }

    func testCloneIsIndependent() {
        let s = Scope().setTag("a", "1")
        let c = s.clone().setTag("a", "2").setTag("b", "3")
        XCTAssertEqual(s.tags["a"], "1")
        XCTAssertNil(s.tags["b"])
        XCTAssertEqual(c.tags["a"], "2")
        XCTAssertEqual(c.tags["b"], "3")
    }

    private func baseEvent() -> Event {
        Event(eventId: String(repeating: "x", count: 32), timestamp: "2024-01-01T00:00:00Z")
    }

    func testApplyToEventAddsUserWhenAbsent() {
        let s = Scope().setUser(User(id: "u1"))
        let out = s.applyToEvent(baseEvent())
        XCTAssertEqual(out.user?.id, "u1")
    }

    func testApplyToEventPreservesEventUser() {
        let s = Scope().setUser(User(id: "scope"))
        var ev = baseEvent()
        ev.user = User(id: "event")
        let out = s.applyToEvent(ev)
        XCTAssertEqual(out.user?.id, "event")
    }

    func testApplyToEventMergesTagsEventWins() {
        let s = Scope().setTag("a", "scope-a").setTag("b", "scope-b")
        var ev = baseEvent()
        ev.tags = ["a": "event-a"]
        let out = s.applyToEvent(ev)
        XCTAssertEqual(out.tags?["a"], "event-a")
        XCTAssertEqual(out.tags?["b"], "scope-b")
    }

    func testApplyToEventAdoptsLevelWhenAbsent() {
        let s = Scope().setLevel(.warning)
        let out = s.applyToEvent(baseEvent())
        XCTAssertEqual(out.level, .warning)
    }

    func testApplyToEventPreservesEventLevel() {
        let s = Scope().setLevel(.warning)
        var ev = baseEvent()
        ev.level = .fatal
        let out = s.applyToEvent(ev)
        XCTAssertEqual(out.level, .fatal)
    }
}