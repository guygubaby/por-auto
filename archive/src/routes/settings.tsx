import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Check, Download, Monitor, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { motion, useReducedMotion } from 'motion/react';
import { useTheme } from '@/hooks/use-theme';
import { invoke, desktop } from '@/lib/bridge';
import { queryClient } from '@/lib/query';
import type { UpdateStatus } from '@/types';
import {
  PageTitle,
  Panel,
  ErrorMessage,
  BusyButton,
} from '@/components/common';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
export const Route = createFileRoute('/settings')({
  component: Settings,
});
function Settings() {
  const reduceMotion = useReducedMotion();
  const { theme, setTheme } = useTheme();
  return (
    <>
      <PageTitle title="设置" description="让工作空间更合你的习惯。" />
      <div className="max-w-3xl space-y-6">
        <Panel title="外观" description="选择喜欢的主题，或随系统自动切换。">
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                { value: 'light', label: '浅色', icon: Sun },
                { value: 'dark', label: '深色', icon: Moon },
                { value: 'system', label: '跟随系统', icon: Monitor },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <motion.button
                key={value}
                whileHover={reduceMotion ? undefined : { y: -2 }}
                whileTap={reduceMotion ? undefined : { scale: 0.96 }}
                transition={{ type: 'spring', duration: 0.25, bounce: 0 }}
                className={cn(
                  'hover:border-primary/50 rounded-xl border p-4 text-left transition-colors',
                  theme === value ? 'border-primary bg-muted/40' : '',
                )}
                aria-pressed={theme === value}
                onClick={() => {
                  void setTheme(value).catch((e) => toast.error(String(e)));
                }}
              >
                <div
                  className={cn(
                    'mb-4 flex h-16 overflow-hidden rounded-md border',
                    value === 'dark'
                      ? 'border-white/10 bg-stone-900'
                      : 'border-stone-200 bg-white',
                  )}
                >
                  <div
                    className={cn(
                      'w-1/4 border-r',
                      value === 'dark'
                        ? 'border-white/10 bg-stone-800'
                        : value === 'system'
                          ? 'border-stone-300 bg-stone-700'
                          : 'border-stone-200 bg-stone-100',
                    )}
                  />
                  <div className="flex-1 p-2">
                    <div
                      className={cn(
                        'mb-1 h-1 w-2/3 rounded',
                        value === 'dark' ? 'bg-stone-700' : 'bg-stone-200',
                      )}
                    />
                    <div
                      className={cn(
                        'h-5 rounded',
                        value === 'dark' ? 'bg-stone-800' : 'bg-stone-100',
                      )}
                    />
                  </div>
                </div>
                <span className="flex items-center gap-2 text-sm">
                  <Icon className="size-4" />
                  {label}
                  {theme === value && (
                    <Check className="text-primary ml-auto size-3.5" />
                  )}
                </span>
              </motion.button>
            ))}
          </div>
        </Panel>
        <Updater />
      </div>
    </>
  );
}
function Updater() {
  const status = useQuery({
    queryKey: ['update'],
    queryFn: () => invoke<UpdateStatus>('update_status'),
  });
  const change = useMutation({
    mutationFn: ({
      command,
      args,
    }: {
      command: string;
      args?: Record<string, unknown>;
    }) => invoke<UpdateStatus>(command, args),
    onSuccess: (r) => {
      if (r) queryClient.setQueryData(['update'], r);
    },
  });
  const s = status.data;
  return (
    <Panel
      title="关于 Por Auto"
      description={`当前版本 ${s?.currentVersion ?? '0.4.4'}`}
    >
      <div className="mb-5 flex items-center justify-between">
        <label htmlFor="auto-update" className="text-sm">
          自动检查更新
        </label>
        <Switch
          id="auto-update"
          checked={s?.autoCheck ?? true}
          disabled={!desktop || change.isPending}
          onCheckedChange={(enabled) =>
            change.mutate({
              command: 'set_auto_update_check',
              args: { enabled },
            })
          }
        />
      </div>
      <ErrorMessage error={change.error ?? s?.error} />
      {s?.phase === 'up_to_date' && (
        <p className="text-primary mb-4 text-sm">已是最新版本</p>
      )}
      {s?.version && <p className="mb-4 text-sm">可更新至 {s.version}</p>}
      <div className="flex justify-end gap-2">
        <BusyButton
          variant="outline"
          busy={change.isPending}
          disabled={!desktop}
          onClick={() => change.mutate({ command: 'check_for_updates' })}
        >
          检查更新
        </BusyButton>
        {s?.phase === 'available' && (
          <Button
            onClick={() => change.mutate({ command: 'install_app_update' })}
          >
            <Download />
            安装并重启
          </Button>
        )}
      </div>
    </Panel>
  );
}
