/**
 * Events page furniture extracted to keep that file's line count in check
 * (C2): per-profile error strips (Monitors page semantics - a strip only
 * for a profile that produced zero events; mode-agnostic, single mode just
 * ever has 0-1 entries) and the All-mode-only server filter chip row (ALL
 * settings bucket `eventsServerFilter`), hidden with fewer than 2 profiles.
 */

import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { ErrorBanner } from '../ui/query-state';
import { resolveQueryError } from '../../lib/query/query-error';
import { cn } from '../../lib/utils';
import type { ProfileError } from '../../api/scoped-types';
import type { Profile, ProfileId } from '../../api/types';

interface EventsAllModeBarProps {
  profiles: Profile[];
  /** Errors for profiles that produced zero events - the rest render normally. */
  visibleErrors: ProfileError[];
  onRetryProfile: (id: ProfileId) => void;
  /** null = every profile included (default). */
  serverFilter: ProfileId[] | null;
  onServerFilterChange: (next: ProfileId[] | null) => void;
}

export function EventsAllModeBar({
  profiles,
  visibleErrors,
  onRetryProfile,
  serverFilter,
  onServerFilterChange,
}: EventsAllModeBarProps) {
  const { t } = useTranslation();

  const isIncluded = (id: ProfileId) => serverFilter === null || serverFilter.includes(id);

  const toggleProfile = (id: ProfileId) => {
    // Starting from "every profile" (null), excluding one means "all except
    // this one" - expand to the explicit list first so toggling is additive
    // either way.
    const current = serverFilter ?? profiles.map((p) => p.id);
    const next = current.includes(id) ? current.filter((pid) => pid !== id) : [...current, id];
    // Back to null once every profile is selected again - keeps the stored
    // setting meaning "no filter" instead of an explicit full list that
    // silently goes stale when a new profile is added later.
    onServerFilterChange(next.length === profiles.length ? null : next);
  };

  return (
    <>
      {visibleErrors.length > 0 && (
        <div className="space-y-2">
          {visibleErrors.map((err) => (
            <div
              key={err.profileId}
              className="flex items-center gap-2"
              data-testid={`profile-error-strip-${err.profileId}`}
            >
              <ErrorBanner
                className="flex-1"
                message={`${err.profileName}: ${resolveQueryError(err.error, t, { fallbackKey: 'events.failed_to_load' })}`}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRetryProfile(err.profileId)}
                data-testid={`profile-error-strip-retry-${err.profileId}`}
              >
                {t('common.retry')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {profiles.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="events-server-filter-row">
          <span className="text-xs text-muted-foreground shrink-0">{t('events.filter_by_server')}:</span>
          {profiles.map((p) => {
            const included = isIncluded(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleProfile(p.id)}
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full border truncate max-w-[120px]',
                  included
                    ? 'bg-primary/10 border-primary/40 text-foreground'
                    : 'bg-muted/40 border-border text-muted-foreground'
                )}
                title={p.name}
                aria-pressed={included}
                data-testid={`events-server-filter-${p.id}`}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
