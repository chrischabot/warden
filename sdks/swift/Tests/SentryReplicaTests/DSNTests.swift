import XCTest
@testable import SentryReplica

final class DSNTests: XCTestCase {
    func testMinimalHTTPS() throws {
        let dsn = try parseDSN("https://abc123@sentry.example.com/1")
        XCTAssertEqual(dsn.scheme, "https")
        XCTAssertEqual(dsn.publicKey, "abc123")
        XCTAssertNil(dsn.secret)
        XCTAssertEqual(dsn.host, "sentry.example.com")
        XCTAssertNil(dsn.port)
        XCTAssertEqual(dsn.path, "")
        XCTAssertEqual(dsn.projectID, "1")
        XCTAssertEqual(dsn.envelopeURL, "https://sentry.example.com/api/1/envelope/")
    }

    func testHTTPWithSecretPortPath() throws {
        let dsn = try parseDSN("http://pk:sk@localhost:9000/api/v2/42")
        XCTAssertEqual(dsn.secret, "sk")
        XCTAssertEqual(dsn.port, 9000)
        XCTAssertEqual(dsn.path, "/api/v2")
        XCTAssertEqual(dsn.projectID, "42")
        XCTAssertEqual(
            dsn.envelopeURL, "http://localhost:9000/api/v2/api/42/envelope/")
    }

    func testLargeProjectIDPreservedAsString() throws {
        let dsn = try parseDSN("https://k@sentry.io/123456789012345")
        XCTAssertEqual(dsn.projectID, "123456789012345")
    }

    func testRejectsEmpty() {
        XCTAssertThrowsError(try parseDSN("")) { error in
            XCTAssertEqual(error as? DSNError, .empty)
        }
    }

    func testRejectsBadScheme() {
        XCTAssertThrowsError(try parseDSN("ftp://k@host/1")) { error in
            if case .badScheme = error as? DSNError {} else {
                XCTFail("expected badScheme, got \(error)")
            }
        }
    }

    func testRejectsMissingPublicKey() {
        XCTAssertThrowsError(try parseDSN("https://@host/1"))
    }

    func testRejectsMissingHost() {
        XCTAssertThrowsError(try parseDSN("https://k@/1"))
    }

    func testRejectsMissingProjectID() {
        XCTAssertThrowsError(try parseDSN("https://k@host/")) { error in
            XCTAssertEqual(error as? DSNError, .missingProjectID)
        }
    }

    func testRejectsNonNumericProjectID() {
        XCTAssertThrowsError(try parseDSN("https://k@host/abc")) { error in
            if case .nonNumericProjectID = error as? DSNError {} else {
                XCTFail("expected nonNumericProjectID, got \(error)")
            }
        }
    }

    func testRejectsPortOutOfRange() {
        XCTAssertThrowsError(try parseDSN("https://k@host:99999/1")) { error in
            if case .portOutOfRange = error as? DSNError {} else {
                XCTFail("expected portOutOfRange, got \(error)")
            }
        }
        XCTAssertThrowsError(try parseDSN("https://k@host:0/1"))
    }
}