import { SelectControl } from '@/components/select-control';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import {
  CalendarClock,
  Plus,
  Play,
  Pencil,
  Trash2,
  Clock3,
  History,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  environmentQuery,
  queryClient,
  schedulesQuery,
  storeQuery,
} from '@/lib/query';
import { invoke, desktop } from '@/lib/bridge';
import { formatTime } from '@/lib/format';
import { snapshotChanged } from '@/lib/schedule';
import type { Schedule, ScheduleView } from '@/types';
import { hasRecipientCategories, isBatch, recipientSummary } from '@/types';
import {
  PageTitle,
  Panel,
  EmptyState,
  Status,
  FormField,
  ErrorMessage,
  BusyButton,
} from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
export const Route = createFileRoute('/schedules')({
  loader: () =>
    Promise.all([
      queryClient.ensureQueryData(schedulesQuery),
      queryClient.ensureQueryData(storeQuery),
    ]),
  component: Schedules,
});
const scheduleSchema = z.object({
  name: z.string().trim().min(1, '请输入任务名称').max(100),
  cron: z
    .string()
    .trim()
    .regex(/^\S+(?:\s+\S+){4}$/, 'Cron 须为标准五段表达式'),
  timezone: z.string().trim().min(1, '请输入时区'),
  enabled: z.boolean(),
  workflowKey: z.string().min(1, '请选择工作流'),
  serials: z.array(z.string().min(1)).min(1, '请选择至少一台手机'),
  updateWorkflow: z.boolean(),
});
type ScheduleForm = z.infer<typeof scheduleSchema>;
function Schedules() {
  const schedules = useQuery(schedulesQuery);
  const [editing, setEditing] = useState<Schedule | null | undefined>();
  const [removing, setRemoving] = useState<Schedule | null>(null);
  const change = useMutation({
    mutationFn: ({
      command,
      args,
    }: {
      command: string;
      args: Record<string, unknown>;
    }) => invoke<ScheduleView>(command, args),
    onSuccess: (r) => {
      queryClient.setQueryData(['schedules'], r);
      setRemoving(null);
    },
  });
  const tasks = schedules.data?.tasks ?? [];
  return (
    <>
      <PageTitle
        title="定时任务"
        description="在指定时间运行固定版本和配置，错过不补跑。"
        action={
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus />
            新建任务
          </Button>
        }
      />
      <ErrorMessage
        error={schedules.error ?? change.error ?? schedules.data?.error}
      />
      <Panel>
        {tasks.length ? (
          <div className="divide-y">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center gap-4 py-5 first:pt-0 last:pb-0"
              >
                <div className="bg-secondary text-primary grid size-10 place-items-center rounded-xl">
                  <CalendarClock className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold">{t.name}</h2>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t.snapshot.workflow.name} · {t.serials.length} 台设备 ·{' '}
                    {t.snapshot.dryRun ? '预演' : '正式执行'}
                    {isBatch(t.snapshot.workflow) &&
                      ` · ${recipientSummary(t.snapshot.input)}`}
                  </p>
                  <p className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
                    <Clock3 className="size-3" />
                    {t.enabled
                      ? `下次 ${formatTime(t.nextRunAt, t.timezone)}`
                      : '已暂停'}
                    <span className="ml-2">
                      {t.cron} · {t.timezone}
                    </span>
                  </p>
                  {t.lastStatus && (
                    <div className="mt-2 flex items-center gap-2">
                      <Status value={t.lastStatus} />
                      <span className="text-muted-foreground text-xs">
                        {t.lastMessage}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" asChild>
                    <Link
                      to="/history"
                      search={{ task: t.id }}
                      aria-label={`查看 ${t.name} 的记录`}
                    >
                      <History className="size-3.5" />
                    </Link>
                  </Button>
                  <Switch
                    aria-label={`启用 ${t.name}`}
                    checked={t.enabled}
                    disabled={
                      !desktop ||
                      change.isPending ||
                      schedules.data?.runningIds.includes(t.id)
                    }
                    onCheckedChange={(enabled) =>
                      change.mutate({
                        command: 'set_schedule_enabled',
                        args: { id: t.id, enabled },
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`立即运行 ${t.name}`}
                    disabled={
                      !desktop ||
                      change.isPending ||
                      schedules.data?.runningIds.includes(t.id)
                    }
                    onClick={() =>
                      change.mutate({
                        command: 'run_schedule_now',
                        args: { id: t.id },
                      })
                    }
                  >
                    <Play className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`编辑 ${t.name}`}
                    onClick={() => setEditing(t)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除 ${t.name}`}
                    onClick={() => setRemoving(t)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={CalendarClock}
            title="把日常任务交给时间"
            description="创建定时任务，固定工作流、设备和消息配置。运行时请保持电脑开启、手机连接且已解锁。"
            action={
              <Button variant="outline" onClick={() => setEditing(null)}>
                <Plus />
                创建第一个任务
              </Button>
            }
          />
        )}
      </Panel>
      {editing !== undefined && (
        <ScheduleEditor item={editing} onClose={() => setEditing(undefined)} />
      )}
      <Dialog
        open={!!removing}
        onOpenChange={(v) => {
          if (!v) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除定时任务？</DialogTitle>
            <DialogDescription>
              {removing?.name} 将被删除，已有运行记录保留。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <BusyButton
              variant="destructive"
              busy={change.isPending}
              onClick={() =>
                change.mutate({
                  command: 'delete_schedule',
                  args: { id: removing?.id },
                })
              }
            >
              删除任务
            </BusyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
function ScheduleEditor({
  item,
  onClose,
}: {
  item: Schedule | null;
  onClose: () => void;
}) {
  const store = useQuery(storeQuery);
  const environment = useQuery(environmentQuery);
  const form = useForm<ScheduleForm>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      name: item?.name ?? '',
      cron: item?.cron ?? '0 9 * * *',
      timezone: item?.timezone ?? 'Asia/Shanghai',
      enabled: item?.enabled ?? true,
      workflowKey: item?.snapshot.key ?? store.data?.installed[0]?.key ?? '',
      serials: item?.serials ?? [],
      updateWorkflow: false,
    },
  });
  const v = form.watch();
  const [times, setTimes] = useState<number[]>([]);
  const save = useMutation({
    mutationFn: (value: ScheduleForm) =>
      invoke<ScheduleView>('save_schedule', {
        input: { ...value, id: item?.id ?? null },
      }),
    onSuccess: (r) => {
      queryClient.setQueryData(['schedules'], r);
      toast.success('定时任务已保存');
      onClose();
    },
  });
  const preview = useMutation({
    mutationFn: () =>
      invoke<number[]>('preview_cron', { cron: v.cron, timezone: v.timezone }),
    onSuccess: setTimes,
  });
  const installed = store.data?.installed ?? [];
  const chosen = installed.find((i) => i.key === v.workflowKey);
  const needsRecipients =
    (!item || v.updateWorkflow) &&
    chosen &&
    isBatch(chosen.workflow) &&
    !hasRecipientCategories(chosen.input);
  const current = installed.find((i) => i.key === item?.snapshot.key);
  const changed = item && current && snapshotChanged(item.snapshot, current);
  const connected = environment.data?.devices ?? [];
  const choices = [
    ...connected,
    ...v.serials
      .filter((serial) => !connected.some((d) => d.serial === serial))
      .map((serial) => ({
        serial,
        model: '已保存的离线设备',
        state: 'offline',
      })),
  ];
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !save.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? '编辑定时任务' : '新建定时任务'}</DialogTitle>
          <DialogDescription>
            任务保存当前代码与配置快照，后续修改工作流不会自动影响它。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((value) => save.mutate(value))}
        >
          <ErrorMessage
            error={
              save.error ??
              preview.error ??
              Object.values(form.formState.errors)[0]?.message
            }
          />
          <FormField label="任务名称">
            <Input
              {...form.register('name', { required: true, maxLength: 100 })}
            />
          </FormField>
          <FormField label="工作流">
            <Controller
              control={form.control}
              name="workflowKey"
              render={({ field }) => (
                <SelectControl
                  label="工作流"
                  value={field.value}
                  name={field.name}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  onValueChange={field.onChange}
                  disabled={!!item && !v.updateWorkflow}
                  options={(item &&
                  !installed.some((i) => i.key === item.snapshot.key)
                    ? [item.snapshot, ...installed]
                    : installed
                  ).map((i) => ({
                    value: i.key,
                    label: `${i.workflow.name} · ${i.dryRun ? '预演' : '正式执行'}`,
                  }))}
                />
              )}
            />
          </FormField>
          {item && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={v.updateWorkflow}
                onCheckedChange={(value) =>
                  form.setValue('updateWorkflow', !!value)
                }
              />
              使用当前工作流配置更新快照
            </label>
          )}
          {changed && (
            <p className="text-muted-foreground text-xs">
              当前工作流已变化；不勾选更新快照时，继续使用任务原有版本和配置。
            </p>
          )}
          {needsRecipients && (
            <p role="alert" className="text-warning text-sm">
              请先在工作台配置消息并勾选全部单聊 /
              全部群聊，再创建或更新此任务快照。
            </p>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">运行设备</legend>
            {choices.map((d) => (
              <label key={d.serial} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={v.serials.includes(d.serial)}
                  onCheckedChange={(x) =>
                    form.setValue(
                      'serials',
                      x
                        ? [...v.serials, d.serial]
                        : v.serials.filter((s) => s !== d.serial),
                    )
                  }
                />
                {d.model}
                <span className="text-muted-foreground text-xs">
                  {d.serial}
                </span>
              </label>
            ))}
            {!choices.length && (
              <p className="text-muted-foreground text-xs">
                连接手机后可选择运行设备。
              </p>
            )}
          </fieldset>
          <FormField
            label="Cron 表达式"
            hint="五段：分 时 日 月 周。每天 9 点：0 9 * * *"
          >
            <Input
              {...form.register('cron', { required: true })}
              spellCheck={false}
            />
          </FormField>
          <FormField label="时区">
            <Input
              {...form.register('timezone', { required: true })}
              spellCheck={false}
            />
          </FormField>
          <BusyButton
            type="button"
            variant="outline"
            size="sm"
            busy={preview.isPending}
            disabled={!desktop}
            onClick={() => preview.mutate()}
          >
            预览下三次执行时间
          </BusyButton>
          {times.length > 0 && (
            <ul className="bg-secondary space-y-1 rounded-lg p-3 text-xs">
              {times.map((t) => (
                <li key={t}>{formatTime(t, v.timezone)}</li>
              ))}
            </ul>
          )}
          <label className="flex items-center justify-between text-sm">
            <span>启用任务</span>
            <Switch
              checked={v.enabled}
              onCheckedChange={(x) => form.setValue('enabled', x)}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <BusyButton
              type="submit"
              busy={save.isPending}
              disabled={!desktop || needsRecipients}
            >
              保存任务
            </BusyButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
