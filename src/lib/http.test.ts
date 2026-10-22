import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement, useState, type ChangeEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultRequest, httpRequestSchema, type HttpRequest } from '@/types';
import { HttpEditor } from '@/components/http-editor';
import { invoke } from '@/lib/bridge';
vi.mock('@/lib/bridge', () => ({ invoke: vi.fn() }));
vi.mock('@/components/select-control', () => ({
  SelectControl: ({
    label,
    value,
    options,
    onValueChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
  }) =>
    createElement(
      'select',
      {
        'aria-label': label,
        value,
        onChange: (event: ChangeEvent<HTMLSelectElement>) =>
          onValueChange(event.target.value),
      },
      options.map((option) =>
        createElement(
          'option',
          { key: option.value, value: option.value },
          option.label,
        ),
      ),
    ),
}));
it('keeps invalid JSON editable and blocks submission without losing the draft', () => {
  function Host() {
    const [value, onChange] = useState<HttpRequest>({
      ...defaultRequest(),
      method: 'POST' as const,
    });
    return createElement(HttpEditor, {
      value,
      onChange,
      secret: '',
      onSecret: () => {},
    });
  }
  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(Host),
    ),
  );
  const body = screen.getByLabelText('JSON 请求内容', {
    exact: false,
  }) as HTMLTextAreaElement;
  fireEvent.change(body, { target: { value: '{"message":' } });
  fireEvent.blur(body);
  expect(body.validity.valid).toBe(false);
  expect(body.value).toBe('{"message":');
  fireEvent.change(body, { target: { value: '{"message":"Ok"}' } });
  fireEvent.blur(body);
  const saved = screen.getByLabelText('JSON 请求内容', {
    exact: false,
  }) as HTMLTextAreaElement;
  expect(saved.validity.valid).toBe(true);
  expect(JSON.parse(saved.value)).toEqual({ message: 'Ok' });
});

it('preserves JSON between body-capable methods and resets bodyless drafts', async () => {
  vi.mocked(invoke).mockResolvedValue({
    status: 200,
    message: 'Ok',
    raw: 'Ok',
  });
  function Host() {
    const [value, onChange] = useState<HttpRequest>({
      ...defaultRequest(),
      url: 'https://example.invalid',
      method: 'POST',
      body: { message: 'Hello' },
    });
    return createElement(HttpEditor, {
      value,
      onChange,
      secret: '',
      onSecret: () => {},
    });
  }
  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(Host),
    ),
  );
  const method = screen.getByRole('combobox', { name: '方法' });
  for (const value of ['PUT', 'PATCH']) {
    fireEvent.change(method, { target: { value } });
    const body = screen.getByLabelText('JSON 请求内容', {
      exact: false,
    }) as HTMLTextAreaElement;
    expect(JSON.parse(body.value)).toEqual({ message: 'Hello' });
    fireEvent.click(screen.getByRole('button', { name: '测试接口' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith('test_http_request', {
        request: expect.objectContaining({
          method: value,
          body: { message: 'Hello' },
        }),
        secret: '',
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '测试接口' }),
      ).not.toBeDisabled(),
    );
  }
  fireEvent.change(method, { target: { value: 'GET' } });
  expect(screen.queryByLabelText('JSON 请求内容', { exact: false })).toBeNull();
  fireEvent.change(method, { target: { value: 'POST' } });
  expect(screen.getByLabelText('JSON 请求内容', { exact: false })).toHaveValue(
    '',
  );
});

it('clears unsaved secrets when the endpoint or authentication type changes', () => {
  const onSecret = vi.fn();
  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(HttpEditor, {
        value: {
          ...defaultRequest(),
          url: 'https://example.invalid',
          auth: { type: 'bearer', credential: 'saved' },
        },
        onChange: () => {},
        secret: 'old-secret',
        onSecret,
      }),
    ),
  );
  fireEvent.change(screen.getByLabelText('请求地址'), {
    target: { value: 'https://other.invalid' },
  });
  expect(onSecret).toHaveBeenLastCalledWith('');
  onSecret.mockClear();
  fireEvent.change(screen.getByRole('combobox', { name: '接口鉴权' }), {
    target: { value: 'basic' },
  });
  expect(onSecret).toHaveBeenCalledWith('');
});

