package sentryreplica

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Transport is the contract for delivering envelope bytes to a relay.
type Transport interface {
	Send(envelope []byte) error
	Flush(timeout time.Duration) bool
	Close(timeout time.Duration) bool
}

// HTTPTransport delivers envelopes via net/http.
type HTTPTransport struct {
	EnvelopeURL string
	Client      *http.Client
	Headers     map[string]string
}

// NewHTTPTransport builds a transport pointing at the given URL.
func NewHTTPTransport(envelopeURL string) *HTTPTransport {
	return &HTTPTransport{
		EnvelopeURL: envelopeURL,
		Client: &http.Client{
			Timeout: 10 * time.Second,
		},
		Headers: map[string]string{
			"Content-Type": "application/x-sentry-envelope",
		},
	}
}

// Send posts the envelope synchronously.
func (t *HTTPTransport) Send(envelope []byte) error {
	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		t.EnvelopeURL,
		bytes.NewReader(envelope),
	)
	if err != nil {
		return fmt.Errorf("transport: build request: %w", err)
	}
	for k, v := range t.Headers {
		req.Header.Set(k, v)
	}
	resp, err := t.Client.Do(req)
	if err != nil {
		return fmt.Errorf("transport: send: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("transport: server returned %d", resp.StatusCode)
	}
	return nil
}

// Flush is a no-op for the synchronous transport.
func (t *HTTPTransport) Flush(_ time.Duration) bool { return true }

// Close is a no-op; net/http.Client manages its own pool.
func (t *HTTPTransport) Close(_ time.Duration) bool { return true }

// NoopTransport records sent envelopes in memory. Useful for tests.
type NoopTransport struct {
	mu   sync.Mutex
	sent [][]byte
}

// NewNoopTransport returns an empty recorder.
func NewNoopTransport() *NoopTransport { return &NoopTransport{} }

// Send records the envelope and returns nil.
func (t *NoopTransport) Send(envelope []byte) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.sent = append(t.sent, append([]byte(nil), envelope...))
	return nil
}

// Flush always returns true.
func (t *NoopTransport) Flush(_ time.Duration) bool { return true }

// Close always returns true.
func (t *NoopTransport) Close(_ time.Duration) bool { return true }

// Sent returns a snapshot of all envelopes recorded.
func (t *NoopTransport) Sent() [][]byte {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([][]byte, len(t.sent))
	for i, b := range t.sent {
		out[i] = append([]byte(nil), b...)
	}
	return out
}

// Len returns the count of recorded envelopes.
func (t *NoopTransport) Len() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.sent)
}