import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ArrowUpRight,
  Cable,
  Check,
  ChevronRight,
  Clock3,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Square,
  Workflow,
  Zap,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import {
  environmentQuery,
  queryClient,
  runsQuery,
  storeQuery,
  activeQuery,
} from '@/lib/query';
import { desktop, invoke } from '@/lib/bridge';
import { useUI } from '@/lib/ui-store';
import { runBatch, stopBatch } from '@/lib/batch';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  type Environment,
  type Installed,
  isSender,
  isBatch,
  hasRecipientCategories,
  recipientSummary,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  BusyButton,
  EmptyState,
  ErrorMessage,
  PageTitle,
  Panel,
  Status,
  WorkflowGlyph,
} from '@/components/common';
import { WorkflowEditor } from '@/components/workflow-editor';
export const Route = createFileRoute('/')({
  loader: () =>
    Promise.all([
      queryClient.ensureQueryData(storeQuery),
      queryClient.ensureQueryData(environmentQuery),
    ]),
  component: Workspace,
});
function Workspace() {
  const reduceMotion = useReducedMotion();
  const store = useQuery(storeQuery);
  const environment = useQuery(environmentQuery);
  const history = useQuery(runsQuery);
  const active = useQuery(activeQuery);
  const ui = useUI();
  const busy = ui.running || Object.keys(active.data ?? {}).length > 0;
  const [editing, setEditing] = useState<Installed | null>(null);
  const installed = store.data?.installed ?? [];
  const selected = installed.find((i) => i.key === ui.workflow) ?? installed[0];
  const needsRecipientSetup =
    selected &&
    isBatch(selected.workflow) &&
    !hasRecipientCategories(selected.input);
  let runLabel = '开始运行';
  if (needsRecipientSetup) runLabel = '设置消息与接收类型';
  else if (selected && isSender(selected.workflow) && !selected.dryRun)
    runLabel = '开始正式运行';
  const devices = environment.data?.devices ?? [];
  const ready = devices.filter((d) => d.state === 'device');
  const selectedDevices = ready.filter((d) => ui.serials.includes(d.serial));
  const refresh = useMutation({
    mutationFn: async () => {
      const data = await invoke<Environment>(
        environment.data?.ready
          ? 'check_environment'
          : 'initialize_environment',
      );
      queryClient.setQueryData(['environment'], data);
    },
  });
  const run = useMutation({
    mutationFn: () => runBatch(selectedDevices, selected!.key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
  return (
    <>
      <PageTitle
        title="工作台"
        description="连接设备，选择工作流，让日常操作有条不紊。"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending || busy}
          >
            <RefreshCw
              className={cn('size-3.5', refresh.isPending && 'animate-spin')}
            />
            刷新设备
          </Button>
        }
      />
      <ErrorMessage
        error={store.error ?? environment.error ?? refresh.error ?? run.error}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_290px]">
        <div className="space-y-6">
          <section className="bg-card overflow-hidden rounded-xl border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
              <div className="flex items-center gap-2">
                <Workflow className="text-primary size-4" />
                <h2 className="font-semibold">我的工作流</h2>
                <span className="bg-secondary text-muted-foreground rounded px-1.5 text-xs">
                  {installed.length}
                </span>
              </div>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {installed.map((item) => {
                const active = selected?.key === item.key;
                return (
                  <motion.div
                    key={item.key}
                    whileHover={busy || reduceMotion ? undefined : { y: -3 }}
                    whileTap={
                      busy || reduceMotion ? undefined : { scale: 0.96 }
                    }
                    transition={{ type: 'spring', duration: 0.25, bounce: 0 }}
                    className={cn(
                      'group relative rounded-xl border transition-colors',
                      active
                        ? 'border-primary/60 bg-muted/40'
                        : 'bg-card hover:border-primary/30',
                    )}
                  >
                    <button
                      className="w-full rounded-xl p-4 text-left"
                      aria-pressed={active}
                      disabled={busy}
                      onClick={() => ui.selectWorkflow(item.key)}
                    >
                      <div className="flex items-start justify-between">
                        <WorkflowGlyph workflow={item.workflow} />
                        <span
                          className={cn(
                            'grid size-4 place-items-center rounded-full border',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border',
                          )}
                        >
                          {active && <Check className="size-2.5" />}
                        </span>
                      </div>
                      <h3 className="mt-4 mb-1 pr-6 text-sm font-semibold">
                        {item.workflow.name.replace('消息', '')}
                      </h3>
                      <p className="text-muted-foreground line-clamp-2 min-h-10 text-xs leading-5">
                        {item.workflow.description}
                      </p>
                      <div className="text-muted-foreground mt-4 flex items-center gap-2 text-xs">
                        <span>{item.workflow.steps.length} 个步骤</span>
                        <span className="bg-border size-0.5 rounded-full" />
                        <span>
                          {isSender(item.workflow)
                            ? item.dryRun
                              ? '预演模式'
                              : '正式发送'
                            : '只读操作'}
                        </span>
                      </div>
                    </button>
                    <button
                      aria-label={`配置 ${item.workflow.name}`}
                      className="text-muted-foreground hover:bg-muted hover:text-foreground absolute right-3 bottom-3 grid size-7 place-items-center rounded-md"
                      onClick={() => setEditing(item)}
                      disabled={busy}
                    >
                      <Settings2 className="size-3.5" />
                    </button>
                  </motion.div>
                );
              })}
            </div>
            {!installed.length && (
              <EmptyState
                icon={Workflow}
                title="还没有工作流"
                description="从工作流商店安装一个，开始你的第一轮自动化。"
                action={
                  <Button asChild variant="outline">
                    <Link to="/store">
                      打开工作流商店
                      <ArrowUpRight />
                    </Link>
                  </Button>
                }
              />
            )}
            <Link
              to="/store"
              className="text-muted-foreground hover:bg-muted/50 hover:text-primary flex items-center justify-center gap-1 border-t py-3 text-xs"
            >
              浏览更多工作流
              <ArrowUpRight className="size-3" />
            </Link>
          </section>
          <Panel
            title="最近的运行"
            action={
              <Link
                to="/history"
                className="text-muted-foreground hover:text-primary flex items-center gap-1 text-xs"
              >
                全部记录
                <ChevronRight className="size-3" />
              </Link>
            }
          >
            {history.data?.length ? (
              <div className="divide-y">
                {history.data.slice(0, 4).map((item) => (
                  <div
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                    key={item.id}
                  >
                    <div className="bg-secondary grid size-8 shrink-0 place-items-center rounded-lg">
                      <Clock3 className="text-muted-foreground size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.workflow_name}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {formatTime(item.timestamp)}
                      </p>
                    </div>
                    <Status value={item.status} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3 py-4">
                <Clock3
                  className="text-muted-foreground/40 size-8"
                  strokeWidth={1.25}
                />
                <div>
                  <p className="text-sm">运行记录将在这里出现</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    每次操作的状态与结果都会自动保存。
                  </p>
                </div>
              </div>
            )}
          </Panel>
        </div>
        <div className="space-y-5 lg:sticky lg:top-0">
          <Panel
            title="连接的设备"
            description="通过 USB 连接你的 Android 手机"
            action={
              <span className="bg-secondary text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                {ready.length} 台
              </span>
            }
          >
            {devices.length ? (
              <div className="space-y-3">
                {devices.map((device) => (
                  <label
                    key={device.serial}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3',
                      ui.serials.includes(device.serial)
                        ? 'border-primary/40 bg-muted/30'
                        : '',
                    )}
                  >
                    <Checkbox
                      checked={ui.serials.includes(device.serial)}
                      disabled={device.state !== 'device' || busy}
                      onCheckedChange={(checked) =>
                        ui.select(
                          checked
                            ? [...ui.serials, device.serial]
                            : ui.serials.filter((s) => s !== device.serial),
                        )
                      }
                    />
                    <Smartphone
                      className="text-muted-foreground size-5 shrink-0"
                      strokeWidth={1.4}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {device.model}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {device.state === 'device'
                          ? '已连接'
                          : device.state === 'unauthorized'
                            ? '请在手机上确认授权'
                            : device.state}
                      </p>
                    </div>
                    {device.state === 'device' && (
                      <span className="bg-success ml-auto size-1.5 rounded-full" />
                    )}
                  </label>
                ))}
              </div>
            ) : (
              <div className="py-7 text-center">
                <div className="relative mx-auto mb-5 grid h-24 w-20 place-items-center">
                  <div className="border-primary/10 bg-muted absolute inset-0 rotate-6 rounded-2xl border" />
                  <Smartphone
                    className="text-primary relative size-12"
                    strokeWidth={1}
                  />
                  <span className="bg-card text-primary absolute -right-2 bottom-0 grid size-8 place-items-center rounded-full border">
                    <Cable className="size-4" />
                  </span>
                </div>
                <p className="text-sm font-medium">等待你的第一台设备</p>
                <p className="text-muted-foreground mt-2 text-xs leading-5">
                  连接数据线并开启 USB 调试
                  <br />
                  在手机上允许此电脑连接
                </p>
              </div>
            )}
            {!environment.data?.ready && (
              <BusyButton
                variant="outline"
                className="mt-4 w-full"
                busy={refresh.isPending}
                disabled={!desktop}
                onClick={() => refresh.mutate()}
              >
                初始化连接组件
              </BusyButton>
            )}
          </Panel>
          <div className="bg-card rounded-xl border p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Zap className="text-primary size-4" />
              准备运行
            </div>
            <div className="space-y-3 text-xs">
              <p className="flex justify-between gap-4">
                <span className="text-muted-foreground shrink-0">工作流</span>
                <span className="text-right font-medium">
                  {selected?.workflow.name ?? '尚未选择'}
                </span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">接收设备</span>
                <span className="font-medium">{selectedDevices.length} 台</span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">执行方式</span>
                <span>原生无障碍</span>
              </p>
              {selected && isBatch(selected.workflow) && (
                <p className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">
                    接收类型
                  </span>
                  <span className="text-right">
                    {needsRecipientSetup
                      ? '请先设置全部单聊 / 全部群聊'
                      : recipientSummary(selected.input)}
                  </span>
                </p>
              )}
            </div>
            <div className="bg-border my-5 h-px" />
            {busy ? (
              <BusyButton
                className="w-full"
                variant="secondary"
                busy={ui.stopping}
                onClick={() => {
                  const stop = ui.running
                    ? stopBatch()
                    : invoke('cancel_device_tasks', {
                        serials: Object.keys(active.data ?? {}),
                      });
                  void stop.catch((e) => toast.error(String(e)));
                }}
              >
                <Square className="size-3" />
                停止任务
              </BusyButton>
            ) : (
              <Button
                className="h-10 w-full"
                disabled={!desktop || !selectedDevices.length || !selected}
                onClick={() =>
                  needsRecipientSetup ? setEditing(selected) : run.mutate()
                }
              >
                <Play className="size-3.5 fill-current" />
                {runLabel}
              </Button>
            )}
            <p className="text-muted-foreground mt-3 flex items-center justify-center gap-1.5 text-xs">
              <ShieldCheck className="size-3.5" />
              {selected?.dryRun
                ? '预演会核对并清理本轮草稿'
                : '已有草稿始终受到保护'}
            </p>
          </div>
          <Link
            to="/guide"
            className="text-muted-foreground hover:text-primary flex items-start gap-2 px-1 text-xs leading-5"
          >
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <span>
              第一次使用？先运行“打开企业微信”
              <br />
              检查连接和应用状态。
            </span>
          </Link>
        </div>
      </div>
      {!ui.running && Object.keys(active.data ?? {}).length > 0 && (
        <div className="mt-6">
          <Panel title="正在执行的设备任务">
            {Object.entries(active.data ?? {}).map(([serial, progress]) => (
              <p
                className="flex justify-between gap-4 py-2 text-sm"
                key={serial}
              >
                <span>
                  {devices.find((d) => d.serial === serial)?.model ?? serial}
                </span>
                <span className="text-muted-foreground">
                  {progress.message}
                </span>
              </p>
            ))}
          </Panel>
        </div>
      )}
      {ui.runs.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-6"
        >
          <Panel
            title={ui.running ? '任务正在执行' : '本轮运行结果'}
            action={
              <Link to="/results" className="text-primary text-xs">
                查看详情
              </Link>
            }
          >
            <div className="space-y-4">
              {ui.runs.map((run) => (
                <div key={run.serial} className="flex items-center gap-3">
                  <Smartphone className="text-muted-foreground size-4" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{run.model}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {run.error ?? run.progress?.message ?? '等待执行'}
                    </p>
                    {run.progress && run.status === 'running' && (
                      <div className="bg-secondary mt-2 h-1 overflow-hidden rounded-full">
                        <div
                          className="bg-primary h-full transition-[width]"
                          style={{
                            width: `${Math.min(100, (run.progress.step / Math.max(1, run.progress.total)) * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <Status value={run.status} />
                </div>
              ))}
            </div>
          </Panel>
        </motion.div>
      )}
      {editing && (
        <WorkflowEditor
          key={editing.key}
          item={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
