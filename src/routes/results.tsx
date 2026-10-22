import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  FolderCheck,
  FolderOpen,
  ArrowUpRight,
  Smartphone,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useUI } from '@/lib/ui-store';
import { runsQuery } from '@/lib/query';
import { invoke } from '@/lib/bridge';
import { formatTime } from '@/lib/format';
import {
  PageTitle,
  Panel,
  EmptyState,
  ErrorMessage,
  Status,
} from '@/components/common';
import { Button } from '@/components/ui/button';
import { Details } from './history';
export const Route = createFileRoute('/results')({ component: Results });
function Results() {
  const batch = useUI((s) => s.runs);
  const saved = useQuery(runsQuery);
  const [id, setId] = useState('');
  return (
    <>
      <PageTitle
        title="运行结果"
        description="查看本轮设备状态和已经保存的执行结果。"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void invoke('open_results').catch((e) => toast.error(String(e)));
            }}
          >
            <FolderOpen />
            打开结果目录
          </Button>
        }
      />
      <ErrorMessage error={saved.error} />
      {batch.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          {batch.map((run) => (
            <Panel key={run.serial}>
              <div className="mb-4 flex items-center gap-3">
                <Smartphone className="text-muted-foreground size-5" />
                <div className="flex-1">
                  <h2 className="text-sm font-medium">{run.model}</h2>
                  <p className="text-muted-foreground text-xs">{run.serial}</p>
                </div>
                <Status value={run.status} />
              </div>
              {run.error && <ErrorMessage error={run.error} />}
              <p className="text-muted-foreground text-sm">
                {run.progress?.message}
              </p>
              {run.result && (
                <>
                  <dl className="mt-4 space-y-2">
                    {Object.entries(run.result.outputs).map(([key, value]) => (
                      <div
                        key={key}
                        className="flex justify-between gap-3 text-sm"
                      >
                        <dt className="text-muted-foreground">{key}</dt>
                        <dd className="break-all">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {run.result.warning && (
                    <p className="text-warning mt-3 text-xs">
                      {run.result.warning}
                    </p>
                  )}
                  {run.result.screenshot && (
                    <details className="mt-4 text-sm">
                      <summary>完成画面</summary>
                      <img
                        className="mx-auto mt-3 max-h-80 max-w-full rounded-lg border object-contain"
                        loading="lazy"
                        decoding="async"
                        src={run.result.screenshot}
                        alt="工作流完成画面"
                      />
                    </details>
                  )}
                </>
              )}
            </Panel>
          ))}
        </div>
      )}
      <Panel
        title="已保存的结果"
        action={
          <Link
            to="/history"
            className="text-primary flex items-center gap-1 text-xs"
          >
            全部记录
            <ArrowUpRight className="size-3" />
          </Link>
        }
      >
        {saved.data?.length ? (
          <div className="divide-y">
            {saved.data.slice(0, 10).map((r) => (
              <button
                key={r.id}
                onClick={() => setId(r.id)}
                className="flex w-full items-center justify-between gap-3 py-4 text-left first:pt-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium">{r.workflow_name}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {r.serial} · {formatTime(r.timestamp)}
                  </p>
                </div>
                <Status value={r.status} />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FolderCheck}
            title="结果已准备好被记录"
            description="选择一条工作流开始运行，完成后会自动保存结果。"
            action={
              <Button asChild variant="outline">
                <Link to="/">返回工作台</Link>
              </Button>
            }
          />
        )}
      </Panel>
      {id && <Details id={id} onClose={() => setId('')} />}
    </>
  );
}
