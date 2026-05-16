# JavaScript / TypeScript SDK reference

Source: [`sdks/javascript/src/`](../../sdks/javascript/src/).

Works in Node 18+, Bun, browsers, and Cloudflare Workers. The transport uses native `fetch`.

## Install

In a workspace project it's resolved as `@sr/sdk-javascript`. For external consumption the package will be published as `@warden/sdk`. Throughout this doc imports use the consumer name.

## Entry points

| Path                                      | What                                         |
| ----------------------------------------- | -------------------------------------------- |
| `@warden/sdk`                             | The main public surface.                     |
| `@warden/sdk/client`                      | `Client`, `clientWithNoopTransport`.         |
| `@warden/sdk/transport`                   | `Transport`, `HttpTransport`, `NoopTransport`. |
| `@warden/sdk/event`                       | Event builders, `newEventId`, `nowIso`.      |
| `@warden/sdk/stack-parser`                | `parseStack` for V8/JSC stack strings.       |
| `@warden/sdk/types`                       | All type definitions.                        |

## Initialisation

### `init(options: ClientOptions): Client`

```ts
import { init } from "@warden/sdk";

init({
  dsn: "https://abc123@warden.example.com/1",
  release: "myapp@1.0.0",
  environment: "production",
});
```

Creates a `Client` and binds it to the singleton `Hub`. Returns the client for advanced use.

#### `ClientOptions`

| Field                | Type           | Required | Default          | Notes                                                  |
| -------------------- | -------------- | -------- | ---------------- | ------------------------------------------------------ |
| `dsn`                | `string`       | yes      | —                | Parsed into envelope URL + project key.                |
| `release`            | `string`       | no       | unset            | Applied to every event automatically.                  |
| `environment`        | `string`       | no       | unset            | Applied to every event automatically.                  |
| `transport`          | `Transport`    | no       | `HttpTransport`  | Plug in for test or custom routing.                    |
| `maxBufferedEvents`  | `number`       | no       | `30`             | Concurrency cap inside the default HTTP transport.     |

### `getCurrentClient(): Client | undefined`

Returns the bound client, or `undefined` if `init()` hasn't run.

### `getCurrentHub(): Hub`

Returns the module-level singleton Hub.

### `setCurrentHub(hub: Hub): void`

Replace the current Hub. Primarily for tests.

## Event capture

All three route through the singleton Hub's current scope.

### `captureException(err: unknown, options?: CaptureOptions): string`

Capture an `Error`, a string, or any value. Non-Error values are coerced before stack parsing. Returns `event_id`.

```ts
import { captureException } from "@warden/sdk";

try { /* ... */ } catch (e) {
  const id = captureException(e, { level: "error", tags: { route: "/checkout" } });
}
```

### `captureMessage(message: string, options?: CaptureOptions): string`

Capture a text message. Returns `event_id`.

### `captureEvent(event: Event): string`

Capture a pre-built `Event`. Event values override scope values; only the merged result is sent.

### `CaptureOptions`

```ts
interface CaptureOptions {
  level?: SentryLevel;            // 'fatal' | 'error' | 'warning' | 'info' | 'debug'
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: User;
}
```

## Scope helpers (global)

### `withScope<T>(fn: (scope: Scope) => T): T`

Push a cloned scope, run `fn`, pop on exit (even on throw). Idiomatic for one-shot enrichment.

```ts
withScope((s) => {
  s.setTag("worker", "checkout-1");
  captureMessage("billing failed", { level: "error" });
});
```

### `configureScope(fn: (scope: Scope) => void): void`

Mutate the current scope in place. Persists across captures until cleared/overwritten.

### `setUser(user: User | null): void`

Set the user on the current scope, or `null` to clear.

```ts
interface User {
  id?: string;
  email?: string;
  ip_address?: string;
  username?: string;
}
```

### `setTag(key: string, value: string): void`

Set one indexed tag.

### `setExtra(key: string, value: unknown): void`

Set one unindexed extra.

### `setContext(key: string, value: unknown): void`

Set one named context object (`os`, `runtime`, `gpu`, custom).

### `setLevel(level: SentryLevel | null): void`

Set the scope's level floor.

## `Scope` class

Returned to you inside `withScope(fn)` and `configureScope(fn)`. All mutators are chainable.

```ts
class Scope {
  setUser(user: User | null): this;
  setTag(key: string, value: string): this;
  setTags(tags: Readonly<Record<string, string>>): this;
  setExtra(key: string, value: unknown): this;
  setContext(key: string, value: unknown): this;
  setLevel(level: SentryLevel | null): this;
  setFingerprint(fp: readonly string[] | null): this;
  clear(): this;
  clone(): Scope;
  applyToEvent(event: Event): Event;

  readonly user: User | null;
  readonly level: SentryLevel | null;
  readonly fingerprint: readonly string[] | null;
  readonly tags: Readonly<Record<string, string>>;
  readonly extras: Readonly<Record<string, unknown>>;
  readonly contexts: Readonly<Record<string, unknown>>;
}
```

`setFingerprint` overrides server-side grouping. Pass an array of strings to define a custom group, or `null` to clear.

## `Hub` class

The default Hub is a singleton; access it with `getCurrentHub()`.