it('passes the JavaScript draft to both HTTP and sample tests', async () => {
  vi.mocked(invoke).mockResolvedValue({
    status: 200,
    message: '你好',
    raw: '{}',
  });
  function Host() {
    const [value, onChange] = useState<HttpRequest>({
      ...defaultRequest(),
      url: 'https://example.invalid',
    });
    return createElement(HttpEditor, {
      value,
      onChange,
      secret: '',
      onSecret: () => {},
    });
  }
  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(Host),
    ),
  );
  const editor = screen.getByRole('textbox', {
    name: /^JavaScript 代码/,
  });
  expect(editor).toHaveValue(
    "return (res || []).map((item) => item.text).join('\\n');",
  );
  expect(screen.queryByLabelText('字段路径')).toBeNull();
  const code = 'return res.data.map((item) => item.message).join("\\n");';
  fireEvent.change(editor, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: '测试接口' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith('test_http_request', {
      request: expect.objectContaining({
        response: { type: 'javascript', code },
      }),
      secret: '',
    }),
  );
  fireEvent.blur(screen.getByLabelText('返回内容样本'), {
    target: { value: '{"data":[]}' },
  });
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith('parse_http_response', {
      raw: '{"data":[]}',
      response: { type: 'javascript', code },
    }),
  );
  expect(
    httpRequestSchema.parse({
      ...defaultRequest(),
      url: 'https://example.invalid',
      response: { type: 'javascript', code },
    }).response,
  ).toEqual({ type: 'javascript', code });
});

it.each([
  {
    status: 200,
    raw: '[{"text":"甲"},{"text":"乙"}]',
    message: '甲\n乙',
    parseError: null,
  },
  {
    status: 200,
    raw: '{"data":[]}',
    message: null,
    parseError: 'JavaScript 处理失败：格式不匹配',
  },
  {
    status: 422,
    raw: '{"error":"参数有误"}',
    message: null,
    parseError: 'HTTP 422，未自动重试',
  },
  { status: 200, raw: 'plain text', message: 'plain text', parseError: null },
  {
    status: 200,
    raw: '{"id":9007199254740993,"key":"first","key":"second"}',
    message: null,
    parseError: '返回值不是数组',
  },
])(
  'shows original data separately from the parsed result: $status $raw',
  async (preview) => {
    vi.mocked(invoke).mockResolvedValue(preview);
    render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(HttpEditor, {
          value: { ...defaultRequest(), url: 'https://example.invalid' },
          onChange: () => {},
          secret: '',
          onSecret: () => {},
        }),
      ),
    );
    for (const name of ['请求地址', /^JavaScript 代码/]) {
      const field = screen.getByRole('textbox', { name });
      expect(field.tagName).toBe('TEXTAREA');
      expect(field).toHaveAttribute('rows', '2');
      expect(field).toHaveClass('resize-y');
    }
    fireEvent.click(screen.getByRole('button', { name: '测试接口' }));
    const raw = await screen.findByRole('textbox', { name: '接口原始返回' });
    expect(raw).toHaveValue(preview.raw);
    expect(raw).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: '解析结果' })).toHaveValue(
      preview.parseError ?? preview.message,
    );
  },
);

it.each([
  ['', 'return res;'],
  ['/data/a~1b/~0key/0', 'return res["data"]["a/b"]["~key"]["0"];'],
  ['/data/quote"', 'return res["data"]["quote\\\""];'],
])(
  'keeps legacy JSON paths editable as JavaScript: %s',
  (pointer, expected) => {
    const response = { type: 'json' as const, pointer };
    const onChange = vi.fn();
    render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(HttpEditor, {
          value: { ...defaultRequest(), response },
          onChange,
          secret: '',
          onSecret: () => {},
        }),
      ),
    );
    expect(screen.getByRole('combobox', { name: '读取返回内容' })).toHaveValue(
      'javascript',
    );
    const editor = screen.getByRole('textbox', {
      name: /^JavaScript 代码/,
    });
    expect(editor).toHaveValue(expected);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(editor, { target: { value: 'return String(res);' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        response: { type: 'javascript', code: 'return String(res);' },
      }),
    );
  },
);
