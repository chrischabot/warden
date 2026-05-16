import type { InputHTMLAttributes, JSX } from 'react';

export function Checkbox(
  props: InputHTMLAttributes<HTMLInputElement> & { readonly label?: string },
): JSX.Element {
  const { label, className, ...rest } = props;
  return (
    <label className="inline-flex select-none items-center gap-2 text-sm">
      <input
        type="checkbox"
        className={[
          'h-4 w-4 cursor-pointer rounded border border-sr-border bg-sr-bg text-sr-accent focus:ring-1 focus:ring-sr-accent',
          className ?? '',
        ].join(' ')}
        {...rest}
      />
      {label && <span>{label}</span>}
    </label>
  );
}