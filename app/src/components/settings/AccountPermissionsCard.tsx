/**
 * What this ZoneMinder account may do, in one place.
 *
 * The rest of the app explains a refusal where it happens - a greyed button,
 * a read-only dialog - and deliberately keeps those to one short sentence
 * each. This is where the whole picture lives, so those sentences do not have
 * to grow into a lecture, and so a hidden nav entry has somewhere to be
 * accounted for (refs #344).
 *
 * "Not determined" is a real answer, not a failure: ZoneMinder only lets an
 * account read its own permissions at System View or above, so an account with
 * less than that can be told what the app knows, which is that it has no
 * system access and nothing more.
 */

import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { ShieldCheck } from 'lucide-react';
import type { ProfileId } from '../../api/types';
import { usePermissions } from '../../hooks/usePermissions';
import type { ZmPermissionLevel, ZmPermissions } from '../../lib/permissions/zm-permissions';

interface AccountPermissionsCardProps {
  profileId: ProfileId | null | undefined;
}

/** The columns worth showing, in the order a ZoneMinder admin screen lists them. */
const COLUMNS: Array<{ key: keyof ZmPermissions; labelKey: string }> = [
  { key: 'system', labelKey: 'server.permission_system' },
  { key: 'monitors', labelKey: 'server.permission_monitors' },
  { key: 'stream', labelKey: 'server.permission_stream' },
  { key: 'events', labelKey: 'server.permission_events' },
  { key: 'control', labelKey: 'server.permission_control' },
  { key: 'groups', labelKey: 'server.permission_groups' },
];

/** `None` is the one level worth calling out; the rest are unremarkable. */
function levelVariant(level: ZmPermissionLevel | undefined) {
  if (level === undefined) return 'outline' as const;
  return level === 'None' ? 'outline' as const : 'secondary' as const;
}

export function AccountPermissionsCard({ profileId }: AccountPermissionsCardProps) {
  const { t } = useTranslation();
  const { permissions, isLoading } = usePermissions(profileId);

  if (isLoading || !permissions) return null;

  return (
    <Card data-testid="account-permissions-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          <CardTitle>{t('server.permissions_title')}</CardTitle>
        </div>
        <CardDescription>{t('server.permissions_desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {COLUMNS.map(({ key, labelKey }) => {
            const level = permissions[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-2 border-b border-border/40 py-1.5 last:border-0"
                data-testid={`account-permission-${key}`}
              >
                <span className="min-w-0 truncate text-sm text-muted-foreground" title={t(labelKey)}>
                  {t(labelKey)}
                </span>
                <Badge variant={levelVariant(level)} className="whitespace-nowrap">
                  {level ?? t('server.permission_unknown')}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
