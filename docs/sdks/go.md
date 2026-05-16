# Go SDK reference

Source: [`sdks/go/`](../../sdks/go/).

Package `sentryreplica`. Compatible with Go 1.22+. Goroutine-safe Hub and Scope (mutex-protected). Use `hub.Clone()` for isolation in worker goroutines.

## Install

```bash
go get github.com/chrischabot/warden/sdks/go
```

```go
import sr "github.com/chrischabot/warden/sdks/go"
```

## Initialisation

### `NewClient(options ClientOptions) (*Client, error)`

```go
client, err := sr.NewClient(sr.ClientOptions{
    DSN:         "https://abc123@warden.example.com/1",
    Release:     "myapp@1.0.0",
    Environment: "production",
})
if err != nil {
    log.Fatal(err)
}
hub := sr.NewHub(client)
```

### `ClientOptions`

```go
type ClientOptions struct {
    DSN         string
    Transport   Transport      // optional
    Release     string
    Environment string
}
```

If `Transport` is `nil`, the SDK uses `NewHTTPTransport(dsn.EnvelopeURL)`.

## Hub

```go
type Hub struct{ /* ... */ }

func NewHub(client *Client) *Hub
func (h *Hub) BindClient(client *Client)
func (h *Hub) GetClient() *Client
func (h *Hub) GetScope() *Scope
func (h *Hub) PushScope() *Scope
func (h *Hub) PopScope()
func (h *Hub) WithScope(fn func(*Scope))
func (h *Hub) ConfigureScope(fn func(*Scope))
func (h *Hub) CaptureException(err error) string
func (h *Hub) CaptureMessage(message string, level Level) string
func (h *Hub) CaptureEvent(event Event) string
func (h *Hub) Recover()                            // defer hub.Recover() catches panics
func (h *Hub) Clone() *Hub                         // independent hub for a goroutine
```

`Recover()` captures the recovered value as a fatal event:

```go
go func() {
    defer hub.Recover()
    doRiskyWork()
}()
```

`Clone()` returns a new hub with the same client and a deep-cloned scope stack, safe for use in a goroutine that should not share scope mutations with the parent.

## Client

```go
type Client struct {
    DSN         *Dsn
    Transport   Transport
    Release     string
    Environment string
}

func (c *Client) CaptureException(err error, level Level) string
func (c *Client) CaptureMessage(message string, level Level) string
func (c *Client) CaptureEvent(event Event) string
func (c *Client) Flush(timeout time.Duration) bool
func (c *Client) Close(timeout time.Duration) bool
```

## Scope

```go
type Scope struct{ /* mu sync.Mutex protected */ }

func NewScope() *Scope
func (s *Scope) SetUser(user *User) *Scope
func (s *Scope) SetTag(key, value string) *Scope
func (s *Scope) SetExtra(key string, value any) *Scope
func (s *Scope) SetContext(key string, value any) *Scope
func (s *Scope) SetLevel(level Level) *Scope
func (s *Scope) SetFingerprint(fp []string) *Scope
func (s *Scope) Clear() *Scope
func (s *Scope) Clone() *Scope
func (s *Scope) ApplyToEvent(event Event) Event
```

All setters return the receiver for chaining.

## Levels

```go
type Level string

const (
    LevelFatal   Level = "fatal"
    LevelError   Level = "error"
    LevelWarning Level = "warning"
    LevelInfo    Level = "info"
    LevelDebug   Level = "debug"
)
```

## Event types

```go
type User struct {
    ID        string `json:"id,omitempty"`
    Email     string `json:"email,omitempty"`
    Username  string `json:"username,omitempty"`
    IPAddress string `json:"ip_address,omitempty"`
}

type Frame struct {
    Function string
    AbsPath  string
    Filename string
    Lineno   uint32
    Colno    uint32
    InApp    *bool
}

type Stacktrace struct { Frames []Frame }

type ExceptionValue struct {
    Type       string
    Value      string
    Stacktrace *Stacktrace
}
type ExceptionInterface struct { Values []ExceptionValue }
type SdkInfo struct { Name, Version string }

type Event struct {
    EventID     string
    Timestamp   string
    Platform    string
    Level       Level
    Message     string
    Exception   *ExceptionInterface
    SDK         *SdkInfo
    User        *User
    Tags        map[string]string
    Extra       map[string]any
    Contexts    map[string]any
    Release     string
    Environment string
    Fingerprint []string
}
```

## Event builders

```go
func EventFromError(err error, level Level) Event                  // captures call stack (skips 3 frames)
func EventFromMessage(message string, level Level) Event
func EventFromPanic(recovered any) Event
func NewEventID() string                                           // 32 hex chars
func NowISO() string                                               // ISO 8601 UTC
```

`EventFromError` walks `runtime.Caller` for the current stack and produces frames in oldest-first order.

## DSN

```go
type Dsn struct {
    Scheme      string
    PublicKey   string
    Secret      string
    Host        string
    Port        int
    Path        string
    ProjectID   string
    EnvelopeURL string
    StoreURL    string
}

func ParseDsn(s string) (*Dsn, error)
var ErrInvalidDsn = errors.New("invalid dsn")
```

## Transport

```go
type Transport interface {
    Send(envelope []byte) error
    Flush(timeout time.Duration) bool
    Close(timeout time.Duration) bool
}
```

### `HTTPTransport`

```go
type HTTPTransport struct {
    EnvelopeURL string
    Client      *http.Client
    Headers     map[string]string
}

func NewHTTPTransport(envelopeURL string) *HTTPTransport
```

Sync POST via `net/http`. Default `Client.Timeout = 10 * time.Second`. `Flush` and `Close` are no-ops.

### `NoopTransport`

```go
type NoopTransport struct{ /* ... */ }

func NewNoopTransport() *NoopTransport
func (t *NoopTransport) Sent() [][]byte
func (t *NoopTransport) Len() int
```

## Envelope codec

```go
type Item struct {
    Header  map[string]any
    Payload []byte
}

func EncodeEnvelope(header map[string]any, items []Item) ([]byte, error)
func ParseEnvelope(data []byte) (map[string]any, []Item, error)         // tests only

var ErrEnvelopeEmpty = errors.New("envelope empty")
```

## Constants

```go
const (
    SdkName    = "sentry-replica.go"
    SdkVersion = "0.0.0"
)
```

## Usage patterns

### Hub per request, scoped to a handler

```go
func handler(hub *sr.Hub) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        reqHub := hub.Clone()
        defer reqHub.Recover()
        reqHub.ConfigureScope(func(s *sr.Scope) {
            s.SetTag("route", r.URL.Path)
            s.SetUser(&sr.User{ID: r.Header.Get("X-User-Id")})
        })
        // pass reqHub down via context.Context if your code wants it
        next(w, r, reqHub)
    }
}
```

### Capture an error from a handler

```go
if err := doWork(); err != nil {
    reqHub.CaptureException(err)
    http.Error(w, "internal error", http.StatusInternalServerError)
    return
}
```

### Graceful shutdown

```go
defer func() {
    client.Flush(2 * time.Second)
    client.Close(2 * time.Second)
}()
```

## Limitations today

- No bundled framework integrations (gin, echo, net/http middleware). Build them on top of `Hub.Clone()` + `ConfigureScope`.
- No transaction/span/breadcrumb API.
- Stack frames are sourced from `runtime.Caller`; `pkg/errors`-style stack wrappers are not yet introspected.
