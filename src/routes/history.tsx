import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { Download, History, Search, Trash2, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { runsQuery, queryClient } from '@/lib/query';
import { invoke, desktop } from '@/lib/bridge';
import { formatTime } from '@/lib/format';
import type { RunDetails } from '@/types';
import {
  PageTitle,
  Panel,
  EmptyState,
  Status,
  ErrorMessage,
  BusyButton,
  PaginationControls,
} from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
const PAGE_SIZE = 50;
export const Route = createFileRoute('/history')({
  validateSearch: z.object({
    q: z.string().optional().catch(''),
    task: z.string().optional(),
    page: z.coerce.number().int().positive().optional().catch(1),
  }),
  loader: () => queryClient.ensureQueryData(runsQuery),
  component: HistoryPage,
});
export function Details({ id, onClose }: { id: string; onClose: () => void }) {
  const [currentID, setCurrentID] = useState(id);
  const [targetPage, setTargetPage] = useState(1);
  const [logPage, setLogPage] = useState(1);
  const [logsOpen, setLogsOpen] = useState(false);
  const details = useQuery({
    queryKey: ['run', currentID],
    queryFn: () => invoke<RunDetails>('run_details', { id: currentID }),
  });
  const d = details.data;
  const targetPages = Math.max(
    1,
    Math.ceil((d?.targets.length ?? 0) / PAGE_SIZE),
  );
  const currentTargetPage = Math.min(targetPage, targetPages);
  const logPages = Math.max(1, Math.ceil((d?.events.length ?? 0) / PAGE_SIZE));
  const currentLogPage = Math.min(logPage, logPages);
  function selectRecord(recordId: string) {
    setCurrentID(recordId);
    setTargetPage(1);
    setLogPage(1);
    setLogsOpen(false);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[88dvh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{d?.summary.workflow_name ?? '运行详情'}</DialogTitle>
          <DialogDescription>
            {d
              ? `${d.summary.serial} · ${formatTime(d.summary.timestamp)}`
              : '正在读取本地记录'}
          </DialogDescription>
        </DialogHeader>
        <ErrorMessage error={details.error} />
        {d && (
          <div className="space-y-5">
            {currentID !== id && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectRecord(id)}
              >
                返回批次记录
              </Button>
            )}
            <Status value={d.summary.status} />
            {d.summary.error && <ErrorMessage error={d.summary.error} />}
            {d.result?.warning && (
              <p role="alert" className="text-warning text-sm">
                {d.result.warning}
              </p>
            )}
            {d.batch?.devices && (
              <div className="divide-y rounded-lg border px-4">
                {d.batch.devices.map((device) => (
                  <div
                    key={device.serial}
                    className="flex items-center justify-between gap-4 py-3 text-sm"
                  >
                    <div>
                      <p>{device.serial}</p>
                      {device.error && (
                        <p className="text-destructive mt-1 text-xs">
                          {device.error}
                        </p>
                      )}
                    </div>
                    {device.runId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => selectRecord(device.runId!)}
                      >
                        设备记录
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(d.result?.outputs ?? {}).map(([key, value]) => (
                <div key={key} className="bg-muted/40 rounded-lg border p-3">
                  <p className="text-muted-foreground text-xs">{key}</p>
                  <p className="mt-1 text-sm break-words">{String(value)}</p>
                </div>
              ))}
            </div>
            {d.targets?.length > 0 && (
              <div>
                <ul
                  aria-label="接收对象结果"
                  className="divide-y rounded-lg border px-3"
                >
                  {d.targets
                    .slice(
                      (currentTargetPage - 1) * PAGE_SIZE,
                      currentTargetPage * PAGE_SIZE,
                    )
                    .map((t, i) => (
                      <li
                        key={(currentTargetPage - 1) * PAGE_SIZE + i}
                        className="flex items-center justify-between gap-3 py-3"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm break-words">{t.title}</p>
                            {t.scope && (
                              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">
                                {t.scope === 'groups' ? '群聊' : '单聊'}
                              </span>
                            )}
                          </div>
                          {t.error && (
                            <p className="text-destructive mt-1 text-xs">
                              {t.error}
                            </p>
                          )}
                        </div>
                        <Status value={t.status} />
                      </li>
                    ))}
                </ul>
                <PaginationControls
                  label="接收对象分页"
                  page={currentTargetPage}
                  pageCount={targetPages}
                  total={d.targets.length}
                  onChange={setTargetPage}
                />
              </div>
            )}
            {d.result?.screenshot && (
              <details>
                <summary className="text-sm font-medium">查看完成画面</summary>
                <img
                  className="mx-auto mt-3 max-h-96 max-w-full rounded-lg border object-contain"
                  loading="lazy"
                  decoding="async"
                  src={d.result.screenshot}
                  alt="工作流完成时的手机画面"
                />
              </details>
            )}
            <details
              open={logsOpen}
              onToggle={(event) => setLogsOpen(event.currentTarget.open)}
            >
              <summary className="text-sm font-medium">
                执行日志（{d.events.length}）
              </summary>
              {logsOpen && (
                <>
                  <ul
                    aria-label="执行日志列表"
                    className="bg-muted/40 mt-3 max-h-80 overflow-auto overscroll-contain rounded-lg border p-3"
                  >
                    {d.events
                      .slice(
                        (currentLogPage - 1) * PAGE_SIZE,
                        currentLogPage * PAGE_SIZE,
                      )
                      .map((event, i) => (
                        <li
                          key={(currentLogPage - 1) * PAGE_SIZE + i}
                          className="mb-2 text-xs break-words"
                        >
                          <span className="text-muted-foreground mr-3">
                            {formatTime(event.timestamp)}
                          </span>
                          {event.message}
                        </li>
                      ))}
                  </ul>
                  <PaginationControls
                    label="执行日志分页"
                    page={currentLogPage}
                    pageCount={logPages}
                    total={d.events.length}
                    onChange={setLogPage}
                  />
                </>
              )}
            </details>
            <p className="text-muted-foreground text-xs break-all">
              本机目录：{d.folder}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void invoke('open_results').catch((e) =>
                  toast.error(String(e)),
                );
              }}
            >
              <FolderOpen />
              打开运行目录
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
function HistoryPage() {
  const runs = useQuery(runsQuery);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [details, setDetails] = useState('');
  const [confirm, setConfirm] = useState(false);
  const change = useMutation({
    mutationFn: ({ command }: { command: string }) =>
      invoke(command, { ids: selected }),
    onSuccess: (_, v) => {
      if (v.command === 'delete_runs') {
        setSelected([]);
        setConfirm(false);
        void queryClient.invalidateQueries({ queryKey: ['runs'] });
      } else toast.success('记录已导出');
    },
  });
  const items = (runs.data ?? []).filter(
    (r) =>
      (!search.task || r.schedule_id === search.task) &&
      (!search.q ||
        r.workflow_name.includes(search.q) ||
        r.serial.includes(search.q) ||
        r.schedule_name?.includes(search.q)),
  );
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(search.page ?? 1, pageCount);
  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <>
      <PageTitle
        title="运行记录"
        description="每次执行都有迹可循，结果与证据留在本机。"
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={
              !selected.length ||
              selected.length > 100 ||
              !desktop ||
              change.isPending
            }
            aria-describedby={
              selected.length > 100 ? 'export-limit' : undefined
            }
            onClick={() => change.mutate({ command: 'export_runs' })}
          >
            <Download />
            导出 JSON
          </Button>
        }
      />
      <ErrorMessage error={runs.error ?? change.error} />
      {selected.length > 100 && (
        <p id="export-limit" className="text-muted-foreground mb-4 text-sm">
          每次最多导出 100 条记录，请减少选择后导出。
        </p>
      )}
      {search.task && (
        <Button
          className="mb-4"
          variant="outline"
          size="sm"
          onClick={() => void navigate({ search: {} })}
        >
          清除任务筛选
        </Button>
      )}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="text-muted-foreground absolute top-2.5 left-3 size-4" />
          <Input
            aria-label="搜索运行记录"
            className="pl-9"
            placeholder="搜索工作流或设备"
            value={search.q ?? ''}
            onChange={(e) => {
              void navigate({
                search: { ...search, q: e.target.value, page: undefined },
                replace: true,
              });
            }}
          />
        </div>
        {selected.length > 0 && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              取消选择
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
              <Trash2 />
              删除所选 {selected.length} 条
            </Button>
          </div>
        )}
      </div>
      <Panel>
        {items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="w-10 pb-3">
                    <Checkbox
                      aria-label="全选本页记录"
                      checked={
                        pageItems.every((i) => selected.includes(i.id))
                          ? true
                          : pageItems.some((i) => selected.includes(i.id))
                            ? 'indeterminate'
                            : false
                      }
                      onCheckedChange={(v) =>
                        setSelected(
                          v
                            ? [
                                ...new Set([
                                  ...selected,
                                  ...pageItems.map((i) => i.id),
                                ]),
                              ]
                            : selected.filter(
                                (id) =>
                                  !pageItems.some((item) => item.id === id),
                              ),
                        )
                      }
                    />
                  </th>
                  <th className="pb-3 font-medium">工作流</th>
                  <th className="pb-3 font-medium">设备</th>
                  <th className="pb-3 font-medium">运行时间</th>
                  <th className="pb-3 font-medium">状态</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageItems.map((r) => (
                  <tr key={r.id} className="group">
                    <td className="py-4">
                      <Checkbox
                        aria-label={`选择记录 ${r.id}`}
                        checked={selected.includes(r.id)}
                        onCheckedChange={(v) =>
                          setSelected(
                            v
                              ? [...selected, r.id]
                              : selected.filter((id) => id !== r.id),
                          )
                        }
                      />
                    </td>
                    <td className="py-4 pr-4 font-medium">
                      {r.workflow_name}
                      <p className="text-muted-foreground mt-0.5 text-xs font-normal">
                        {r.dry_run ? '预演' : '执行'} · v{r.workflow_version}
                        {r.schedule_name && ` · ${r.schedule_name}`}
                      </p>
                    </td>
                    <td className="text-muted-foreground pr-4 text-xs">
                      {r.serial}
                    </td>
                    <td className="text-muted-foreground pr-4 text-xs">
                      {formatTime(r.timestamp)}
                    </td>
                    <td>
                      <Status value={r.status} />
                    </td>
                    <td className="pl-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDetails(r.id)}
                      >
                        详情
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationControls
              label="运行记录分页"
              page={page}
              pageCount={pageCount}
              total={items.length}
              onChange={(page) => {
                void navigate({ search: { ...search, page }, replace: true });
              }}
            />
          </div>
        ) : (
          <EmptyState
            icon={History}
            title={runs.data?.length ? '没有匹配的运行记录' : '还没有运行记录'}
            description={
              runs.data?.length
                ? '换个关键词，或清除筛选后查看全部记录。'
                : '完成一轮工作流后，可在这里查看结果、逐群状态与执行日志。'
            }
            action={
              runs.data?.length ? (
                <Button
                  variant="outline"
                  onClick={() => void navigate({ search: {}, replace: true })}
                >
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        )}
      </Panel>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 {selected.length} 条运行记录？</DialogTitle>
            <DialogDescription>
              对应日志和结果将从本机永久删除。需要排查的记录请先导出。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              取消
            </Button>
            <BusyButton
              variant="destructive"
              busy={change.isPending}
              onClick={() => change.mutate({ command: 'delete_runs' })}
            >
              确认删除
            </BusyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {details && <Details id={details} onClose={() => setDetails('')} />}
    </>
  );
}
