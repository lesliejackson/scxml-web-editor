import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import Diagram from './components/Diagram';
import Inspector from './components/Inspector';
import Problems from './components/Problems';
import { updateAttribute } from './scxml/editor';
import { defaultScxml } from './scxml/sample';
import { analyzeScxml } from './scxml/validator';
import { attr, childStates, displayName, scxmlChildren, type Diagnostic, type ScxmlNode } from './scxml/types';

type BottomTab = 'source' | 'problems';

function findNode(root: ScxmlNode | undefined, uid: string | undefined): ScxmlNode | undefined {
  if (!root || !uid) return undefined;
  if (root.uid === uid) return root;
  for (const child of root.children) {
    const found = findNode(child, uid);
    if (found) return found;
  }
}

function nodeKey(node: ScxmlNode) {
  return attr(node, 'id') || node.uid;
}

function findStateByKey(root: ScxmlNode | undefined, key: string | undefined): ScxmlNode | undefined {
  if (!root || !key) return undefined;
  if (nodeKey(root) === key) return root;
  for (const child of root.children) {
    const found = findStateByKey(child, key);
    if (found) return found;
  }
}

function nearestStateParent(node: ScxmlNode): ScxmlNode | undefined {
  let current = node.parent;
  while (current && current.local !== 'scxml' && !['state', 'parallel'].includes(current.local)) current = current.parent;
  return current;
}

function OutlineNode({ node, selectedUid, onSelect }: { node: ScxmlNode; selectedUid?: string; onSelect: (node: ScxmlNode) => void }) {
  const children = [...childStates(node), ...scxmlChildren(node, 'history')];
  return (
    <li>
      <button type="button" className={selectedUid === node.uid ? 'active' : ''} onClick={() => onSelect(node)}>
        <span className={`tree-icon ${node.local}`}>{node.local === 'final' ? '●' : node.local === 'parallel' ? 'Ⅱ' : node.local === 'history' ? 'H' : '◇'}</span>
        <span>{displayName(node)}</span>
      </button>
      {!!children.length && <ul>{children.map((child) => <OutlineNode key={child.uid} node={child} selectedUid={selectedUid} onSelect={onSelect} />)}</ul>}
    </li>
  );
}

