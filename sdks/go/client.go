package sentryreplica

import (
	"encoding/json"
	"fmt"
	"time"
)

// ClientOptions configure a Client.
type ClientOptions struct {
	DSN         string
	Transport   Transport // optional; defaults to HTTPTransport
	Release     string
	Environment string
}

// Client carries DSN config + a transport.
type Client struct {
	DSN         *Dsn
	Transport   Transport
	Release     string
	Environment string
}

// NewClient validates the DSN and selects a transport.
func NewClient(options ClientOptions) (*Client, error) {
	dsn, err := ParseDsn(options.DSN)
	if err != nil {
		return nil, err
	}
	transport := options.Transport
	if transport == nil {
		transport = NewHTTPTransport(dsn.EnvelopeURL)
	}
	return &Client{
		DSN:         dsn,
		Transport:   transport,
		Release:     options.Release,
		Environment: options.Environment,
	}, nil
}

// CaptureException builds and sends an error event.
func (c *Client) CaptureException(err error, level Level) string {
	return c.CaptureEvent(EventFromError(err, level))
}

// CaptureMessage builds and sends a message event.
func (c *Client) CaptureMessage(message string, level Level) string {
	return c.CaptureEvent(EventFromMessage(message, level))
}

// CaptureEvent applies defaults, wraps in an envelope, and hands off to the transport.
func (c *Client) CaptureEvent(event Event) string {
	c.applyDefaults(&event)
	body, err := json.Marshal(event)
	if err != nil {
		return ""
	}
	envelope, err := EncodeEnvelope(
		map[string]any{
			"event_id": event.EventID,
			"sent_at":  event.Timestamp,
			"dsn":      c.DSN.EnvelopeURL,
			"sdk":      map[string]any{"name": SdkName, "version": SdkVersion},
		},
		[]Item{{Header: map[string]any{"type": "event"}, Payload: body}},
	)
	if err != nil {
		return ""
	}
	// Fire-and-forget; transport errors don't propagate from capture.
	_ = c.Transport.Send(envelope)
	return event.EventID
}

// Flush forwards to the transport.
func (c *Client) Flush(timeout time.Duration) bool {
	return c.Transport.Flush(timeout)
}

// Close forwards to the transport.
func (c *Client) Close(timeout time.Duration) bool {
	return c.Transport.Close(timeout)
}

func (c *Client) applyDefaults(event *Event) {
	if event.EventID == "" {
		event.EventID = NewEventID()
	}
	if event.Timestamp == "" {
		event.Timestamp = NowISO()
	}
	if c.Release != "" && event.Release == "" {
		event.Release = c.Release
	}
	if c.Environment != "" && event.Environment == "" {
		event.Environment = c.Environment
	}
}

func (c *Client) String() string {
	return fmt.Sprintf("Client(dsn=%s, release=%q, environment=%q)", c.DSN.EnvelopeURL, c.Release, c.Environment)
}