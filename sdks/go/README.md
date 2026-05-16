# sentry-replica (Go SDK)

Go SDK for sentry-replica. Mirrors the TypeScript, Python, and Rust SDKs: DSN parsing, envelope construction, Event types, Scope/Hub state, transport interface, panic recovery via `defer Recover()`.

Stdlib-only (`net/http`, `net/url`, `runtime`, `encoding/json`). No external dependencies.

## Quick start

```go
package main

import (
    "errors"
    sr "github.com/igentai/sentry-replica/sdks/go"
)

func main() {
    if err := sr.Init(sr.ClientOptions{
        DSN: "https://abc@relay.example.com/1",
    }); err != nil {
        panic(err)
    }
    defer sr.Flush(2_000_000_000) // 2s

    defer sr.CurrentHub().Recover()

    sr.CaptureException(errors.New("something went wrong"))
    sr.CaptureMessage("hello", "info")
}
```

Scope helpers:

```go
sr.SetUser(&sr.User{ID: "u-123"})
sr.SetTag("region", "eu-west")

sr.WithScope(func(s *sr.Scope) {
    s.SetExtra("request_id", "abc")
    sr.CaptureException(err)
})
```

## Build + test

```bash
cd sdks/go
go build ./...
go test ./...
```