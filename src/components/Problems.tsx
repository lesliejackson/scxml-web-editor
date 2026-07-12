import type { Diagnostic } from '../scxml/types';

interface ProblemsProps {
  diagnostics: Diagnostic[];
  onSelect: (diagnostic: Diagnostic) => void;
}

export default function Problems({ diagnostics, onSelect }: ProblemsProps) {
  return (
    <div className="problems" data-testid="problems">
      <div className="panel-heading">
        <span>问题</span>
        <span className={`count ${diagnostics.some((item) => item.severity === 'error') ? 'has-errors' : ''}`}>
          {diagnostics.filter((item) => item.severity === 'error').length} 错误 · {diagnostics.filter((item) => item.severity === 'warning').length} 警告
        </span>
      </div>
      <div className="problem-list">
        {!diagnostics.length && <div className="all-good"><span>✓</span> 文档符合当前 SCXML 检查规则</div>}
        {diagnostics.map((item, index) => (
          <button type="button" className={`problem ${item.severity}`} key={`${item.code}-${item.loc.offset}-${index}`} onClick={() => onSelect(item)}>
            <span className="problem-icon">{item.severity === 'error' ? '×' : item.severity === 'warning' ? '!' : 'i'}</span>
            <span className="problem-message">{item.message}<small>{item.code}</small></span>
            <span className="problem-location">{item.loc.line}:{item.loc.column}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
