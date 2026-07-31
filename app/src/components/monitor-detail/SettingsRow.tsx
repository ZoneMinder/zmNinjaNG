/**
 * Shared row layout for the monitor settings dialog: a label on the left and a
 * value or control on the right. Lives in its own module so both the dialog and
 * the app-preference rows can use it without importing each other.
 */

import { Pencil } from 'lucide-react';

export function SettingsRow({
  label,
  children,
  testId,
  editable,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
  /** Marks the row as writing back to ZoneMinder on Save (shows a pencil). */
  editable?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-b-0"
      data-testid={testId}
    >
      <span className="text-sm text-muted-foreground flex items-center gap-1">
        {label}
        {editable && <Pencil className="h-2 w-2 shrink-0 opacity-50" />}
      </span>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}
