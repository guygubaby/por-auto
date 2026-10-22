import {
  AlertCircle,
  Check,
  Loader2,
  Smartphone,
  Workflow as WorkflowIcon,
  MessageSquare,
  UserRound,
  Power,
  MessagesSquare,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { statusLabels } from '@/lib/format';
import type { DeviceRun, Progress, Workflow } from '@/types';
export function PaginationControls({
  page,
  pageCount,
  total,
  label,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  label: string;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-3 pt-4 text-xs"
    >
      <span className="text-muted-foreground tabular-nums">共 {total} 条</span>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
          上一页
        </Button>
        <span className="text-muted-foreground tabular-nums">
          第 {page} / {pageCount} 页
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
        >
          下一页
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Panel({
  children,
  title,
  description,
  action,
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border">
      {title && (
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {description && (
              <p className="text-muted-foreground mt-1 text-xs">
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
export function EmptyState({
  icon: Icon = Smartphone,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      <div className="bg-secondary text-primary mb-4 grid size-14 place-items-center rounded-2xl border">
        <Icon className="size-6" strokeWidth={1.5} />
      </div>
      <h3 className="font-medium">{title}</h3>
      <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-6">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
export function Status({ value }: { value: string }) {
  const reduceMotion = useReducedMotion();
  const positive = ['completed', 'rehearsed', 'sent'].includes(value);
  const bad = ['failed', 'uncertain', 'interrupted'].includes(value);
  const warning = ['partial', 'skipped', 'stopped'].includes(value);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        positive
          ? 'bg-success-soft text-success'
          : bad
            ? 'bg-destructive/10 text-destructive'
            : warning
              ? 'bg-warning/10 text-warning'
              : 'bg-secondary text-muted-foreground',
      )}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={value}
          aria-hidden
          className="inline-flex"
          initial={
            reduceMotion
              ? false
              : { opacity: 0, scale: 0.25, filter: 'blur(4px)' }
          }
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{
            opacity: 0,
            scale: reduceMotion ? 1 : 0.25,
            filter: reduceMotion ? 'blur(0px)' : 'blur(4px)',
          }}
          transition={{
            type: 'spring',
            duration: reduceMotion ? 0 : 0.3,
            bounce: 0,
          }}
        >
          {positive ? (
            <Check className="size-3" />
          ) : bad ? (
            <AlertCircle className="size-3" />
          ) : value === 'running' || value === 'rehearsing' ? (
            <Loader2 className="size-3 motion-safe:animate-spin" />
          ) : (
            <span className="size-1.5 rounded-full bg-current" />
          )}
        </motion.span>
      </AnimatePresence>
      {statusLabels[value] ?? value}
    </span>
  );
}
export function RunProgress({
  run,
}: {
  run: Pick<DeviceRun, 'model' | 'status'> & {
    progress?: Partial<Pick<Progress, 'step' | 'total'>>;
  };
}) {
  const { step, total } = run.progress ?? {};
  if (
    typeof step !== 'number' ||
    typeof total !== 'number' ||
    !Number.isFinite(step) ||
    !Number.isFinite(total) ||
    total <= 0
  )
    return null;
  const value =
    run.status === 'completed' ? total : Math.max(0, Math.min(total, step));
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-muted-foreground flex justify-between text-xs tabular-nums">
        <span>
          步骤 {value} / {total}
        </span>
        <span>{Math.round((value / total) * 100)}%</span>
      </p>
      <progress
        aria-label={`${run.model}执行进度`}
        max={total}
        value={value}
        className={cn(
          'bg-secondary text-primary block h-1.5 w-full appearance-none overflow-clip rounded-full border-0 [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-current [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-current motion-safe:[&::-webkit-progress-value]:transition-[inline-size]',
          run.status === 'completed' && 'text-success',
          run.status === 'failed' && 'text-destructive',
        )}
      />
    </div>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <div
      role="alert"
      className="border-destructive/20 bg-destructive/5 text-destructive mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      {String(error instanceof Error ? error.message : error)}
    </div>
  ) : null;
}
export function BusyButton({
  busy,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { busy?: boolean }) {
  return (
    <Button {...props} disabled={props.disabled || busy}>
      {busy && (
        <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />
      )}
      {children}
    </Button>
  );
}
export function WorkflowGlyph({ workflow }: { workflow: Workflow }) {
  const name = workflow.id;
  const Icon = name.includes('nickname')
    ? UserRound
    : name.includes('broadcast')
      ? MessagesSquare
      : name.includes('open')
        ? Power
        : name.includes('first')
          ? MessageSquare
          : WorkflowIcon;
  return (
    <div
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-xl',
        workflow.package === 'com.tencent.wework'
          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300'
          : 'bg-muted text-primary',
      )}
    >
      <Icon className="size-5" strokeWidth={1.7} />
    </div>
  );
}
export function FormField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && (
        <span className="text-muted-foreground block text-xs leading-5">
          {hint}
        </span>
      )}
    </label>
  );
}
