import { KeyRound, LogOut } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { clearAdminToken, readAdminToken, writeAdminToken } from '../lib/auth'
import { SecretInput, buttonClass } from './ui'

interface AdminGateProps {
  children: (token: string, signOut: () => void) => ReactNode
}

export function AdminGate({ children }: AdminGateProps) {
  const [token, setToken] = useState(readAdminToken)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  const signOut = () => {
    clearAdminToken()
    setToken('')
    setDraft('')
    setError('')
  }

  if (!token) {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const value = draft.trim()
      if (!value) {
        setError('请输入访问口令')
        return
      }
      writeAdminToken(value)
      setToken(value)
      setError('')
    }

    return (
      <div className="mx-auto max-w-sm rounded-[10px] border border-line bg-white p-6">
        <KeyRound size={20} className="text-amber" aria-hidden="true" />
        <h1 className="mt-4 font-serif text-xl">访问口令</h1>
        <p className="mt-1.5 text-[13px] leading-6 text-muted">
          运行日志和 AI 配置需要口令。口令由部署时的环境变量设置，只保存在本机浏览器。
        </p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <label htmlFor="admin-token" className="block text-[13px] font-medium">
            口令
          </label>
          <SecretInput
            id="admin-token"
            value={draft}
            onChange={setDraft}
            placeholder="访问口令"
            autoFocus
          />
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <button type="submit" className={`${buttonClass} w-full justify-center`}>
            进入
          </button>
        </form>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5 flex justify-end">
        <button
          type="button"
          onClick={signOut}
          className="inline-flex items-center gap-1.5 text-[12px] text-muted transition hover:text-ink"
        >
          <LogOut size={13} aria-hidden="true" />
          退出
        </button>
      </div>
      {children(token, signOut)}
    </div>
  )
}
