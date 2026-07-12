import { attr, displayName, type ScxmlNode } from '../scxml/types';

interface InspectorProps {
  node?: ScxmlNode;
  onChange: (name: string, value: string) => void;
}

const fields: Record<string, Array<[string, string]>> = {
  scxml: [['name', '名称'], ['initial', '初始状态'], ['datamodel', '数据模型'], ['binding', '绑定时机']],
  state: [['id', '状态 ID'], ['initial', '初始子状态']],
  parallel: [['id', '状态 ID']],
  final: [['id', '状态 ID']],
  history: [['id', '状态 ID'], ['type', '历史类型']],
  transition: [['event', '事件'], ['cond', '条件'], ['target', '目标状态'], ['type', '转换类型']],
};

export default function Inspector({ node, onChange }: InspectorProps) {
  if (!node) return <div className="inspector-empty">在画布中选择状态或转换以编辑属性</div>;
  const entries = fields[node.local] || Object.keys(node.attributes).filter((name) => !name.startsWith('xmlns')).map((name) => [name, name] as [string, string]);
  return (
    <div className="inspector" data-testid="inspector">
      <div className="selection-title"><span className={`element-icon ${node.local}`}>{node.local === 'transition' ? '↗' : '◇'}</span><div><small>&lt;{node.local}&gt;</small><strong>{displayName(node)}</strong></div></div>
      {entries.map(([name, label]) => (
        <label key={name}>
          <span>{label}</span>
          <input value={attr(node, name) || ''} onChange={(event) => onChange(name, event.target.value)} spellCheck={false} />
        </label>
      ))}
      <div className="source-position">源代码：第 {node.loc.line} 行，第 {node.loc.column} 列</div>
    </div>
  );
}
