import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement, useState, type ChangeEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultRequest, type HttpRequest } from '@/types';
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
