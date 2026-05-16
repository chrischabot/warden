import './setup';
import { describe, expect, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Table } from '../src/components/Table';

describe('Badge', () => {
  test('renders children', () => {
    render(<Badge tone="error">fatal</Badge>);
    expect(screen.getByText('fatal')).toBeDefined();
  });

  test('default tone class applied', () => {
    render(<Badge>x</Badge>);
    const el = screen.getByText('x');
    expect(el.className).toContain('text-sr-muted');
  });

  test('error tone class applied', () => {
    render(<Badge tone="error">x</Badge>);
    const el = screen.getByText('x');
    expect(el.className).toContain('text-sr-error');
  });
});

describe('Button', () => {
  test('renders label', () => {
    render(<Button>save</Button>);
    expect(screen.getByRole('button', { name: 'save' })).toBeDefined();
  });

  test('default type is button', () => {
    render(<Button>x</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  test('onClick fires', () => {
    let clicks = 0;
    render(
      <Button
        onClick={() => {
          clicks++;
        }}
      >
        click
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(clicks).toBe(1);
  });

  test('danger variant has destructive class', () => {
    render(<Button variant="danger">delete</Button>);
    const el = screen.getByRole('button');
    expect(el.className).toContain('text-sr-error');
  });

  test('disabled prevents click handler', () => {
    let clicks = 0;
    render(
      <Button disabled onClick={() => clicks++}>
        x
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(clicks).toBe(0);
  });
});

describe('Card', () => {
  test('renders title + body', () => {
    render(
      <Card title="hello">
        <p>world</p>
      </Card>,
    );
    expect(screen.getByText('hello')).toBeDefined();
    expect(screen.getByText('world')).toBeDefined();
  });

  test('renders without a title header', () => {
    render(
      <Card>
        <p>body-only</p>
      </Card>,
    );
    expect(screen.getByText('body-only')).toBeDefined();
  });
});

describe('Table', () => {
  interface Row {
    readonly id: string;
    readonly label: string;
    readonly value: number;
  }

  const rows: Row[] = [
    { id: 'a', label: 'one', value: 1 },
    { id: 'b', label: 'two', value: 2 },
  ];

  test('renders header + rows', () => {
    render(
      <Table<Row>
        columns={[
          { key: 'label', header: 'Label', render: (r) => r.label },
          { key: 'value', header: 'Value', align: 'right', render: (r) => r.value },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText('Label')).toBeDefined();
    expect(screen.getByText('Value')).toBeDefined();
    expect(screen.getByText('one')).toBeDefined();
    expect(screen.getByText('two')).toBeDefined();
  });

  test('empty rows shows the empty message', () => {
    render(
      <Table<Row>
        columns={[{ key: 'label', header: 'L', render: (r) => r.label }]}
        rows={[]}
        rowKey={(r) => r.id}
        emptyMessage="Nothing here yet."
      />,
    );
    expect(screen.getByText('Nothing here yet.')).toBeDefined();
  });

  test('onRowClick fires with the row', () => {
    let clicked: Row | undefined;
    render(
      <Table<Row>
        columns={[{ key: 'label', header: 'L', render: (r) => r.label }]}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => (clicked = r)}
      />,
    );
    fireEvent.click(screen.getByText('two'));
    expect(clicked?.id).toBe('b');
  });
});
