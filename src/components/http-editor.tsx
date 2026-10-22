import { SelectControl } from '@/components/select-control';
import { Plus, Trash2, FlaskConical } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import type { HttpRequest, Pair } from '@/types';
import { invoke } from '@/lib/bridge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { BusyButton, ErrorMessage, FormField } from './common';
function Pairs({
  value,
  onChange,
  label,
}: {
  value: Pair[];
  onChange: (v: Pair[]) => void;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onChange([...value, { name: '', value: '' }])}
        >
          <Plus />
          添加
        </Button>
      </div>
      {value.map((p, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`${label}名称 ${i + 1}`}
            value={p.name}
            onChange={(e) =>
              onChange(
                value.map((v, j) =>
                  i === j ? { ...v, name: e.target.value } : v,
                ),
              )
            }
          />
          <Input
            aria-label={`${label}值 ${i + 1}`}
            value={p.value}
            onChange={(e) =>
              onChange(
                value.map((v, j) =>
                  i === j ? { ...v, value: e.target.value } : v,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`移除${label} ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
export function HttpEditor({
  value,
  onChange,
  secret,
  onSecret,
  ignore = false,
}: {
  value: HttpRequest;
  onChange: (v: HttpRequest) => void;
  secret: string;
  onSecret: (s: string) => void;
  ignore?: boolean;
}) {
  const [preview, setPreview] = useState<{
    status: number;
    message: string | null;
    raw: string;
    parseError?: string;
  } | null>(null);
  const test = useMutation({
    mutationFn: () =>
      invoke<NonNullable<typeof preview>>('test_http_request', {
        request: value,
        secret,
      }),
    onSuccess: setPreview,
  });
  const set = (v: Partial<HttpRequest>) => onChange({ ...value, ...v });
  return (
    <div className="bg-muted/40 space-y-4 rounded-lg border p-4">
      <div className="grid grid-cols-4 gap-3">
        <FormField label="方法">
          <SelectControl
            label="方法"
            value={value.method}
            options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({
              value,
              label: value,
            }))}
            onValueChange={(method) =>
              set({
                method: method as HttpRequest['method'],
                body: ['GET', 'DELETE'].includes(method) ? null : value.body,
              })
            }
          />
        </FormField>
        <div className="col-span-3">
          <FormField label="请求地址">
            <Input
              type="url"
              placeholder="https://example.com/api/message"
              value={value.url}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => {
                const url = e.target.value;
                onSecret('');
                set({
                  url,
                  auth:
                    value.auth.type === 'none'
                      ? value.auth
                      : { ...value.auth, credential: '' },
                });
              }}
            />
          </FormField>
        </div>
      </div>
      <Pairs
        label="查询参数"
        value={value.query}
        onChange={(query) => set({ query })}
      />
      <Pairs
        label="请求头"
        value={value.headers}
        onChange={(headers) => set({ headers })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="接口鉴权">
          <SelectControl
            label="接口鉴权"
            value={value.auth.type}
            options={[
              { value: 'none', label: '无需鉴权' },
              { value: 'bearer', label: 'Bearer Token' },
              { value: 'basic', label: '用户名和密码' },
              { value: 'api_key', label: 'API Key' },
            ]}
            onValueChange={(type) => {
              onSecret('');
              if (type === 'none') set({ auth: { type } });
              if (type === 'bearer') set({ auth: { type, credential: '' } });
              if (type === 'basic')
                set({ auth: { type, credential: '', username: '' } });
              if (type === 'api_key')
                set({
                  auth: {
                    type,
                    credential: '',
                    name: 'X-API-Key',
                    location: 'header',
                  },
                });
            }}
          />
        </FormField>
        {value.auth.type !== 'none' && (
          <FormField
            label={value.auth.type === 'basic' ? '密码' : 'Token / API Key'}
          >
            <Input
              type="password"
              autoComplete="off"
              value={secret}
              placeholder={
                value.auth.credential
                  ? '已保存，留空保留'
                  : '输入后保存在系统凭据库'
              }
              onChange={(e) => onSecret(e.target.value)}
            />
          </FormField>
        )}
      </div>
      {value.auth.type === 'basic' && (
        <FormField label="用户名">
          <Input
            value={value.auth.username}
            onChange={(e) =>
              set({
                auth: {
                  ...value.auth,
                  type: 'basic',
                  username: e.target.value,
                  credential:
                    value.auth.type === 'none' ? '' : value.auth.credential,
                },
              })
            }
          />
        </FormField>
      )}
      {value.auth.type === 'api_key' && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Key 名称">
            <Input
              value={value.auth.name}
              onChange={(e) =>
                set({
                  auth: {
                    ...value.auth,
                    type: 'api_key',
                    name: e.target.value,
                    location:
                      value.auth.type === 'api_key'
                        ? value.auth.location
                        : 'header',
                    credential:
                      value.auth.type === 'none' ? '' : value.auth.credential,
                  },
                })
              }
            />
          </FormField>
          <FormField label="放置位置">
            <SelectControl
              label="放置位置"
              value={value.auth.location}
              options={[
                { value: 'header', label: '请求头' },
                { value: 'query', label: '查询参数' },
              ]}
              onValueChange={(location) => {
                if (value.auth.type === 'api_key')
                  set({
                    auth: {
                      ...value.auth,
                      location: location as 'header' | 'query',
                    },
                  });
              }}
            />
          </FormField>
        </div>
      )}
      {!['GET', 'DELETE'].includes(value.method) && (
        <FormField
          label="JSON 请求内容"
          hint="可使用 {{recipient.title}}、{{run.mode}} 等变量。"
        >
          <Textarea
            key={JSON.stringify(value.body)}
            name="body"
            rows={3}
            defaultValue={
              value.body == null ? '' : JSON.stringify(value.body, null, 2)
            }
            onBlur={(e) => {
              try {
                set({
                  body: e.target.value.trim()
                    ? JSON.parse(e.target.value)
                    : null,
                });
                e.target.setCustomValidity('');
              } catch {
                e.target.setCustomValidity('请输入有效 JSON');
                e.target.reportValidity();
              }
            }}
          />
        </FormField>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="读取返回内容">
          <SelectControl
            label="读取返回内容"
            value={value.response.type}
            options={[
              { value: 'text', label: '全文文字' },
              { value: 'json', label: '提取 JSON 字段' },
              ...(ignore ? [{ value: 'ignore', label: '忽略正文' }] : []),
            ]}
            onValueChange={(type) =>
              set({
                response:
                  type === 'json'
                    ? { type: 'json', pointer: '/data/message' }
                    : { type: type as 'text' | 'ignore' },
              })
            }
          />
        </FormField>
        {value.response.type === 'json' && (
          <FormField label="字段路径">
            <Input
              value={value.response.pointer}
              placeholder="/data/message"
              spellCheck={false}
              onChange={(e) =>
                set({ response: { type: 'json', pointer: e.target.value } })
              }
            />
          </FormField>
        )}
        <FormField label="请求超时（秒）">
          <Input
            type="number"
            min={5}
            max={120}
            value={value.timeoutSeconds}
            onChange={(e) => set({ timeoutSeconds: Number(e.target.value) })}
          />
        </FormField>
      </div>
      <ErrorMessage error={test.error} />
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          测试只请求接口，不操作手机。
        </p>
        <BusyButton
          type="button"
          variant="outline"
          size="sm"
          busy={test.isPending}
          onClick={() => test.mutate()}
        >
          <FlaskConical />
          测试接口
        </BusyButton>
      </div>
      {preview && (
        <div className="bg-card rounded-md border p-3 text-xs">
          <p className="mb-2 font-medium">
            HTTP {preview.status} ·{' '}
            {preview.parseError ? '解析失败' : '解析完成'}
          </p>
          <pre className="max-h-48 overflow-auto break-words whitespace-pre-wrap">
            {preview.parseError ?? preview.message ?? preview.raw}
          </pre>
        </div>
      )}
      <details className="text-muted-foreground text-xs">
        <summary>用样本检查解析路径</summary>
        <Textarea
          className="mt-2"
          aria-label="JSON 解析样本"
          placeholder={'{"data":{"message":"Ok"}}'}
          onBlur={(e) => {
            if (!e.target.value) return;
            void invoke<unknown>('parse_http_response', {
              raw: e.target.value,
              response: value.response,
            })
              .then((v) => toast.success(`解析结果：${String(v)}`))
              .catch((err) => toast.error(String(err)));
          }}
        />
      </details>
    </div>
  );
}
