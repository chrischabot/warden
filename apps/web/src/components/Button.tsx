import type { ButtonHTMLAttributes, JSX } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-sr-accent text-white hover:bg-sr-accent/90',
  secondary: 'border border-sr-border bg-sr-bg text-sr-fg hover:bg-white/5',
  ghost: 'text-sr-fg hover:bg-white/5',
  danger: 'bg-sr-error/20 text-sr-error hover:bg-sr-error/30',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
};

export function Button({
  variant = 'primary',
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type={rest.type ?? 'button'}
      className={[
        'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
