import { Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { useSettingsStore } from '../../stores/settings';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';

export function ConnectionSettings() {
    const { t } = useTranslation();

    const { currentProfile, settings } = useCurrentProfile();
    const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

    const handleSslToggle = (checked: boolean) => {
        if (!currentProfile) return;
        updateSettings(currentProfile.id, {
            allowSelfSignedCerts: checked,
        });
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Wifi className="h-5 w-5 text-primary" />
                    <CardTitle>{t('settings.connection_settings')}</CardTitle>
                </div>
                <CardDescription>
                    {t('settings.connection_settings_desc')}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-lg border bg-card">
                    <div className="flex-1 space-y-1">
                        <Label htmlFor="self-signed-certs" className="text-base font-semibold">
                            {t('settings.allow_self_signed_certs')}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            {t('settings.allow_self_signed_certs_desc')}
                        </p>
                        {settings.allowSelfSignedCerts && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-2 font-medium">
                                {t('settings.allow_self_signed_certs_warning')}
                            </p>
                        )}
                    </div>
                    <Switch
                        id="self-signed-certs"
                        checked={settings.allowSelfSignedCerts}
                        onCheckedChange={handleSslToggle}
                        data-testid="settings-self-signed-certs-switch"
                    />
                </div>
            </CardContent>
        </Card>
    );
}
