import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Plus,
  Search,
  RefreshCw,
  Check,
  Download,
  Settings2,
  Trash2,
  GitBranch,
} from 'lucide-react';
import { toast } from 'sonner';
import { storeQuery, queryClient } from '@/lib/query';
import { invoke, officialURL, desktop } from '@/lib/bridge';
import { type Installed, type Store } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  BusyButton,
  ErrorMessage,
  FormField,
  PageTitle,
  WorkflowGlyph,
} from '@/components/common';
import { WorkflowEditor } from '@/components/workflow-editor';
export const Route = createFileRoute('/store')({
  validateSearch: z.object({
    q: z.string().optional().catch(''),
    filter: z.enum(['all', 'installed']).optional().catch('all'),
  }),
  loader: () => queryClient.ensureQueryData(storeQuery),
  component: StorePage,
});
const registrySchema = z.object({
  url: z.url('请输入仓库地址'),
  reference: z.string().min(1),
  token: z.string(),
});
function StorePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const store = useQuery(storeQuery);
  const [add, setAdd] = useState(false);
  const [editing, setEditing] = useState<Installed | null>(null);
  const [remove, setRemove] = useState<Installed | null>(null);
  const form = useForm({
    resolver: zodResolver(registrySchema),
    defaultValues: { url: '', reference: 'main', token: '' },
  });
  const mutation = useMutation({
    mutationFn: async ({
      command,
      args,
    }: {
      command: string;
      args: Record<string, unknown>;
    }) => invoke<Store>(command, args),
    onSuccess: (r) => {
      queryClient.setQueryData(['store'], r);
      setAdd(false);
      setRemove(null);
      toast.success('工作流商店已更新');
    },
  });
  return (
    <>
      <PageTitle
        title="工作流商店"
        description="可查看、可配置，安装后离线运行。"
        action={
          <Button size="sm" onClick={() => setAdd(true)}>
            <Plus />
            添加来源
          </Button>
        }
      />
      <ErrorMessage error={store.error ?? mutation.error} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="text-muted-foreground absolute top-2.5 left-3 size-4" />
          <Input
            aria-label="搜索工作流"
            className="pl-9"
            placeholder="搜索工作流"
            value={search.q ?? ''}
            onChange={(e) => {
              void navigate({
                search: { ...search, q: e.target.value },
                replace: true,
              });
            }}
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'installed'] as const).map((filter) => (
            <Button
              key={filter}
              variant={
                (search.filter ?? 'all') === filter ? 'secondary' : 'ghost'
              }
              size="sm"
              onClick={() => {
                void navigate({ search: { ...search, filter } });
              }}
            >
              {filter === 'all' ? '全部工作流' : '已安装'}
            </Button>
          ))}
        </div>
      </div>
      {store.data?.registries.map((registry) => (
        <section key={registry.url + registry.reference} className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="text-muted-foreground size-4" />
              <h2 className="text-sm font-semibold">{registry.name}</h2>
              {registry.url === officialURL && (
                <span className="bg-muted text-primary rounded-full px-2 py-0.5 text-xs">
                  官方
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={mutation.isPending || !desktop}
              onClick={() =>
                mutation.mutate({
                  command: 'sync_registry',
                  args: {
                    url: registry.url,
                    reference: registry.reference,
                    token: '',
                  },
                })
              }
            >
              <RefreshCw className="size-3.5" />
              同步来源
            </Button>
          </div>
          <p className="text-muted-foreground mb-4 text-xs">
            {registry.url.replace('https://github.com/', '')} ·{' '}
            {registry.reference} ·{' '}
            {registry.commit === 'bundled'
              ? '随应用附带'
              : registry.commit.slice(0, 8)}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {registry.workflows
              .filter(
                (w) =>
                  !search.q ||
                  w.name.includes(search.q) ||
                  w.description.includes(search.q),
              )
              .map((workflow) => {
                const item = store.data?.installed.find(
                  (i) =>
                    i.workflow.id === workflow.id &&
                    i.registryUrl === registry.url &&
                    i.reference === registry.reference,
                );
                if (search.filter === 'installed' && !item) return null;
                return (
                  <div
                    key={workflow.id}
                    className="bg-card flex flex-col rounded-xl border p-5"
                  >
                    <div className="flex items-start justify-between">
                      <WorkflowGlyph workflow={workflow} />
                      {item && (
                        <span className="text-primary inline-flex items-center gap-1 text-xs">
                          <Check className="size-3" />
                          已安装
                        </span>
                      )}
                    </div>
                    <h3 className="mt-5 text-sm font-semibold">
                      {workflow.name}
                    </h3>
                    <p className="text-muted-foreground mt-2 mb-5 line-clamp-3 min-h-15 text-xs leading-5">
                      {workflow.description}
                    </p>
                    <div className="mt-auto flex items-center justify-between border-t pt-3">
                      <span className="text-muted-foreground text-xs">
                        v{workflow.version}
                      </span>
                      {item ? (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`卸载 ${workflow.name}`}
                            disabled={!desktop || mutation.isPending}
                            onClick={() => setRemove(item)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditing(item)}
                          >
                            <Settings2 className="size-3.5" />
                            配置
                          </Button>
                          {item.commit !== registry.commit && (
                            <Button
                              size="sm"
                              onClick={() =>
                                mutation.mutate({
                                  command: 'install_workflow',
                                  args: {
                                    url: registry.url,
                                    reference: registry.reference,
                                    id: workflow.id,
                                  },
                                })
                              }
                            >
                              更新
                            </Button>
                          )}
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          disabled={!desktop || mutation.isPending}
                          onClick={() =>
                            mutation.mutate({
                              command: 'install_workflow',
                              args: {
                                url: registry.url,
                                reference: registry.reference,
                                id: workflow.id,
                              },
                            })
                          }
                        >
                          <Download className="size-3.5" />
                          安装
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
          {registry.url !== officialURL && (
            <Button
              className="mt-3"
              size="sm"
              variant="ghost"
              disabled={mutation.isPending || !desktop}
              onClick={() =>
                mutation.mutate({
                  command: 'remove_registry',
                  args: { url: registry.url, reference: registry.reference },
                })
              }
            >
              移除此来源
            </Button>
          )}
        </section>
      ))}
      <Dialog open={add} onOpenChange={setAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加工作流来源</DialogTitle>
            <DialogDescription>
              使用 GitHub 仓库中的工作流目录，配置与凭据保存在本机。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((args) =>
              mutation.mutate({ command: 'sync_registry', args }),
            )}
          >
            <FormField label="GitHub 仓库">
              <Input
                placeholder="https://github.com/owner/repo"
                {...form.register('url')}
              />
            </FormField>
            <FormField label="分支">
              <Input {...form.register('reference')} />
            </FormField>
            <FormField
              label="访问令牌（私有仓库可选）"
              hint="只在本次同步中使用，不保存。"
            >
              <Input
                type="password"
                autoComplete="off"
                {...form.register('token')}
              />
            </FormField>
            <ErrorMessage error={mutation.error} />
            <DialogFooter>
              <BusyButton
                type="submit"
                busy={mutation.isPending}
                disabled={!desktop}
              >
                同步并添加
              </BusyButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>卸载 {remove?.workflow.name}？</DialogTitle>
            <DialogDescription>
              运行记录保留，使用此工作流的定时任务将暂停。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemove(null)}>
              取消
            </Button>
            <BusyButton
              variant="destructive"
              busy={mutation.isPending}
              onClick={() =>
                mutation.mutate({
                  command: 'uninstall_workflow',
                  args: { key: remove?.key },
                })
              }
            >
              卸载
            </BusyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
