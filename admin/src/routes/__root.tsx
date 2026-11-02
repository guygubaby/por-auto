import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
})

type TopNavTo = '/' | '/runs' | '/config'

function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-8">
          <Link to="/" className="inline-flex items-baseline gap-2">
            <span className="font-serif text-xl tracking-tight">PorAuto</span>
            <span className="text-[10px] uppercase tracking-[0.22em] text-muted">管理台</span>
          </Link>
          <nav aria-label="主导航" className="flex items-center gap-1 text-[13px]">
            <TopNavLink to="/">下载</TopNavLink>
            <TopNavLink to="/runs">运行日志</TopNavLink>
            <TopNavLink to="/config">AI 配置</TopNavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
        <Outlet />
      </main>

      <footer className="mx-auto w-full max-w-5xl px-5 pb-8 text-[11px] text-muted sm:px-8">
        PorAuto · 企业微信群发自动化
      </footer>
    </div>
  )
}

function TopNavLink({ to, children }: { to: TopNavTo; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-md px-2.5 py-1.5 text-muted transition hover:bg-white hover:text-ink"
      activeProps={{ className: 'rounded-md bg-amber/10 px-2.5 py-1.5 font-medium text-ink' }}
    >
      {children}
    </Link>
  )
}

function NotFoundPage() {
  return (
    <div className="rounded-[10px] border border-line bg-white p-10 text-center">
      <p className="font-serif text-2xl">页面不存在</p>
      <p className="mt-2 text-[13px] text-muted">
        回到{' '}
        <Link to="/" className="underline underline-offset-2 hover:text-ink">
          下载页
        </Link>
        。
      </p>
    </div>
  )
}
