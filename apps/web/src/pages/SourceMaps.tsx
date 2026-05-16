import type { JSX } from 'react';
import { useState } from 'react';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Table, type TableColumn } from '../components/Table';
import { useApp } from '../state/AppContext';

interface SourceMap {
  readonly id: string;
  readonly filename: string;
  readonly release: string;
  readonly debugId: string;
  readonly size: number;
  readonly uploadedAt: string;
}

const SEED: readonly SourceMap[] = [
  {
    id: 'sm_001',
    filename: 'main.js.map',
    release: 'web@2.14.3',
    debugId: '0e9b1a47-9b3f-4f9a-9a47-12cf301a8b41',
    size: 524_288,
    uploadedAt: '2026-05-16T10:42:00Z',
  },
  {
    id: 'sm_002',
    filename: 'vendor.js.map',
    release: 'web@2.14.3',
    debugId: 'aa1b22c3-d4e5-6f70-89a0-1112233445b6',
    size: 1_843_200,
    uploadedAt: '2026-05-16T10:42:01Z',
  },
];

export function SourceMaps(): JSX.Element {
  const ctx = useApp();
  const [maps, setMaps] = useState<SourceMap[]>([...SEED]);
  const [release, setRelease] = useState('web@2.14.3');
  const [filename, setFilename] = useState('');
  const [verifyId, setVerifyId] = useState('');

  function upload(): void {
    if (!filename.trim()) {
      ctx.pushToast({ tone: 'warning', title: 'Filename required' });
      return;
    }
    const m: SourceMap = {
      id: `sm_${maps.length + 1}_${Date.now().toString(36).slice(-3)}`,
      filename: filename.trim(),
      release: release.trim(),
      debugId: crypto.randomUUID(),
      size: 256_000 + Math.floor(Math.random() * 2_000_000),
      uploadedAt: new Date().toISOString(),
    };
    setMaps([m, ...maps]);
    setFilename('');
    ctx.pushToast({ tone: 'success', title: `Uploaded ${m.filename}` });
  }

  function verify(): void {
    const v = verifyId.trim().toLowerCase();
    if (!v) {
      ctx.pushToast({ tone: 'warning', title: 'Enter a debug id' });
      return;
    }
    const hit = maps.find((m) => m.debugId.toLowerCase() === v);
    if (hit) {
      ctx.pushToast({ tone: 'success', title: `Match: ${hit.filename}`, body: hit.release });
    } else {
      ctx.pushToast({ tone: 'error', title: 'No source map matches that debug id' });
    }
  }

  function remove(id: string): void {
    setMaps(maps.filter((m) => m.id !== id));
    ctx.pushToast({ tone: 'info', title: 'Source map removed' });
  }

  const columns: readonly TableColumn<SourceMap>[] = [
    {
      key: 'file',
      header: 'File',
      render: (m) => (
        <div>
          <div className="font-medium">{m.filename}</div>
          <div className="mt-0.5 text-xs text-sr-muted font-mono">{m.debugId}</div>
        </div>
      ),
    },
    { key: 'release', header: 'Release', render: (m) => <Badge tone="accent">{m.release}</Badge>, width: '140px' },
    { key: 'size', header: 'Size', align: 'right', render: (m) => <span className="tabular-nums">{(m.size / 1024).toFixed(0)} KiB</span>, width: '100px' },
    { key: 'uploaded', header: 'Uploaded', align: 'right', render: (m) => <span className="text-xs text-sr-muted">{m.uploadedAt.replace('T', ' ').slice(0, 19)}</span>, width: '160px' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (m) => (
        <Button variant="ghost" onClick={() => remove(m.id)} data-testid={`remove-${m.id}`}>
          Remove
        </Button>
      ),
      width: '100px',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Source Maps</h1>
        <p className="mt-1 text-sm text-sr-muted">
          Upload source maps to symbolicate JavaScript stack traces. {maps.length} map(s) on file.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Upload source map">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span>Release</span>
              <input
                type="text"
                value={release}
                onChange={(e) => setRelease(e.target.value)}
                aria-label="upload release"
                data-testid="upload-release"
                className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 font-mono text-sm focus:border-sr-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Filename</span>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="bundle.js.map"
                aria-label="upload filename"
                data-testid="upload-filename"
                className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 font-mono text-sm focus:border-sr-accent focus:outline-none"
              />
            </label>
            <div
              data-testid="upload-dropzone"
              className="rounded border border-dashed border-sr-border/60 px-4 py-6 text-center text-xs text-sr-muted"
            >
              Drag &amp; drop a <code>.map</code> file here, or
              <Button variant="ghost" onClick={upload} data-testid="upload-go">
                use filename above
              </Button>
            </div>
            <Button variant="primary" onClick={upload} data-testid="upload-submit">
              Upload
            </Button>
          </div>
        </Card>

        <Card title="Verify debug id">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-sr-muted">
              Paste a debug id from a stack trace to check whether the matching source map is on file.
            </p>
            <input
              type="text"
              value={verifyId}
              onChange={(e) => setVerifyId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              aria-label="verify debug id"
              data-testid="verify-id"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 font-mono text-sm focus:border-sr-accent focus:outline-none"
            />
            <Button variant="primary" onClick={verify} data-testid="verify-submit">
              Verify
            </Button>
            <p className="text-xs text-sr-muted">
              Existing debug ids on file: <span className="font-mono">{maps.length}</span>
            </p>
          </div>
        </Card>
      </div>

      <Card title="Uploaded source maps">
        {maps.length === 0 ? (
          <EmptyState title="No source maps uploaded" body="Upload a .map file above to enable symbolication." testId="sourcemaps-empty" />
        ) : (
          <Table columns={columns} rows={maps} rowKey={(m) => m.id} />
        )}
      </Card>
    </div>
  );
}