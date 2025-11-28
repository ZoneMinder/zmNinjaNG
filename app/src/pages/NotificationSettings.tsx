import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../stores/notifications';
import { useProfileStore } from '../stores/profile';
import { getMonitors } from '../api/monitors';
import { useAuthStore } from '../stores/auth';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import {
  Bell,
  BellOff,
  Wifi,
  WifiOff,
  Server,
  Shield,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  History,
} from 'lucide-react';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import { getPushService } from '../services/pushNotifications';

export default function NotificationSettings() {
  const navigate = useNavigate();
  const currentProfile = useProfileStore((state) => state.currentProfile());
  const getDecryptedPassword = useProfileStore((state) => state.getDecryptedPassword);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const {
    settings,
    connectionState,
    isConnected,
    unreadCount,
    updateSettings,
    setMonitorFilter,
    connect,
    disconnect,
  } = useNotificationStore();

  // Fetch monitors
  const { data: monitorsData } = useQuery({
    queryKey: ['monitors', currentProfile?.id],
    queryFn: getMonitors,
    enabled: !!currentProfile && isAuthenticated,
  });

  const monitors = monitorsData?.monitors || [];

  const [isConnecting, setIsConnecting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Initialize push notifications on mobile
  useEffect(() => {
    if (Capacitor.isNativePlatform() && settings.enabled) {
      const pushService = getPushService();
      pushService.initialize().catch((error) => {
        console.error('Failed to initialize push notifications:', error);
      });
    }
  }, [settings.enabled]);

  const handleEnableToggle = async (enabled: boolean) => {
    updateSettings({ enabled });

    if (enabled) {
      // Auto-detect host from current profile if not set
      if (!settings.host && currentProfile) {
        try {
          const url = new URL(currentProfile.portalUrl);
          updateSettings({ host: url.hostname });
        } catch (error) {
          console.error('Failed to parse portal URL:', error);
        }
      }

      // Try to connect
      await handleConnect();
    } else {
      disconnect();
      toast.info('Notifications disabled');
    }
  };

  const handleConnect = async () => {
    if (!currentProfile) {
      toast.error('No profile selected');
      return;
    }

    if (!settings.host) {
      toast.error('Please enter notification server host');
      return;
    }

    if (!currentProfile.username || !currentProfile.password) {
      toast.error('Profile must have username and password for notifications');
      return;
    }

    setIsConnecting(true);

    try {
      // Get decrypted password
      const password = await getDecryptedPassword(currentProfile.id);
      if (!password) {
        throw new Error('Failed to get password');
      }

      await connect(currentProfile.username, password);
      toast.success('Connected to notification server');

      // Initialize push on mobile
      if (Capacitor.isNativePlatform()) {
        const pushService = getPushService();
        if (pushService.isReady()) {
          const token = pushService.getToken();
          const platform = Capacitor.getPlatform() as 'ios' | 'android';
          if (token) {
            await useNotificationStore.getState().registerPushToken(token, platform);
            toast.success('Registered for push notifications');
          }
        }
      }
    } catch (error) {
      console.error('Connection failed:', error);
      toast.error(`Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    toast.info('Disconnected from notification server');
  };

  const handleMonitorToggle = (monitorId: number, enabled: boolean) => {
    if (enabled) {
      setMonitorFilter(monitorId, true, 60); // Default 60 second interval
    } else {
      setMonitorFilter(monitorId, false);
    }
  };

  const handleIntervalChange = (monitorId: number, interval: number) => {
    const filter = settings.monitorFilters.find((f) => f.monitorId === monitorId);
    if (filter) {
      setMonitorFilter(monitorId, filter.enabled, interval);
    }
  };

  const getConnectionBadge = () => {
    switch (connectionState) {
      case 'connected':
        return (
          <Badge variant="default" className="gap-1.5">
            <CheckCircle className="h-3 w-3" />
            Connected
          </Badge>
        );
      case 'connecting':
      case 'authenticating':
        return (
          <Badge variant="secondary" className="gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            Connecting...
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive" className="gap-1.5">
            <XCircle className="h-3 w-3" />
            Error
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1.5">
            <WifiOff className="h-3 w-3" />
            Disconnected
          </Badge>
        );
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground mt-1">
            Configure real-time event notifications from your ZoneMinder server
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate('/notifications/history')}
          className="relative"
        >
          <History className="h-4 w-4 mr-2" />
          View History
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-2 -right-2 h-5 min-w-5 px-1 flex items-center justify-center text-xs"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </div>

      <div className="grid gap-6">
        {/* Enable/Disable */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {settings.enabled ? (
                  <Bell className="h-5 w-5 text-primary" />
                ) : (
                  <BellOff className="h-5 w-5 text-muted-foreground" />
                )}
                <CardTitle>Notification Status</CardTitle>
              </div>
              {getConnectionBadge()}
            </div>
            <CardDescription>
              Enable real-time notifications for alarm events from your monitors
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
              <div className="flex-1 space-y-1">
                <Label htmlFor="enable-notifications" className="text-base font-semibold">
                  Enable Notifications
                </Label>
                <p className="text-sm text-muted-foreground">
                  Receive real-time alerts when motion or events are detected
                </p>
              </div>
              <Switch
                id="enable-notifications"
                checked={settings.enabled}
                onCheckedChange={handleEnableToggle}
              />
            </div>

            {unreadCount > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <AlertCircle className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">
                  You have {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Server Configuration */}
        {settings.enabled && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-primary" />
                <CardTitle>Event Notification Server</CardTitle>
              </div>
              <CardDescription>
                Configure connection to ZoneMinder event notification server (zmeventnotification)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Host */}
              <div className="space-y-2">
                <Label htmlFor="host" className="text-base font-semibold">
                  Server Host
                </Label>
                <Input
                  id="host"
                  type="text"
                  placeholder="zm.example.com"
                  value={settings.host}
                  onChange={(e) => updateSettings({ host: e.target.value })}
                  disabled={isConnected}
                />
                <p className="text-xs text-muted-foreground">
                  Hostname or IP address of your ZoneMinder server
                </p>
              </div>

              {/* Advanced Settings */}
              <div className="space-y-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
                </Button>

                {showAdvanced && (
                  <div className="space-y-4 p-4 rounded-lg border bg-muted/50">
                    {/* Port */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="port">Port</Label>
                        <Input
                          id="port"
                          type="number"
                          value={settings.port}
                          onChange={(e) => updateSettings({ port: Number(e.target.value) })}
                          disabled={isConnected}
                        />
                        <p className="text-xs text-muted-foreground">Default: 9000</p>
                      </div>

                      {/* SSL */}
                      <div className="space-y-2">
                        <Label htmlFor="ssl" className="flex items-center gap-2">
                          <Shield className="h-4 w-4" />
                          Use SSL (wss://)
                        </Label>
                        <div className="flex items-center h-10">
                          <Switch
                            id="ssl"
                            checked={settings.ssl}
                            onCheckedChange={(checked) => updateSettings({ ssl: checked })}
                            disabled={isConnected}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Recommended for secure connections
                        </p>
                      </div>
                    </div>

                    {/* Toast and Sound Settings */}
                    <Separator />
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label htmlFor="show-toasts" className="text-sm">
                            Show Toast Notifications
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Display popup notifications
                          </p>
                        </div>
                        <Switch
                          id="show-toasts"
                          checked={settings.showToasts}
                          onCheckedChange={(checked) => updateSettings({ showToasts: checked })}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label htmlFor="play-sound" className="text-sm">
                            Play Sound
                          </Label>
                          <p className="text-xs text-muted-foreground">Sound alerts</p>
                        </div>
                        <Switch
                          id="play-sound"
                          checked={settings.playSound}
                          onCheckedChange={(checked) => updateSettings({ playSound: checked })}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Connection Button */}
              <div className="flex gap-2">
                {isConnected ? (
                  <>
                    <Button variant="outline" onClick={handleDisconnect} className="flex-1">
                      <WifiOff className="h-4 w-4 mr-2" />
                      Disconnect
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleConnect}
                      disabled={isConnecting}
                      className="flex-1"
                    >
                      {isConnecting ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Wifi className="h-4 w-4 mr-2" />
                      )}
                      Reconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={handleConnect}
                    disabled={isConnecting || !settings.host}
                    className="flex-1"
                  >
                    {isConnecting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Wifi className="h-4 w-4 mr-2" />
                    )}
                    Connect
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Monitor Filters */}
        {settings.enabled && monitors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Monitor Filters</CardTitle>
              <CardDescription>
                Choose which monitors send notifications and how often to check for events
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {monitors.map((monitor) => {
                const monitorData = monitor.Monitor;
                const filter = settings.monitorFilters.find(
                  (f) => f.monitorId === parseInt(monitorData.Id, 10)
                );
                const isEnabled = filter?.enabled || false;
                const interval = filter?.checkInterval || 60;

                return (
                  <div
                    key={monitorData.Id}
                    className="flex flex-col gap-3 p-4 rounded-lg border bg-card"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <Label
                          htmlFor={`monitor-${monitorData.Id}`}
                          className="text-base font-semibold"
                        >
                          {monitorData.Name}
                        </Label>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Monitor ID: {monitorData.Id} • Function: {monitorData.Function}
                        </p>
                      </div>
                      <Switch
                        id={`monitor-${monitorData.Id}`}
                        checked={isEnabled}
                        onCheckedChange={(checked) =>
                          handleMonitorToggle(parseInt(monitorData.Id, 10), checked)
                        }
                      />
                    </div>

                    {isEnabled && (
                      <div className="flex items-center gap-4 ml-6 pt-2 border-t">
                        <Label htmlFor={`interval-${monitorData.Id}`} className="text-sm">
                          Check Interval:
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id={`interval-${monitorData.Id}`}
                            type="number"
                            min="30"
                            max="3600"
                            step="30"
                            value={interval}
                            onChange={(e) =>
                              handleIntervalChange(
                                parseInt(monitorData.Id, 10),
                                Number(e.target.value)
                              )
                            }
                            className="w-24"
                          />
                          <span className="text-sm text-muted-foreground">seconds</span>
                          <div className="flex gap-1 ml-auto">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleIntervalChange(parseInt(monitorData.Id, 10), 30)
                              }
                            >
                              30s
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleIntervalChange(parseInt(monitorData.Id, 10), 60)
                              }
                            >
                              60s
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                handleIntervalChange(parseInt(monitorData.Id, 10), 120)
                              }
                            >
                              2m
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {monitors.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No monitors available. Add monitors in ZoneMinder first.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Platform Info */}
        {Capacitor.isNativePlatform() && settings.enabled && (
          <Card>
            <CardHeader>
              <CardTitle>Mobile Platform</CardTitle>
              <CardDescription>
                Push notifications are enabled for background delivery
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <CheckCircle className="h-4 w-4 text-primary" />
                <span className="text-sm">
                  Running on {Capacitor.getPlatform()} - FCM push notifications active
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