```ts
class Hub {
  bindClient(client: Client): void;
  getClient(): Client | undefined;
  getScope(): Scope;
  pushScope(): Scope;
  popScope(): void;
  withScope<T>(fn: (scope: Scope) => T): T;
  configureScope(fn: (scope: Scope) => void): void;
  captureException(err: unknown, options?: CaptureOptions): string;
  captureMessage(message: string, options?: CaptureOptions): string;
  captureEvent(event: Event): string;
}
```

Use the Hub directly if you need multiple Clients in one process (rare).

## `Client` class

```ts
class Client {
  constructor(options: ClientOptions);
  readonly options: ClientOptions;
  readonly dsn: Dsn;
  readonly transport: Transport;

  captureException(err: unknown, options?: CaptureOptions): string;
  captureMessage(message: string, options?: CaptureOptions): string;
  captureEvent(event: Event): string;

  flush(timeoutMs?: number): Promise<boolean>;
  close(timeoutMs?: number): Promise<boolean>;
}

function clientWithNoopTransport(dsn: string): { client: Client; transport: NoopTransport };
```

`flush(timeoutMs)` waits for all in-flight transport sends. Returns `true` if all settled before the timeout, `false` otherwise. `close()` flushes then releases resources.

## Transport

```ts
interface Transport {
  send(envelope: Uint8Array): Promise<void>;
  flush(timeoutMs?: number): Promise<boolean>;
}
```

### `HttpTransport`

```ts
new HttpTransport(envelopeUrl: string, options?: { headers?: Record<string, string>; maxConcurrent?: number });
```

Concurrency-capped fetch posts to the envelope URL. Defaults: `maxConcurrent = 4`. Headers merged onto every request (use this to add `X-Sentry-Auth` if you bypass DSN auto-derivation).

### `NoopTransport`

In-memory, captures envelopes in `sent: Uint8Array[]`. Use in tests:

```ts
import { clientWithNoopTransport } from "@warden/sdk/client";
const { client, transport } = clientWithNoopTransport("http://x@localhost/1");
client.captureMessage("test");
console.log(transport.sent.length); // 1
```

## Event types

### `Event`

```ts
interface Event {
  event_id: string;                                  // 32 hex chars
  timestamp: string;                                 // ISO 8601
  platform?: string;                                 // 'javascript'
  level?: SentryLevel;
  message?: string;
  exception?: { values: readonly ExceptionValue[] };
  sdk?: { name: string; version: string };
  user?: User;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  release?: string;
  environment?: string;
  [key: string]: unknown;                            // forward-compatible
}
```

### `ExceptionValue`

```ts
interface ExceptionValue {
  type: string;
  value: string;
  stacktrace?: Stacktrace;
}
```

### `Stacktrace` and `Frame`

```ts
interface Stacktrace { frames: readonly Frame[]; }   // oldest → newest

interface Frame {
  function?: string;
  abs_path?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}
```

### `SentryLevel`

```ts
type SentryLevel = "fatal" | "error" | "warning" | "info" | "debug";
```

### Constants

```ts
const SDK_NAME = "sentry-replica.javascript";
const SDK_VERSION = "0.0.0";
```

## Helpers

```ts
function newEventId(): string;                       // UUID v4 with dashes removed
function nowIso(): string;                           // ISO 8601 UTC

function eventFromException(
  err: unknown,
  options?: CaptureOptions
): Event;

function eventFromMessage(
  message: string,
  options?: CaptureOptions
): Event;

function eventToItemPayload(event: Event): { payload: Uint8Array; type: "event" };
```

## Stack parsing

```ts
function parseStack(stackString: string): Frame[];
```

Recognises V8 / JavaScriptCore stack frames (`at funcName (path:line:col)`, `at path:line:col`, native frames) and returns oldest-first frames suitable for the Event's `exception.values[].stacktrace.frames`.

## Node integration

```ts
function installNodeErrorHandlers(): { uninstall(): void };
function uninstallNodeErrorHandlers(): void;
```

Registers `process.on("uncaughtException")` (level `fatal`) and `process.on("unhandledRejection")` (level `error`). Idempotent. No-op in non-Node runtimes (browsers, Workers).

Use it once after `init()`:

```ts
import { init, installNodeErrorHandlers } from "@warden/sdk";

init({ dsn: process.env.WARDEN_DSN! });
installNodeErrorHandlers();
```

## DSN parsing

`Client` consumes a DSN string and exposes the parsed result as `client.dsn`:

```ts
interface Dsn {
  scheme: "http" | "https";
  publicKey: string;
  secret: string | null;
  host: string;
  port: number | null;
  path: string;
  projectId: string;
  envelopeUrl: string;
  storeUrl: string;
}
```

## Testing patterns

```ts
import { Hub, setCurrentHub, getCurrentHub, clientWithNoopTransport } from "@warden/sdk";

const { client, transport } = clientWithNoopTransport("http://x@localhost/1");
const hub = new Hub();
hub.bindClient(client);
setCurrentHub(hub);

import { captureMessage } from "@warden/sdk";
captureMessage("hi");

console.assert(transport.sent.length === 1);
```

## Limitations today

- No transaction/span API yet. The capture surface is errors and messages.
- No breadcrumbs API yet.
- Scope is process-wide singleton. `AsyncLocalStorage`-based per-task scope is on the roadmap.
- Browser-specific integrations (window.onerror, fetch instrumentation) are not yet bundled.