export default function App() {
  const [source, setSource] = useState(defaultScxml);
  const [fileName, setFileName] = useState('order-flow.scxml');
  const [selectedUid, setSelectedUid] = useState<string>();
  const [bottomTab, setBottomTab] = useState<BottomTab>('source');
  const [dirty, setDirty] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('theme');
    if (fromUrl === 'light' || fromUrl === 'dark') return fromUrl;
    return localStorage.getItem('scxml-theme') === 'light' ? 'light' : 'dark';
  });
  const [showAllTransitions, setShowAllTransitions] = useState(() => new URLSearchParams(window.location.search).get('edges') === 'all');
  const [scopeKey, setScopeKey] = useState<string | undefined>(() => new URLSearchParams(window.location.search).get('scope') || undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | undefined>(undefined);
  const monacoRef = useRef<Monaco | undefined>(undefined);
  const lastValidRoot = useRef<ScxmlNode | undefined>(undefined);

  const analysis = useMemo(() => analyzeScxml(source), [source]);
  const syntaxBroken = analysis.diagnostics.some((item) => item.code === 'xml.syntax');
  if (analysis.root && !syntaxBroken) lastValidRoot.current = analysis.root;
  const visualRoot = syntaxBroken ? lastValidRoot.current : analysis.root;
  const scope = findStateByKey(visualRoot, scopeKey);
  const selected = findNode(visualRoot, selectedUid);
  const errors = analysis.diagnostics.filter((item) => item.severity === 'error');
  const invalidUids = useMemo(() => new Set(analysis.diagnostics.map((item) => item.nodeUid).filter((uid): uid is string => Boolean(uid))), [analysis.diagnostics]);

  useEffect(() => {
    if (scopeKey || !visualRoot) return;
    const roots = childStates(visualRoot);
    if (roots.length === 1 && childStates(roots[0]).length) setScopeKey(nodeKey(roots[0]));
  }, [scopeKey, visualRoot]);

  const breadcrumbs = useMemo(() => {
    if (!visualRoot || !scope) return [] as ScxmlNode[];
    const result: ScxmlNode[] = [];
    let current: ScxmlNode | undefined = scope;
    while (current && current !== visualRoot) {
      result.unshift(current);
      current = nearestStateParent(current);
    }
    return result;
  }, [visualRoot, scope]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('scxml-theme', theme);
    monacoRef.current?.editor.setTheme(theme === 'light' ? 'scxml-day' : 'scxml-night');
  }, [theme]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const editorInstance = editorRef.current;
    if (!monaco || !editorInstance) return;
    monaco.editor.setModelMarkers(editorInstance.getModel()!, 'scxml', analysis.diagnostics.map((item) => ({
      severity: item.severity === 'error' ? monaco.MarkerSeverity.Error : item.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
      message: `[${item.code}] ${item.message}`,
      startLineNumber: item.loc.line,
      startColumn: item.loc.column,
      endLineNumber: item.loc.endLine || item.loc.line,
      endColumn: item.loc.endColumn || Math.max(item.loc.column + 1, 2),
    })));
  }, [analysis.diagnostics]);

  const handleMount: OnMount = (instance, monaco) => {
    editorRef.current = instance;
    monacoRef.current = monaco;
    monaco.editor.defineTheme('scxml-night', {
      base: 'vs-dark', inherit: true,
      rules: [{ token: 'tag', foreground: '7DD3FC' }, { token: 'attribute.name', foreground: 'C4B5FD' }, { token: 'attribute.value', foreground: '86EFAC' }],
      colors: { 'editor.background': '#0d1222', 'editorLineNumber.foreground': '#46516c', 'editor.lineHighlightBackground': '#151c30' },
    });
    monaco.editor.defineTheme('scxml-day', {
      base: 'vs', inherit: true,
      rules: [{ token: 'tag', foreground: '0369A1' }, { token: 'attribute.name', foreground: '7C3AED' }, { token: 'attribute.value', foreground: '15803D' }],
      colors: { 'editor.background': '#ffffff', 'editorLineNumber.foreground': '#9aa8bd', 'editor.lineHighlightBackground': '#f1f5fa' },
    });
    monaco.editor.setTheme(document.documentElement.dataset.theme === 'light' ? 'scxml-day' : 'scxml-night');
  };

  const selectNode = useCallback((node: ScxmlNode) => {
    setSelectedUid(node.uid);
  }, []);

  const selectOutlineNode = useCallback((node: ScxmlNode) => {
    setSelectedUid(node.uid);
    const parent = nearestStateParent(node);
    setScopeKey(parent?.local === 'scxml' ? undefined : parent ? nodeKey(parent) : undefined);
  }, []);

  const enterNode = useCallback((node: ScxmlNode) => {
    setScopeKey(nodeKey(node));
    setSelectedUid(undefined);
    setShowAllTransitions(false);
  }, []);

  const locate = (diagnostic: Diagnostic) => {
    setBottomTab('source');
    setBottomOpen(true);
    requestAnimationFrame(() => {
      editorRef.current?.revealLineInCenter(diagnostic.loc.line);
      editorRef.current?.setPosition({ lineNumber: diagnostic.loc.line, column: diagnostic.loc.column });
      editorRef.current?.focus();
    });
  };

  const onSourceChange = (value: string | undefined) => {
    setSource(value || '');
    setDirty(true);
  };

  const onPropertyChange = (name: string, value: string) => {
    if (!selected) return;
    const identity = attr(selected, 'id');
    const next = updateAttribute(source, selected, name, value);
    setSource(next);
    setDirty(true);
    requestAnimationFrame(() => {
      const nextAnalysis = analyzeScxml(next);
      const match = identity
        ? (() => { const walk = (node?: ScxmlNode): ScxmlNode | undefined => node && (attr(node, 'id') === (name === 'id' ? value : identity) ? node : node.children.map(walk).find(Boolean)); return walk(nextAnalysis.root); })()
        : nextAnalysis.root;
      if (match) setSelectedUid(match.uid);
    });
  };

  const saveFile = () => {
    const blob = new Blob([source], { type: 'application/scxml+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName.endsWith('.scxml') ? fileName : `${fileName}.scxml`;
    anchor.click();
    URL.revokeObjectURL(url);
    setDirty(false);
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    setSource(await file.text());
    setFileName(file.name);
    setDirty(false);
    setSelectedUid(undefined);
    setScopeKey(undefined);
  };

  const newFile = () => {
    setSource(`<?xml version="1.0" encoding="UTF-8"?>\n<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null" initial="start">\n  <state id="start"/>\n</scxml>\n`);
    setFileName('untitled.scxml');
    setDirty(false);
    setSelectedUid(undefined);
    setScopeKey(undefined);
  };

  return (
    <div className={`app-shell ${bottomOpen ? '' : 'bottom-closed'}`}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span><div><strong>SCXML Studio</strong><small>W3C STATECHART WORKBENCH</small></div></div>
        <div className="document-name"><span className="file-symbol">◇</span>{fileName}{dirty && <span className="dirty">●</span>}</div>
        <div className={`validation-pill ${errors.length ? 'invalid' : 'valid'}`} data-testid="validation-status">
          <span>{errors.length ? '×' : '✓'}</span>{errors.length ? `${errors.length} 个标准错误` : 'SCXML 检查通过'}
        </div>
        <div className="toolbar">
          <button type="button" onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}>{theme === 'dark' ? '☀ 浅色模式' : '🌙 深色模式'}</button>
          <button type="button" onClick={newFile}>新建</button>
          <button type="button" onClick={() => inputRef.current?.click()}>打开</button>
          <button type="button" className="primary" onClick={saveFile}>保存 SCXML</button>
          <input ref={inputRef} hidden type="file" accept=".scxml,.xml,application/scxml+xml,text/xml" onChange={(event) => loadFile(event.target.files?.[0])} />
        </div>
      </header>

      <main className={`workspace ${leftOpen ? '' : 'left-closed'} ${rightOpen ? '' : 'right-closed'}`}>
        <aside className="sidebar left-sidebar">
          <div className="panel-heading"><span>状态结构</span><button type="button" title="收起" onClick={() => setLeftOpen(false)}>‹</button></div>
          <div className="machine-meta"><small>STATE MACHINE</small><strong>{analysis.root ? attr(analysis.root, 'name') || fileName : fileName}</strong></div>
          <ul className="outline">
            {visualRoot && childStates(visualRoot).map((node) => <OutlineNode key={node.uid} node={node} selectedUid={selectedUid} onSelect={selectOutlineNode} />)}
          </ul>
          <div className="legend"><small>SCXML 图例</small><span><i className="legend-state" />状态</span><span><i className="legend-parallel" />并行状态</span><span><i className="legend-final" />终态</span></div>
        </aside>
        {!leftOpen && <button type="button" className="reopen reopen-left" onClick={() => setLeftOpen(true)}>›</button>}

        <section className="canvas-panel">
          <div className="canvas-title"><div className="diagram-breadcrumb"><button type="button" className={!scope ? 'current' : ''} onClick={() => { setScopeKey(undefined); setSelectedUid(undefined); }}>根</button>{breadcrumbs.map((node, index) => <span key={node.uid}><i>›</i><button type="button" className={index === breadcrumbs.length - 1 ? 'current' : ''} onClick={() => { setScopeKey(nodeKey(node)); setSelectedUid(undefined); }}>{displayName(node)}</button></span>)}</div><div className="canvas-actions"><button type="button" className={showAllTransitions ? 'active' : ''} onClick={() => setShowAllTransitions((value) => !value)}>{showAllTransitions ? '聚焦连线' : '显示当前层全部连线'}</button><div className="canvas-hint">双击复合状态进入</div></div></div>
          {syntaxBroken && <div className="stale-banner">XML 尚未完整：画布暂时显示上一次有效结果</div>}
          <Diagram root={visualRoot} scope={scope} selectedUid={selectedUid} invalidUids={invalidUids} onSelect={selectNode} onEnter={enterNode} showAllTransitions={showAllTransitions} />
        </section>

        <aside className="sidebar right-sidebar">
          <div className="panel-heading"><span>属性检查器</span><button type="button" title="收起" onClick={() => setRightOpen(false)}>›</button></div>
          <Inspector node={selected} onChange={onPropertyChange} />
          <div className="standard-note"><span>i</span><p><strong>标准模式</strong>属性修改会立即经过 SCXML 语义校验；错误不会被隐藏。</p></div>
        </aside>
        {!rightOpen && <button type="button" className="reopen reopen-right" onClick={() => setRightOpen(true)}>‹</button>}
      </main>

      <section className="bottom-panel">
        <div className="bottom-tabs">
          <button type="button" className={bottomTab === 'source' && bottomOpen ? 'active' : ''} onClick={() => { setBottomTab('source'); setBottomOpen(true); }}>SCXML 源码</button>
          <button type="button" className={bottomTab === 'problems' && bottomOpen ? 'active' : ''} onClick={() => { setBottomTab('problems'); setBottomOpen(true); }}>问题 <b>{analysis.diagnostics.length}</b></button>
          <span className="schema-label">SCXML 1.0 · 实时校验</span>
          <button type="button" className="bottom-toggle" aria-label={bottomOpen ? '收起底部面板' : '展开底部面板'} title={bottomOpen ? '收起底部面板' : '展开底部面板'} onClick={() => setBottomOpen((value) => !value)}>{bottomOpen ? '⌄' : '⌃'}</button>
        </div>
        {bottomOpen && <div className={`bottom-content ${bottomTab}`}>
          {bottomTab === 'source' ? (
            <Editor height="100%" language="xml" value={source} onChange={onSourceChange} onMount={handleMount} options={{ minimap: { enabled: false }, fontSize: 13, fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace", lineHeight: 21, automaticLayout: true, wordWrap: 'off', scrollBeyondLastLine: false, renderValidationDecorations: 'on', tabSize: 2 }} />
          ) : <Problems diagnostics={analysis.diagnostics} onSelect={locate} />}
        </div>}
      </section>
    </div>
  );
}
