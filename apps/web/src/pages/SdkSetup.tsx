import type { JSX } from 'react';
import { useState } from 'react';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useApp } from '../state/AppContext';

type Platform = 'javascript' | 'python' | 'rust' | 'go' | 'swift';

const SNIPPETS: Readonly<Record<Platform, { readonly install: string; readonly init: string }>> = {
  javascript: {
    install: 'bun add @sr/sdk-javascript',
    init: `import * as SR from '@sr/sdk-javascript';

SR.init({ dsn: '<your-dsn>' });

SR.captureMessage('hello from web');`,
  },
  python: {
    install: 'pip install sentry-replica',
    init: `import sentry_replica

sentry_replica.init(dsn="<your-dsn>")
sentry_replica.capture_message("hello from worker")`,
  },
  rust: {
    install: 'cargo add sentry-replica-core',
    init: `use sentry_replica_core::{init, capture_message, ClientOptions};

fn main() {
    let _ = init(ClientOptions {
        dsn: "<your-dsn>".into(),
        ..Default::default()
    }).expect("init");
    capture_message("hello from rust", None);
}`,
  },
  go: {
    install: 'go get github.com/igentai/sentry-replica/sdks/go',
    init: `package main

import sr "github.com/igentai/sentry-replica/sdks/go"

func main() {
    if err := sr.Init(sr.ClientOptions{DSN: "<your-dsn>"}); err != nil {
        panic(err)
    }
    sr.CaptureMessage("hello from go", "info")
}`,
  },
  swift: {
    install: 'swift package add sentry-replica',
    init: `import SentryReplica

try SentryReplica.initialize(
    options: ClientOptions(dsn: "<your-dsn>")
)
SentryReplica.captureMessage("hello from ios", level: .info)`,
  },
};

const STEPS = ['Platform', 'Install', 'DSN', 'Verify'] as const;

export function SdkSetup(): JSX.Element {
  const ctx = useApp();
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<Platform>('javascript');
  const [dsn, setDsn] = useState('https://abc123@sentry-replica.example.com/1');
  const [testSent, setTestSent] = useState(false);

  function next(): void {
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }
  function prev(): void {
    setStep((s) => Math.max(0, s - 1));
  }

  function sendTest(): void {
    setTestSent(true);
    ctx.pushToast({ tone: 'success', title: 'Test event sent', body: 'It should appear in your issues feed within a few seconds.' });
  }

  const snippet = SNIPPETS[platform];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">SDK setup</h1>
        <p className="mt-1 text-sm text-sr-muted">Send your first event in under five minutes.</p>
      </header>

      <Card>
        <ol className="flex items-center gap-3 border-b border-sr-border/60 pb-3 text-xs">
          {STEPS.map((label, i) => {
            const active = i === step;
            const done = i < step;
            return (
              <li key={label} className="flex items-center gap-2" data-testid={`step-${i}`}>
                <span
                  className={[
                    'flex h-6 w-6 items-center justify-center rounded-full border text-xs',
                    active
                      ? 'border-sr-accent bg-sr-accent text-white'
                      : done
                      ? 'border-sr-success bg-sr-success/20 text-sr-success'
                      : 'border-sr-border text-sr-muted',
                  ].join(' ')}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span className={active ? 'text-sr-fg' : 'text-sr-muted'}>{label}</span>
                {i < STEPS.length - 1 && <span className="mx-1 text-sr-muted">›</span>}
              </li>
            );
          })}
        </ol>

        <div className="mt-4 min-h-[220px]">
          {step === 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm">Pick your platform:</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(Object.keys(SNIPPETS) as Platform[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    aria-pressed={platform === p}
                    data-testid={`platform-${p}`}
                    className={[
                      'rounded border px-3 py-3 text-sm transition-colors',
                      platform === p
                        ? 'border-sr-accent bg-sr-accent/15 text-sr-fg'
                        : 'border-sr-border bg-sr-bg text-sr-muted hover:text-sr-fg',
                    ].join(' ')}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm">Install the SDK for <Badge tone="accent">{platform}</Badge>:</p>
              <pre className="overflow-x-auto rounded bg-sr-bg p-3 font-mono text-xs">{snippet.install}</pre>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm">Paste the DSN for your project:</p>
              <input
                type="text"
                value={dsn}
                onChange={(e) => setDsn(e.target.value)}
                aria-label="setup dsn"
                data-testid="setup-dsn"
                className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 font-mono text-sm focus:border-sr-accent focus:outline-none"
              />
              <p className="text-sm">Then add the initialiser snippet:</p>
              <pre className="overflow-x-auto rounded bg-sr-bg p-3 font-mono text-xs">
                {snippet.init.replace('<your-dsn>', dsn || '<your-dsn>')}
              </pre>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm">Send a test event to confirm everything's wired up:</p>
              <div className="flex items-center gap-3">
                <Button variant="primary" onClick={sendTest} data-testid="send-test">
                  Send test event
                </Button>
                {testSent && (
                  <span
                    data-testid="test-confirmed"
                    className="inline-flex items-center gap-1 rounded-md bg-sr-success/15 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-sr-success"
                  >
                    Test event received
                  </span>
                )}
              </div>
              {testSent && (
                <p className="text-xs text-sr-muted">
                  Open <a className="text-sr-accent hover:underline" href="/issues">/issues</a> to see it.
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-sr-border/60 pt-3">
          <Button variant="ghost" onClick={prev} disabled={step === 0} data-testid="wizard-prev">
            ← Back
          </Button>
          <span className="text-xs text-sr-muted">Step {step + 1} of {STEPS.length}</span>
          <Button
            variant="primary"
            onClick={step === STEPS.length - 1 ? sendTest : next}
            disabled={step === STEPS.length - 1 && testSent}
            data-testid="wizard-next"
          >
            {step === STEPS.length - 1 ? (testSent ? 'Done' : 'Send test') : 'Next →'}
          </Button>
        </footer>
      </Card>
    </div>
  );
}