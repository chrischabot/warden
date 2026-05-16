import XCTest
@testable import SentryReplica

final class EventTests: XCTestCase {
    func testNewEventIDIs32Hex() {
        let id = newEventID()
        XCTAssertEqual(id.count, 32)
        XCTAssertTrue(
            id.unicodeScalars.allSatisfy {
                ($0.value >= 0x30 && $0.value <= 0x39)
                || ($0.value >= 0x61 && $0.value <= 0x66)
            }
        )
    }

    func testEventIDsUnique() {
        var seen = Set<String>()
        for _ in 0..<100 { seen.insert(newEventID()) }
        XCTAssertEqual(seen.count, 100)
    }

    func testNowISOShape() {
        let s = nowISO()
        XCTAssertTrue(s.contains("T"))
        XCTAssertTrue(s.hasSuffix("Z"))
    }

    func testEventFromMessageDefaultsInfo() {
        let ev = eventFromMessage("hi")
        XCTAssertEqual(ev.level, .info)
        XCTAssertEqual(ev.message, "hi")
        XCTAssertEqual(ev.platform, "swift")
        XCTAssertNotNil(ev.sdk)
    }

    func testEventFromMessageRespectsLevel() {
        let ev = eventFromMessage("warn", level: .warning)
        XCTAssertEqual(ev.level, .warning)
    }

    func testEventFromErrorCapturesValue() {
        struct Boom: Error, CustomStringConvertible {
            var description: String { "boom" }
        }
        let ev = eventFromError(Boom())
        XCTAssertEqual(ev.level, .error)
        XCTAssertEqual(ev.exception?.values.count, 1)
        XCTAssertEqual(ev.exception?.values.first?.value, "boom")
    }

    func testEventCodableRoundTrip() throws {
        let ev = eventFromMessage("hi", level: .warning)
        let data = try JSONEncoder().encode(ev)
        let decoded = try JSONDecoder().decode(Event.self, from: data)
        XCTAssertEqual(decoded.eventId, ev.eventId)
        XCTAssertEqual(decoded.message, "hi")
        XCTAssertEqual(decoded.level, .warning)
        XCTAssertEqual(decoded.platform, "swift")
    }

    func testEventOmitsAbsentOptionalsInJSON() throws {
        let ev = eventFromMessage("hi")
        let data = try JSONEncoder().encode(ev)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertNotNil(json)
        // "exception" was nil and should be omitted from the JSON.
        XCTAssertNil(json?["exception"])
    }
}