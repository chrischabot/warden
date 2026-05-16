import type { JSX } from 'react';

const TONES: readonly string[] = [
  'bg-sr-accent/20 text-sr-accent',
  'bg-sr-success/20 text-sr-success',
  'bg-sr-warning/20 text-sr-warning',
  'bg-sr-error/20 text-sr-error',
  'bg-white/10 text-sr-fg',
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

export interface AvatarProps {
  readonly name: string;
  readonly size?: 'xs' | 'sm' | 'md';
}

const SIZE: Readonly<Record<NonNullable<AvatarProps['size']>, string>> = {
  xs: 'h-5 w-5 text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
};

export function Avatar({ name, size = 'sm' }: AvatarProps): JSX.Element {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('') || '?';
  const tone = TONES[hashName(name) % TONES.length] as string;
  return (
    <span
      aria-label={name}
      className={['inline-flex items-center justify-center rounded-full font-medium uppercase', SIZE[size], tone].join(' ')}
    >
      {initials}
    </span>
  );
}

export interface AvatarGroupProps {
  readonly names: readonly string[];
  readonly max?: number;
  readonly size?: AvatarProps['size'];
}

export function AvatarGroup({ names, max = 4, size = 'sm' }: AvatarGroupProps): JSX.Element {
  const shown = names.slice(0, max);
  const overflow = names.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((n) => (
        <span key={n} className="ring-2 ring-sr-panel rounded-full">
          <Avatar name={n} size={size} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          aria-label={`+${overflow} more`}
          className={[
            'ring-2 ring-sr-panel rounded-full inline-flex items-center justify-center bg-white/10 text-sr-fg font-medium',
            SIZE[size],
          ].join(' ')}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}