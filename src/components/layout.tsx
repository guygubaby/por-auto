import { SelectControl } from './select-control';
import { useEffect, useId } from 'react';
import { Outlet, Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Cable,
  CalendarClock,
  CircleHelp,
  FolderCheck,
  History,
  LayoutGrid,
  Moon,
  Monitor,
  Settings2,
  Sun,
  Workflow,
  CheckCircle2,
  Info,
  ArrowUpRight,
  Loader2,
} from 'lucide-react';
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion,
} from 'motion/react';
import { Toaster, toast } from 'sonner';
import { useTheme } from '@/hooks/use-theme';
import {
  activeQuery,
  environmentQuery,
  queryClient,
  schedulesQuery,
} from '@/lib/query';
import { notifyRun } from '@/lib/run-feedback';
import { desktop, subscribe } from '@/lib/bridge';
import { useUI, type Theme } from '@/lib/ui-store';
import type { Progress } from '@/types';
import { cn } from '@/lib/utils';
import { TooltipProvider } from './ui/tooltip';
const navigation = [
  { to: '/', label: '工作台', icon: LayoutGrid },
  { to: '/results', label: '运行结果', icon: FolderCheck },
  { to: '/schedules', label: '定时任务', icon: CalendarClock },
  { to: '/history', label: '运行记录', icon: History },
  { to: '/store', label: '工作流商店', icon: Workflow },
  { to: '/settings', label: '设置', icon: Settings2 },
  { to: '/guide', label: '使用指引', icon: CircleHelp },
] as const;
export function Layout() {
  const animationScope = useId();
  const reduceMotion = useReducedMotion();
  const { theme, setTheme } = useTheme();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const environment = useQuery(environmentQuery);
  const devices =
    environment.data?.devices.filter((d) => d.state === 'device') ?? [];
  const manualRunning = useUI((s) => s.running);
  const active = useQuery(activeQuery);
  const schedules = useQuery(schedulesQuery);
  const running =
    manualRunning ||
    Object.keys(active.data ?? {}).length > 0 ||
    !!schedules.data?.runningIds.length;
  useEffect(() => {
    const stop = [
      subscribe('app-update-status', (value) =>
        queryClient.setQueryData(['update'], value),
      ),
      subscribe('workflow-progress', (p) =>
        useUI.getState().onProgress(p as Progress),
      ),
      subscribe('history-changed', () => {
        void queryClient.invalidateQueries({ queryKey: ['runs'] });
        void queryClient.invalidateQueries({ queryKey: ['active-runs'] });
      }),
      subscribe('schedules-changed', (value) => {
        void queryClient.invalidateQueries({ queryKey: ['schedules'] });
        void queryClient.invalidateQueries({ queryKey: ['active-runs'] });
        notifyRun(value);
      }),
    ];
    return () => stop.forEach((f) => f());
  }, []);
  useEffect(() => {
    document.title = `${navigation.find((n) => n.to === path)?.label ?? '工作台'} · Por Auto`;
    const main = document.getElementById('main-content');
    main?.scrollTo({ top: 0 });
    main?.focus({ preventScroll: true });
  }, [path]);
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <div className="flex h-full min-h-0">
          <a
            href="#main-content"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById('main-content')?.focus();
            }}
            className="bg-primary text-primary-foreground fixed top-4 left-4 z-50 -translate-y-24 rounded-lg px-4 py-2 focus:translate-y-0"
          >
            跳到主要内容
          </a>
          <aside className="bg-sidebar hidden w-56 shrink-0 flex-col border-r px-3 py-6 md:flex">
            <Link to="/" className="mb-10 flex items-center gap-2.5 px-3">
              <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-xl">
                <Workflow className="size-5" />
              </span>
              <span className="text-lg font-semibold tracking-tight">
                Por Auto<span className="text-primary ml-1">.</span>
              </span>
            </Link>
            <div className="text-muted-foreground mb-3 px-3 text-xs font-medium">
              我的工作空间
            </div>
            <motion.nav
              layout
              transition={{ layout: { duration: 0 } }}
              className="space-y-1"
              aria-label="主导航"
            >
              {navigation.map(({ to, label, icon: NavIcon }) => (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    path === to
                      ? 'text-primary-foreground font-medium'
                      : 'text-muted-foreground hover:bg-card/65 hover:text-foreground',
                  )}
                >
                  {path === to && (
                    <motion.span
                      aria-hidden
                      layoutId={`${animationScope}-navigation`}
                      className="bg-primary absolute inset-0 rounded-lg shadow-xs"
                      transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                    />
                  )}
                  <NavIcon
                    className="relative size-4"
                    strokeWidth={path === to ? 2 : 1.65}
                  />
                  <span className="relative">{label}</span>
                </Link>
              ))}
            </motion.nav>
            <div className="mt-auto px-3">
              <div className="bg-card/70 mb-4 rounded-xl border p-3.5">
                <p className="flex items-center gap-2 text-xs font-medium">
                  <span className="bg-primary size-1.5 rounded-full" />
                  本机工作空间
                </p>
                <p className="text-muted-foreground mt-2 text-xs leading-5">
                  所有配置与运行记录
                  <br />
                  都保存在你的电脑里。
                </p>
              </div>
              <p className="text-muted-foreground text-xs">
                Por Auto <span className="float-right">v0.4.4</span>
              </p>
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-16 shrink-0 items-center justify-between border-b px-5 lg:px-8">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">工作空间</span>
                <span className="text-border px-1">/</span>
                <span className="font-medium">
                  {navigation.find((n) => n.to === path)?.label}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex">
                  {running ? (
                    <Loader2
                      aria-hidden
                      className="text-primary size-3.5 motion-safe:animate-spin"
                    />
                  ) : devices.length ? (
                    <CheckCircle2 className="text-primary size-3.5" />
                  ) : (
                    <Cable className="size-3.5" />
                  )}
                  {running
                    ? '任务运行中'
                    : devices.length
                      ? `${devices.length} 台设备就绪`
                      : '等待连接设备'}
                </span>
                <div className="w-36">
                  <SelectControl
                    label="主题"
                    size="sm"
                    value={theme}
                    options={[
                      { value: 'system', label: '跟随系统' },
                      { value: 'light', label: '浅色' },
                      { value: 'dark', label: '深色' },
                    ]}
                    onValueChange={(value) => {
                      void setTheme(value as Theme).catch((error) =>
                        toast.error(String(error)),
                      );
                    }}
                    icon={
                      <AnimatePresence initial={false} mode="wait">
                        <motion.span
                          key={theme}
                          initial={{
                            opacity: 0,
                            scale: 0.25,
                            filter: 'blur(4px)',
                          }}
                          animate={{
                            opacity: 1,
                            scale: 1,
                            filter: 'blur(0px)',
                          }}
                          exit={{
                            opacity: 0,
                            scale: 0.25,
                            filter: 'blur(4px)',
                          }}
                          transition={{
                            type: 'spring',
                            duration: reduceMotion ? 0 : 0.3,
                            bounce: 0,
                          }}
                        >
                          <Icon className="size-3.5" />
                        </motion.span>
                      </AnimatePresence>
                    }
                  />
                </div>
              </div>
            </header>
            <nav
              className="flex gap-2 overflow-auto border-b px-4 py-2 md:hidden"
              aria-label="移动导航"
            >
              {navigation.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    'shrink-0 rounded-lg px-3 py-2 text-xs',
                    path === n.to
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <main
              id="main-content"
              tabIndex={-1}
              className="min-h-0 flex-1 overflow-auto outline-none"
            >
              <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
                {!desktop && (
                  <div className="border-primary/15 bg-muted text-primary mb-6 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
                    <Info className="size-3.5" />
                    界面预览 · 设备操作请打开桌面客户端
                    <Link
                      to="/guide"
                      className="ml-auto inline-flex items-center gap-1"
                    >
                      连接指引
                      <ArrowUpRight className="size-3" />
                    </Link>
                  </div>
                )}
                <motion.div
                  key={path}
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <Outlet />
                </motion.div>
              </div>
            </main>
          </div>
        </div>
        <Toaster
          richColors
          position="bottom-right"
          theme={theme === 'system' ? 'system' : theme}
        />
      </TooltipProvider>
    </MotionConfig>
  );
}
