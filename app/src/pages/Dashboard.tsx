/**
 * Dashboard Page Component
 *
 * Main dashboard page that displays customizable widgets for monitoring
 * cameras and events. Supports:
 * - Profile-specific dashboards
 * - Multiple widget types (monitor, events, timeline)
 * - Drag-and-drop layout customization
 * - Edit mode for widget management
 */

import { LayoutDashboard, Pencil, Check, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { DashboardLayout } from '../components/dashboard/DashboardLayout';
import { DashboardConfig } from '../components/dashboard/DashboardConfig';
import { useDashboardStore } from '../stores/dashboard';
import { useProfileStore } from '../stores/profile';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export default function Dashboard() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const isEditing = useDashboardStore((state) => state.isEditing);
    const toggleEditMode = useDashboardStore((state) => state.toggleEditMode);
    const currentProfile = useProfileStore(
        useShallow((state) => {
            const { profiles, currentProfileId } = state;
            return profiles.find((p) => p.id === currentProfileId) || null;
        })
    );
    const profileId = currentProfile?.id || 'default';
    const widgets = useDashboardStore(
        useShallow((state) => state.widgets[profileId] ?? [])
    );

    const handleRefresh = async () => {
        setIsRefreshing(true);
        // Invalidate all queries to refresh dashboard widgets
        await queryClient.invalidateQueries();
        setTimeout(() => setIsRefreshing(false), 500);
    };

    return (
        <div className="flex flex-col h-full bg-background">
            <div className="flex items-center justify-between p-4 border-b">
                <div className="flex items-center gap-2">
                    <LayoutDashboard className="h-5 w-5 sm:h-6 sm:w-6" />
                    <h1 className="text-lg sm:text-2xl font-bold">{t('dashboard.title')}</h1>
                </div>
                <div className="flex items-center gap-2">
                    {widgets.length > 0 && (
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleRefresh}
                                disabled={isRefreshing}
                                title={t('common.refresh')}
                            >
                                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                            </Button>
                            <Button
                                variant={isEditing ? "default" : "outline"}
                                size="sm"
                                onClick={toggleEditMode}
                                className={isEditing ? "bg-green-600 hover:bg-green-700" : ""}
                                title={isEditing ? t('dashboard.done') : t('dashboard.edit_layout')}
                            >
                                {isEditing ? (
                                    <>
                                        <Check className="sm:mr-2 h-4 w-4" />
                                        <span className="hidden sm:inline">{t('dashboard.done')}</span>
                                    </>
                                ) : (
                                    <>
                                        <Pencil className="sm:mr-2 h-4 w-4" />
                                        <span className="hidden sm:inline">{t('dashboard.edit_layout')}</span>
                                    </>
                                )}
                            </Button>
                        </>
                    )}
                    <DashboardConfig />
                </div>
            </div>

            <div className="flex-1 overflow-auto bg-muted/10 w-full">
                <DashboardLayout />
            </div>
        </div>
    );
}
