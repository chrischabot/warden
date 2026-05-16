import type { JSX } from 'react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Modal } from '../components/Modal';
import { Tabs } from '../components/Tabs';
import { Checkbox } from '../components/Checkbox';
import { useApp } from '../state/AppContext';

interface ClientKey {
  readonly id: string;
  readonly label: string;
  readonly dsn: string;
  readonly active: boolean;
  readonly createdAt: string;
}

const SEED_KEYS: readonly ClientKey[] = [
  {
    id: 'k1',
    label: 'Default',
    dsn: 'https://abc123def456@sentry-replica.example.com/1',
    active: true,
    createdAt: '2026-01-10T08:00:00Z',
  },
];

export function ProjectSettings(): JSX.Element {
  const ctx = useApp();
  const params = useParams<{ slug?: string }>();
  const slug = params.slug ?? 'web';
  const [tab, setTab] = useState<'general' | 'keys' | 'scrubbing' | 'limits'>('general');
  const [name, setName] = useState(slug);
  const [platform, setPlatform] = useState('javascript');
  const [keys, setKeys] = useState<ClientKey[]>([...SEED_KEYS]);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState<string | null>(null);
  const [scrubBuiltIns, setScrubBuiltIns] = useState(true);
  const [scrubKeys, setScrubKeys] = useState('email,phone,credit_card,ssn');
  const [rateCapacity, setRateCapacity] = useState(10000);
  const [rateRefill, setRateRefill] = useState(1000);

  function saveGeneral(): void {
    ctx.pushToast({ tone: 'success', title: 'Project saved', body: `Renamed to "${name}"` });
  }
  function saveScrubbing(): void {
    ctx.pushToast({ tone: 'success', title: 'PII rules saved' });
  }
  function saveLimits(): void {
    ctx.pushToast({
      tone: 'success',
      title: 'Rate limits updated',
      body: `${rateCapacity.toLocaleString()} burst, ${rateRefill.toLocaleString()}/sec`,
    });
  }
  function rotateKey(id: string): void {
    setKeys(
      keys.map((k) =>
        k.id === id
          ? {
              ...k,
              dsn: `https://${Math.random().toString(36).slice(2, 16)}@sentry-replica.example.com/1`,
              createdAt: new Date().toISOString(),
            }
          : k,
      ),
    );
    setRotateOpen(null);
    ctx.pushToast({ tone: 'success', title: 'Key rotated' });
  }
  function newKey(): void {
    const k: ClientKey = {
      id: `k${keys.length + 1}_${Date.now().toString(36).slice(-3)}`,
      label: 'New key',
      dsn: `https://${Math.random().toString(36).slice(2, 16)}@sentry-replica.example.com/1`,
      active: true,
      createdAt: new Date().toISOString(),
    };
    setKeys([...keys, k]);
    ctx.pushToast({ tone: 'success', title: 'Created new client key' });
  }
  function copyDsn(dsn: string): void {
    if (typeof navigator !== 'undefined' && 'clipboard' in navigator) {
      Promise.resolve(navigator.clipboard.writeText(dsn)).catch(() => {});
    }
    ctx.pushToast({ tone: 'info', title: 'DSN copied to clipboard' });
  }
  function toggleKeyActive(id: string): void {
    setKeys(keys.map((k) => (k.id === id ? { ...k, active: !k.active } : k)));
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="flex items-center gap-2 text-xs text-sr-muted">
          <span>Settings</span>
          <span>·</span>
          <span>Projects</span>
          <span>·</span>
          <Badge tone="accent">{slug}</Badge>
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Project: {slug}</h1>
      </header>

      <Tabs
        items={[
          { id: 'general', label: 'General' },
          { id: 'keys', label: 'Client Keys' },
          { id: 'scrubbing', label: 'Data Scrubbing' },
          { id: 'limits', label: 'Rate Limits' },
        ]}
        activeId={tab}
        onChange={(id) => setTab(id as typeof tab)}
        ariaLabel="project settings tabs"
      />

      {tab === 'general' && (
        <Card title="General">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span>Project name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="project name"
                className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Platform</span>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                aria-label="project platform"
                className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
              >
                <option>javascript</option>
                <option>python</option>
                <option>rust</option>
                <option>go</option>
                <option>swift</option>
                <option>node</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={saveGeneral} data-testid="save-general">
              Save changes
            </Button>
          </div>
        </Card>
      )}

      {tab === 'keys' && (
        <Card
          title="Client Keys (DSNs)"
          action={
            <Button variant="primary" onClick={newKey} data-testid="new-key">
              + New key
            </Button>
          }
        >
          <ul className="flex flex-col gap-2">
            {keys.map((k) => (
              <li key={k.id} className="rounded border border-sr-border/70 bg-sr-bg/40 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={k.active ? 'success' : 'neutral'}>{k.active ? 'active' : 'disabled'}</Badge>
                    <span className="font-medium">{k.label}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" onClick={() => toggleKeyActive(k.id)} data-testid={`toggle-key-${k.id}`}>
                      {k.active ? 'Disable' : 'Enable'}
                    </Button>
                    <Button variant="ghost" onClick={() => setRotateOpen(k.id)} data-testid={`rotate-key-${k.id}`}>
                      Rotate
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setRevealed(revealed === k.id ? null : k.id)}
                      data-testid={`reveal-key-${k.id}`}
                    >
                      {revealed === k.id ? 'Hide' : 'Reveal'}
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-sr-bg px-2 py-1 font-mono text-xs">
                    {revealed === k.id ? k.dsn : maskDsn(k.dsn)}
                  </code>
                  <Button variant="secondary" onClick={() => copyDsn(k.dsn)} data-testid={`copy-key-${k.id}`}>
                    Copy
                  </Button>
                </div>
                <p className="mt-1 text-xs text-sr-muted">Created {new Date(k.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'scrubbing' && (
        <Card title="Data Scrubbing">
          <Checkbox
            checked={scrubBuiltIns}
            onChange={(e) => setScrubBuiltIns(e.target.checked)}
            aria-label="scrub built-in patterns"
            label="Enable built-in PII pattern scrubbing (email, phone, CC, SSN, JWT, …)"
          />
          <label className="mt-4 flex flex-col gap-1 text-sm">
            <span>Custom scrub keys (comma-separated)</span>
            <input
              type="text"
              value={scrubKeys}
              onChange={(e) => setScrubKeys(e.target.value)}
              aria-label="scrub keys"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 font-mono text-sm focus:border-sr-accent focus:outline-none"
            />
          </label>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={saveScrubbing} data-testid="save-scrubbing">
              Save PII rules
            </Button>
          </div>
        </Card>
      )}

      {tab === 'limits' && (
        <Card title="Ingestion Rate Limits">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span>Burst capacity (events)</span>
              <input
                type="number"
                value={rateCapacity}
                onChange={(e) => setRateCapacity(Number.parseInt(e.target.value, 10) || 0)}
                aria-label="rate capacity"
                className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Refill (events / sec)</span>
              <input
                type="number"
                value={rateRefill}
                onChange={(e) => setRateRefill(Number.parseInt(e.target.value, 10) || 0)}
                aria-label="rate refill"
                className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-sr-muted">
            Spec §3.1 leaky-bucket. Excess events return 429 + `rate_limited` outcome.
          </p>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={saveLimits} data-testid="save-limits">
              Save limits
            </Button>
          </div>
        </Card>
      )}

      <Modal
        open={rotateOpen !== null}
        onClose={() => setRotateOpen(null)}
        title="Rotate client key?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRotateOpen(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => rotateOpen && rotateKey(rotateOpen)}
              data-testid="rotate-key-confirm"
            >
              Rotate
            </Button>
          </>
        }
      >
        <p className="text-sm">
          The existing DSN will keep working until you re-deploy with the new value. Are you sure?
        </p>
      </Modal>
    </div>
  );
}

function maskDsn(dsn: string): string {
  // Replace the secret between `://` and `@` with stars.
  return dsn.replace(/(:\/\/)([^@]+)(@)/, (_m, p1, p2: string, p3) => `${p1}${'•'.repeat(Math.min(p2.length, 16))}${p3}`);
}