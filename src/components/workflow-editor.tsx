import { SelectControl } from '@/components/select-control';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  type Installed,
  type SendInput,
  type Hooks,
  type Store,
  editableInput,
  hasRecipientCategories,
  defaultRequest,
  isSender,
  isBatch,
  sendInputSchema,
  hooksSchema,
} from '@/types';
import { queryClient } from '@/lib/query';
import { invoke } from '@/lib/bridge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { Checkbox } from './ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog';
import { BusyButton, ErrorMessage, FormField } from './common';
import { HttpEditor } from './http-editor';
const configSchema = z.object({
  input: sendInputSchema,
  hooks: hooksSchema,
  dryRun: z.boolean(),
  executionMode: z.literal('native'),
  secrets: z.object({
    message: z.string(),
    before: z.string(),
    after: z.string(),
  }),
});
type ConfigForm = z.infer<typeof configSchema>;
export function WorkflowEditor({
  item,
  onClose,
}: {
  item: Installed;
  onClose: () => void;
}) {
  const batch = isBatch(item.workflow);
  const legacy = batch && !hasRecipientCategories(item.input);
  const form = useForm<ConfigForm>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      input: editableInput(item.input),
      hooks: {
        beforeRun: item.hooks?.beforeRun ?? null,
        afterRun: item.hooks?.afterRun ?? null,
      },
      dryRun: legacy ? true : (item.dryRun ?? isSender(item.workflow)),
      executionMode: 'native',
      secrets: { message: '', before: '', after: '' },
    },
  });
  const v = form.watch();
  const sender = isSender(item.workflow);
  const save = useMutation({
    mutationFn: async (value: ConfigForm) => {
      const input = batch ? value.input : null;
      const store = await invoke<Store>('configure_workflow', {
        key: item.key,
        input,
        hooks: value.hooks,
        dryRun: value.dryRun,
        executionMode: 'native',
        secrets: value.secrets,
      });
      queryClient.setQueryData(['store'], store);
    },
    onSuccess: () => {
      toast.success('配置已保存');
      onClose();
    },
  });
  const patch = (input: SendInput) =>
    form.setValue('input', input, { shouldDirty: true });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item.workflow.name}</DialogTitle>
          <DialogDescription>
            配置保存在本机，已有定时任务保留原快照。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-6"
          onSubmit={form.handleSubmit(
            (value) => save.mutate(value),
            (errors) => {
              const parsed = configSchema.safeParse(form.getValues());
              toast.error(
                parsed.error?.issues[0]?.message ??
                  Object.keys(errors).join('、'),
              );
            },
          )}
        >
          <ErrorMessage error={save.error} />
          {sender && (
            <div className="border-primary/20 bg-muted flex items-center gap-3 rounded-lg border p-4">
              <ShieldCheck className="text-primary size-5 shrink-0" />
              <div className="flex-1">
                <label htmlFor="dry-run" className="text-sm font-medium">
                  预演模式
                </label>
                <p className="text-muted-foreground mt-1 text-xs">
                  输入并回读后清理本轮草稿，保留已有文字。
                </p>
              </div>
              <Switch
                id="dry-run"
                checked={v.dryRun}
                onCheckedChange={(x) => form.setValue('dryRun', x)}
              />
            </div>
          )}
          {sender && !v.dryRun && (
            <p
              role="alert"
              className="border-warning/30 bg-warning/5 text-warning rounded-lg border p-3 text-sm"
            >
              正式运行会向所选会话发送消息，每个目标只尝试发送一次。
            </p>
          )}
          <div className="border-primary/20 bg-muted/30 flex gap-3 rounded-lg border p-4">
            <ShieldCheck className="text-primary size-5 shrink-0" />
            <div>
              <p className="text-sm font-medium">原生无障碍执行</p>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                直接读取企业微信的系统控件，不截图、不上传画面；控件不完整时安全停止。
              </p>
            </div>
          </div>
          {(['beforeRun', 'afterRun'] as const).map((key, index) => {
            const request = v.hooks[key];
            const secretKey = index === 0 ? 'before' : 'after';
            if (index === 1) return null;
            return (
              <section key={key} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">运行前请求</h3>
                  <Switch
                    aria-label="启用运行前请求"
                    checked={!!request}
                    onCheckedChange={(on) =>
                      form.setValue(
                        `hooks.${key}`,
                        on ? defaultRequest() : null,
                      )
                    }
                  />
                </div>
                {request && (
                  <HttpEditor
                    value={request}
                    onChange={(r) => form.setValue(`hooks.${key}`, r)}
                    secret={v.secrets[secretKey]}
                    onSecret={(s) => form.setValue(`secrets.${secretKey}`, s)}
                    ignore
                  />
                )}
              </section>
            );
          })}
          {batch && (
            <section className="space-y-4 border-t pt-5">
              <h3 className="text-sm font-semibold">消息与接收对象</h3>
              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-medium">接收类型</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      {
                        key: 'direct',
                        label: '全部单聊',
                        detail: '遍历消息列表中的全部单聊',
                      },
                      {
                        key: 'groups',
                        label: '全部群聊',
                        detail: '遍历群聊列表中的全部群',
                      },
                    ] as const
                  ).map(({ key, label, detail }) => (
                    <label
                      key={key}
                      className="bg-muted/30 flex cursor-pointer items-center gap-3 rounded-lg border p-4"
                    >
                      <Checkbox
                        checked={v.input.recipients[key]}
                        onCheckedChange={(checked) =>
                          patch({
                            ...v.input,
                            recipients: {
                              ...v.input.recipients,
                              [key]: checked === true,
                            },
                          })
                        }
                      />
                      <span>
                        <span className="block text-sm font-medium">
                          {label}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block text-xs">
                          {detail}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  可同时勾选；脚本直接遍历对应列表，逐个发送一轮。
                </p>
                {legacy && (
                  <p role="status" className="text-warning text-xs">
                    保存后使用新接收类型，默认开启预演；已有定时任务保留原快照。
                  </p>
                )}
              </fieldset>
              <FormField label="消息来源">
                <SelectControl
                  label="消息来源"
                  value={v.input.message.type}
                  options={[
                    { value: 'manual', label: '手动输入' },
                    { value: 'http', label: 'HTTP 接口' },
                    { value: 'before_run', label: '使用运行前请求的返回文字' },
                  ]}
                  onValueChange={(type) =>
                    patch({
                      ...v.input,
                      message:
                        type === 'manual'
                          ? { type: 'manual', text: '' }
                          : type === 'before_run'
                            ? { type: 'before_run' }
                            : {
                                type: 'http',
                                request: defaultRequest(),
                                refresh: 'recipient',
                              },
                    })
                  }
                />
              </FormField>
              {v.input.message.type === 'manual' && (
                <FormField label="消息内容">
                  <Textarea
                    rows={3}
                    value={v.input.message.text}
                    required
                    placeholder="输入本轮消息"
                    onChange={(e) =>
                      patch({
                        ...v.input,
                        message: { type: 'manual', text: e.target.value },
                      })
                    }
                  />
                </FormField>
              )}
              {v.input.message.type === 'http' && (
                <>
                  <HttpEditor
                    value={v.input.message.request}
                    onChange={(request) => {
                      if (v.input.message.type === 'http')
                        patch({
                          ...v.input,
                          message: { ...v.input.message, request },
                        });
                    }}
                    secret={v.secrets.message}
                    onSecret={(s) => form.setValue('secrets.message', s)}
                  />
                  <FormField label="获取频率">
                    <SelectControl
                      label="获取频率"
                      value={v.input.message.refresh}
                      options={[
                        {
                          value: 'recipient',
                          label: '进入每个会话后获取最新内容',
                        },
                        { value: 'run', label: '每轮获取一次' },
                      ]}
                      onValueChange={(refresh) => {
                        if (v.input.message.type === 'http')
                          patch({
                            ...v.input,
                            message: {
                              ...v.input.message,
                              refresh: refresh as 'run' | 'recipient',
                            },
                          });
                      }}
                    />
                  </FormField>
                </>
              )}
              <FormField label="每个会话完成后的间隔（毫秒）">
                <Input
                  type="number"
                  min={500}
                  max={600000}
                  value={v.input.intervalMs}
                  onChange={(e) =>
                    patch({ ...v.input, intervalMs: Number(e.target.value) })
                  }
                />
              </FormField>
            </section>
          )}
          <section className="space-y-3 border-t pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">运行结束请求</h3>
              <Switch
                aria-label="启用运行结束请求"
                checked={!!v.hooks.afterRun}
                onCheckedChange={(on) =>
                  form.setValue(
                    'hooks.afterRun',
                    on
                      ? { ...defaultRequest(), response: { type: 'ignore' } }
                      : null,
                  )
                }
              />
            </div>
            <p className="text-muted-foreground text-xs">
              成功或失败都会执行，可回传本轮状态。
            </p>
            {v.hooks.afterRun && (
              <HttpEditor
                value={v.hooks.afterRun}
                onChange={(r) => form.setValue('hooks.afterRun', r)}
                secret={v.secrets.after}
                onSecret={(s) => form.setValue('secrets.after', s)}
                ignore
              />
            )}
          </section>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={save.isPending}
            >
              取消
            </Button>
            <BusyButton busy={save.isPending} type="submit">
              <Save />
              保存配置
            </BusyButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
