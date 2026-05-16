// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "SentryReplica",
    products: [
        .library(name: "SentryReplica", targets: ["SentryReplica"]),
    ],
    targets: [
        .target(name: "SentryReplica", path: "Sources/SentryReplica"),
        .testTarget(
            name: "SentryReplicaTests",
            dependencies: ["SentryReplica"],
            path: "Tests/SentryReplicaTests"
        ),
    ]
)