/**
 * The addresses behind a profile card, folded away until asked for.
 *
 * A server's portal, API, and streaming URLs are set once during setup and
 * then only matter when something is wrong, but they are long enough to wrap
 * over three lines and were pushing the name, the badges, and the switch
 * button apart on every card. A group card has the same problem in a different
 * shape: what a reader wants from it is which servers it aggregates.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface ServerUrlRow {
  /** What this address is: a URL kind on a server, a server name in a group. */
  label: string;
  url: string;
}

interface ServerUrlDisclosureProps {
  rows: ServerUrlRow[];
  /** Prefix for this instance's test ids; the toggle appends `-toggle`. */
  testId: string;
}

export function ServerUrlDisclosure({ rows, testId }: ServerUrlDisclosureProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // A group with no members, or a profile mid-setup, has nothing to fold.
  if (rows.length === 0) return null;

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="mt-1">
      <button
        type="button"
        // Profile and group cards both treat a click as "switch to this", so
        // the disclosure has to keep its click to itself.
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
        data-testid={`${testId}-toggle`}
      >
        <Chevron className="h-3 w-3" />
        {t('profiles.server_details')}
      </button>

      {open && (
        <div className="space-y-1 text-xs font-mono mt-1" data-testid={testId}>
          {rows.map((row) => (
            <p key={`${row.label}-${row.url}`} className="text-muted-foreground break-all">
              <span className="font-sans font-medium text-foreground">{row.label}:</span> {row.url}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
