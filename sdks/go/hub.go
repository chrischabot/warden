package sentryreplica

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

// Hub holds the current Client and a scope stack.
//
// Per spec §4.3: "Goroutine-safe Hub via per-goroutine clones; matches the
// existing getsentry/sentry-go design." This v1 protects the stack with a
// mutex so a shared singleton Hub is safe across goroutines; clone for
// per-goroutine isolation when needed.
type Hub struct {
	mu     sync.Mutex
	client *Client
	stack  []*Scope
}

// NewHub builds a Hub with a single empty scope.
func NewHub(client *Client) *Hub {
	return &Hub{client: client, stack: []*Scope{NewScope()}}
}

// BindClient attaches a Client (replaces any previous).
func (h *Hub) BindClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.client = client
}

// GetClient returns the bound Client or nil.
func (h *Hub) GetClient() *Client {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.client
}

// GetScope returns the current (top-of-stack) scope.
func (h *Hub) GetScope() *Scope {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.stack[len(h.stack)-1]
}

// PushScope pushes a clone of the current scope. Returns the new top.
func (h *Hub) PushScope() *Scope {
	h.mu.Lock()
	defer h.mu.Unlock()
	cloned := h.stack[len(h.stack)-1].Clone()
	h.stack = append(h.stack, cloned)
	return cloned
}

// PopScope drops the top scope. No-op if only the root remains.
func (h *Hub) PopScope() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.stack) > 1 {
		h.stack = h.stack[:len(h.stack)-1]
	}
}

// WithScope pushes a cloned scope, runs fn, pops on return — even on panic.
func (h *Hub) WithScope(fn func(*Scope)) {
	scope := h.PushScope()
	defer h.PopScope()
	fn(scope)
}

// ConfigureScope mutates the current scope in place.
func (h *Hub) ConfigureScope(fn func(*Scope)) {
	fn(h.GetScope())
}

// CaptureException applies the current scope to an error event and sends it.
func (h *Hub) CaptureException(err error) string {
	return h.CaptureEvent(EventFromError(err, ""))
}

// CaptureMessage applies the current scope to a message event and sends it.
func (h *Hub) CaptureMessage(message string, level Level) string {
	return h.CaptureEvent(EventFromMessage(message, level))
}

// CaptureEvent applies the current scope and forwards to the Client.
func (h *Hub) CaptureEvent(event Event) string {
	h.mu.Lock()
	client := h.client
	scope := h.stack[len(h.stack)-1]
	h.mu.Unlock()
	if client == nil {
		return ""
	}
	finalEvent := scope.ApplyToEvent(event)
	return client.CaptureEvent(finalEvent)
}

// Recover captures a panic. Intended for `defer hub.Recover()`.
func (h *Hub) Recover() {
	if r := recover(); r != nil {
		h.CaptureEvent(EventFromPanic(r))
	}
}

// Flush forwards to the bound Client.
func (h *Hub) Flush(timeout time.Duration) bool {
	c := h.GetClient()
	if c == nil {
		return true
	}
	return c.Flush(timeout)
}

// Close forwards to the bound Client.
func (h *Hub) Close(timeout time.Duration) bool {
	c := h.GetClient()
	if c == nil {
		return true
	}
	return c.Close(timeout)
}

// Clone returns an independent Hub for use in a separate goroutine.
func (h *Hub) Clone() *Hub {
	h.mu.Lock()
	defer h.mu.Unlock()
	clone := &Hub{client: h.client, stack: make([]*Scope, len(h.stack))}
	for i, s := range h.stack {
		clone.stack[i] = s.Clone()
	}
	return clone
}

// ErrNoClient is returned when an init / capture operation requires a Client but none is bound.
var ErrNoClient = errors.New("sentry-replica: no Client bound to the current Hub")

func (h *Hub) String() string {
	c := h.GetClient()
	if c == nil {
		return "Hub(no client)"
	}
	return fmt.Sprintf("Hub(%s)", c)
}