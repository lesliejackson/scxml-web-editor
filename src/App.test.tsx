import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="SCXML source" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

describe('editing feedback', () => {
  it('reports SCXML errors immediately while editing', async () => {
    render(<App />);
    expect(screen.getByTestId('validation-status')).toHaveTextContent('SCXML 检查通过');
    fireEvent.change(screen.getByLabelText('SCXML source'), {
      target: { value: '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0"><state id="a"><transition target="missing"/></state></scxml>' },
    });
    await waitFor(() => expect(screen.getByTestId('validation-status')).toHaveTextContent('1 个标准错误'));
  });

  it('keeps the last valid visualization during incomplete XML edits', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('SCXML source'), { target: { value: '<scxml>' } });
    expect(screen.getByText('XML 尚未完整：画布暂时显示上一次有效结果')).toBeInTheDocument();
    expect(screen.getByTestId('diagram').querySelectorAll('.state-node').length).toBeGreaterThan(0);
  });

  it('switches between dark and light themes and persists the choice', () => {
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: '☀ 浅色模式' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('scxml-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: '🌙 深色模式' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('scxml-theme')).toBe('dark');
  });

  it('collapses the bottom panel with the toggle and reopens it via tabs', () => {
    render(<App />);
    expect(screen.getByLabelText('SCXML source')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起底部面板' }));
    expect(screen.queryByLabelText('SCXML source')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'SCXML 源码' }));
    expect(screen.getByLabelText('SCXML source')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起底部面板' })).toBeInTheDocument();
  });

  it('defaults to focused edges and allows showing every transition', () => {
    render(<App />);
    expect(screen.getByTestId('diagram').querySelectorAll('.transition')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '显示当前层全部连线' }));
    expect(screen.getByTestId('diagram').querySelectorAll('.transition').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '聚焦连线' })).toBeInTheDocument();
  });
});
