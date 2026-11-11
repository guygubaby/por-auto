import { createFileRoute } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { AdminGate } from '../components/admin-gate'
import {
  Card,
  RequestError,
  SecretInput,
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '../components/ui'
import { fetchAiConfig, fetchAiModels, saveAiConfig, savePasscode, testAiConfig } from '../lib/api'
import type { AiConfig, Provider } from '../lib/types'

export const Route = createFileRoute('/config')({
  component: ConfigRoute,
})

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; configured: boolean }
  | { status: 'error'; error: unknown }

const PROVIDERS: Provider[] = ['openai', 'anthropic', 'opencode']

const EMPTY_CONFIG: AiConfig = {
  provider: 'openai',
  baseUrl: '',
  model: '',
  apiKey: '',
}

function ConfigRoute() {
  return (
    <AdminGate>
      {(token, signOut) => <ConfigPage token={token} signOut={signOut} />}
    </AdminGate>
  )
}

function ConfigPage({ token, signOut }: { token: string; signOut: () => void }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [loadKey, setLoadKey] = useState(0)
  const [form, setForm] = useState<AiConfig>(EMPTY_CONFIG)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [probeBusy, setProbeBusy] = useState<'models' | 'test' | null>(null)
  const [probeError, setProbeError] = useState<unknown>(null)
  const [probeNote, setProbeNote] = useState<string | null>(null)
  const [testReply, setTestReply] = useState<string | null>(null)

  /** 改任何字段都清掉上一次探测结果，免得旧的“连接成功”骗人。 */
  function edit(patch: Partial<AiConfig>) {
    setForm((current) => ({ ...current, ...patch }))
    if (patch.provider !== undefined || patch.baseUrl !== undefined) setModels([])
    setProbeError(null)
    setProbeNote(null)
    setTestReply(null)
  }

  async function handleFetchModels() {
    const baseUrl = form.baseUrl.trim()
    if (!baseUrl) {
      setProbeError(new Error('先填 Base URL'))
      return
    }
    setProbeBusy('models')
    setProbeError(null)
    setProbeNote(null)
    setTestReply(null)
    try {
      const list = await fetchAiModels(token, {
        provider: form.provider,
        baseUrl,
        apiKey: form.apiKey.trim(),
      })
      setModels(list)
      setProbeNote(`接口返回 ${list.length} 个模型，可以在「模型」里选`)
      setForm((current) =>
        current.model.trim() || list.length === 0 ? current : { ...current, model: list[0] },
      )
    } catch (error) {
      setProbeError(error)
    } finally {
      setProbeBusy(null)
    }
  }

  async function handleTest() {
    const baseUrl = form.baseUrl.trim()
    const model = form.model.trim()
    if (!baseUrl) {
      setProbeError(new Error('先填 Base URL'))
      return
    }
    if (!model) {
      setProbeError(new Error('先填模型名'))
      return
    }
    setProbeBusy('test')
    setProbeError(null)
    setProbeNote(null)
    setTestReply(null)
    try {
      const result = await testAiConfig(token, {
        provider: form.provider,
        baseUrl,
        model,
        apiKey: form.apiKey.trim(),
      })
      setTestReply(`${result.latencyMs} ms · 模型回复：${result.reply}`)
    } catch (error) {
      setProbeError(error)
    } finally {
      setProbeBusy(null)
    }
  }

  useEffect(() => {
    let active = true
    setLoad({ status: 'loading' })
    setSaveError(null)
    setSaved(false)
    fetchAiConfig(token)
      .then((config) => {
        if (!active) return
        if (config) {
          setForm({
            provider: config.provider,
            baseUrl: config.baseUrl ?? '',
            model: config.model ?? '',
            apiKey: '',
          })
        } else {
          setForm({ ...EMPTY_CONFIG })
        }
        setLoad({ status: 'ready', configured: config !== null })
      })
      .catch((error: unknown) => {
        if (active) setLoad({ status: 'error', error })
      })
    return () => {
      active = false
    }
  }, [token, loadKey])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    setSaveError(null)

    const next: AiConfig = {
      provider: form.provider,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim(),
    }

    if (!next.apiKey) {
      setSaveError(new Error('必须重新输入 API Key'))
      return
    }

    setSaving(true)
    try {
      await saveAiConfig(token, next)
      setForm((current) => ({ ...current, apiKey: '' }))
      setLoad({ status: 'ready', configured: true })
      setSaved(true)
    } catch (error) {
      setSaveError(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div>
        <h1 className="font-serif text-[26px] tracking-tight sm:text-[30px]">AI 配置</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          App 从服务端读取这份配置，保存后对下一次运行生效。
        </p>
      </div>

      {load.status === 'loading' && (
        <Card className="mt-6 p-8">
          <p className="motion-safe:animate-pulse text-[13px] text-muted">正在加载配置…</p>
        </Card>
      )}

      {load.status === 'error' && (
        <div className="mt-6">
          <RequestError
            error={load.error}
            onRetry={() => setLoadKey((key) => key + 1)}
            onSignOut={signOut}
          />
        </div>
      )}

      {load.status === 'ready' && (
        <Card className="mt-6 p-5 sm:p-6">
          <p className="text-[12px] text-muted">
            {load.configured
              ? '已有配置。为避免误改，API Key 不会回填。'
              : '当前还没有配置，保存后 App 即可读取。'}
          </p>

          <form onSubmit={(event) => void handleSubmit(event)} className="mt-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="服务商" htmlFor="provider">
                <select
                  id="provider"
                  value={form.provider}
                  onChange={(event) => {
                    const provider = PROVIDERS.find((item) => item === event.target.value)
                    if (provider) edit({ provider })
                  }}
                  className={inputClass}
                >
                  {PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="模型" htmlFor="model">
                <input
                  id="model"
                  type="text"
                  list="ai-models"
                  value={form.model}
                  onChange={(event) => edit({ model: event.target.value })}
                  placeholder="deepseek-v4.1-flash"
                  spellCheck={false}
                  required
                  className={inputClass}
                />
                <datalist id="ai-models">
                  {models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </Field>

              <Field label="Base URL" htmlFor="baseUrl" className="sm:col-span-2">
                <input
                  id="baseUrl"
                  type="url"
                  value={form.baseUrl}
                  onChange={(event) => edit({ baseUrl: event.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                  spellCheck={false}
                  required
                  className={inputClass}
                />
              </Field>

              <Field label="API Key" htmlFor="apiKey" className="sm:col-span-2">
                <SecretInput
                  id="apiKey"
                  value={form.apiKey}
                  onChange={(value) => edit({ apiKey: value })}
                  placeholder="sk-…"
                />
                <p className="mt-2 rounded-md bg-amber/10 px-2.5 py-2 text-[12px] leading-5 text-ink/80">
                  留空不会保留原 Key：保存会整体覆盖配置，必须重新输入。测试和获取模型可以留空，直接用已保存的
                  Key。
                </p>
              </Field>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <button
                type="submit"
                disabled={saving || probeBusy !== null}
                className={buttonClass}
              >
                {saving ? '保存中…' : '保存配置'}
              </button>
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={saving || probeBusy !== null}
                className={secondaryButtonClass}
              >
                {probeBusy === 'test' ? '测试中…' : '测试连接'}
              </button>
              <button
                type="button"
                onClick={() => void handleFetchModels()}
                disabled={saving || probeBusy !== null}
                className={secondaryButtonClass}
              >
                {probeBusy === 'models' ? '获取中…' : '获取模型'}
              </button>
              {saved && (
                <span role="status" className="inline-flex items-center gap-1.5 text-[13px] text-sent">
                  <Check size={14} aria-hidden="true" />
                  已保存
                </span>
              )}
            </div>

            {probeNote !== null && (
              <p role="status" className="mt-3 text-[13px] text-sent">
                {probeNote}
              </p>
            )}

            {testReply !== null && (
              <p
                role="status"
                className="mt-3 rounded-md border border-sent/25 bg-sent/5 px-2.5 py-2 text-[13px] leading-5 text-sent"
              >
                连接成功 · {testReply}
              </p>
            )}

            {probeError !== null && (
              <p
                role="alert"
                className="mt-3 rounded-md border border-danger/25 bg-danger/5 px-2.5 py-2 text-[12px] leading-5 text-danger"
              >
                {probeError instanceof Error ? probeError.message : '请求失败'}
              </p>
            )}

            {saveError !== null && (
              <div className="mt-4">
                <RequestError error={saveError} onSignOut={signOut} />
              </div>
            )}
          </form>
        </Card>
      )}

      <PasscodeCard token={token} signOut={signOut} />
    </div>
  )
}

/** 口令闸门：改一次，所有装过 App 的手机都会重新要求输入。 */
function PasscodeCard({ token, signOut }: { token: string; signOut: () => void }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [version, setVersion] = useState<number | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const passcode = value.trim()
    if (!passcode) {
      setError(new Error('口令不能为空'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const next = await savePasscode(token, passcode)
      setVersion(next)
      setValue('')
    } catch (failure) {
      setError(failure)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mt-6 p-5 sm:p-6">
      <h2 className="font-serif text-[18px] tracking-tight">App 口令</h2>
      <p className="mt-1.5 text-[13px] leading-6 text-muted">
        App 第一次打开时要输入这个口令，通过后才能拿到上面的 AI 配置。改口令会让所有手机重新要求输入。
      </p>
      <form onSubmit={(event) => void handleSubmit(event)} className="mt-4">
        <Field label="新口令" htmlFor="passcode">
          <SecretInput
            id="passcode"
            value={value}
            onChange={setValue}
            placeholder="至少几位，别用 1234"
          />
        </Field>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className={buttonClass}>
            {saving ? '保存中…' : '更新口令'}
          </button>
          {version !== null && (
            <span role="status" className="inline-flex items-center gap-1.5 text-[13px] text-sent">
              <Check size={14} aria-hidden="true" />
              已更新到第 {version} 版
            </span>
          )}
        </div>
        {error !== null && (
          <div className="mt-4">
            <RequestError error={error} onSignOut={signOut} />
          </div>
        )}
      </form>
    </Card>
  )
}

function Field({
  label,
  htmlFor,
  className = '',
  children,
}: {
  label: string
  htmlFor: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-[12px] font-medium">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}
