import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { parseScxml } from './scxml/parser';

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

  it('adds a new state to the current diagram level', async () => {
    render(<App />);
    const initialCount = screen.getByTestId('diagram').querySelectorAll('.state-node').length;
    fireEvent.click(screen.getByRole('button', { name: /新增状态/ }));
    expect(screen.getByRole('dialog', { name: '新增状态' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('状态 ID'), { target: { value: 'newState' } });
    fireEvent.click(screen.getByRole('button', { name: '添加状态' }));

    await waitFor(() => expect((screen.getByLabelText('SCXML source') as HTMLTextAreaElement).value).toContain('<state id="newState"/>'));
    expect(screen.getByTestId('diagram').querySelectorAll('.state-node')).toHaveLength(initialCount + 1);
    expect(screen.getAllByText('newState').length).toBeGreaterThan(0);
  });

  it('adds a child to the compound state shown on the canvas', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('SCXML source'), {
      target: { value: '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="parent">\n  <state id="parent" initial="child">\n    <state id="child"/>\n  </state>\n</scxml>' },
    });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'parent' }).length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole('button', { name: /新增状态/ }));
    expect(screen.getByText('parent', { selector: '.add-state-parent strong' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('状态 ID'), { target: { value: 'nested' } });
    fireEvent.click(screen.getByRole('button', { name: '添加状态' }));

    const nextSource = (screen.getByLabelText('SCXML source') as HTMLTextAreaElement).value;
    const parent = parseScxml(nextSource).root!.children[0];
    expect(parent.children.some((node) => node.attributes.id?.value === 'nested')).toBe(true);
  });

  it('adds a compound state with a valid initial child', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /新增状态/ }));
    fireEvent.change(screen.getByLabelText('状态类型'), { target: { value: 'compound' } });
    fireEvent.change(screen.getByLabelText('状态 ID'), { target: { value: 'workflow' } });
    fireEvent.change(screen.getByLabelText('初始子状态 ID'), { target: { value: 'workflowStart' } });
    fireEvent.click(screen.getByRole('button', { name: '添加状态' }));

    await waitFor(() => expect((screen.getByLabelText('SCXML source') as HTMLTextAreaElement).value).toContain('id="workflow" initial="workflowStart"'));
    const nextRoot = parseScxml((screen.getByLabelText('SCXML source') as HTMLTextAreaElement).value).root!;
    const compound = nextRoot.children.find((node) => node.attributes.id?.value === 'workflow')!;
    expect(compound.children.some((node) => node.attributes.id?.value === 'workflowStart')).toBe(true);
    expect(screen.getByTestId('validation-status')).toHaveTextContent('SCXML 检查通过');
  });

  it('adds a transition from the selected state and shows the new edge', async () => {
    render(<App />);
    const idleNode = [...screen.getByTestId('diagram').querySelectorAll<SVGGElement>('.state-node')]
      .find((node) => node.textContent?.includes('idle'))!;
    fireEvent.click(idleNode);
    fireEvent.click(screen.getByRole('button', { name: /新增 Transition/ }));
    expect(screen.getByRole('dialog', { name: '新增 Transition' })).toBeInTheDocument();
    expect(screen.getByText('idle', { selector: '.add-state-parent strong' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('目标状态'), { target: { value: 'cancelled' } });
    fireEvent.change(screen.getByLabelText('转换事件'), { target: { value: 'cancel' } });
    fireEvent.change(screen.getByLabelText('转换条件'), { target: { value: 'isApproved' } });
    fireEvent.change(screen.getByLabelText('转换类型'), { target: { value: 'external' } });
    fireEvent.click(screen.getByRole('button', { name: '添加 Transition' }));

    await waitFor(() => expect((screen.getByLabelText('SCXML source') as HTMLTextAreaElement).value).toContain('<transition event="cancel" cond="isApproved" target="cancelled" type="external"/>'));
    expect(screen.getByTestId('diagram').querySelectorAll('.transition').length).toBeGreaterThan(0);
    expect(screen.getByTestId('inspector')).toHaveTextContent('<transition>');
  });

  it('rejects a duplicate state ID before changing the source', () => {
    render(<App />);
    const originalSource = (screen.getByLabelText('SCXML source') as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole('button', { name: /新增状态/ }));
    fireEvent.change(screen.getByLabelText('状态 ID'), { target: { value: 'idle' } });
    fireEvent.click(screen.getByRole('button', { name: '添加状态' }));

    expect(screen.getByRole('alert')).toHaveTextContent('ID “idle”已存在');
    expect(screen.getByLabelText('SCXML source')).toHaveValue(originalSource);
  });
});
