import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  attr,
  childStates,
  displayName,
  scxmlChildren,
  stateElements,
  type ScxmlNode,
} from '../scxml/types';

interface DiagramProps {
  root?: ScxmlNode;
  scope?: ScxmlNode;
  selectedUid?: string;
  invalidUids: Set<string>;
  onSelect: (node: ScxmlNode) => void;
  onEnter?: (node: ScxmlNode) => void;
  showAllTransitions?: boolean;
}

interface Box {
  node: ScxmlNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EdgeGroup {
  key: string;
  source: Box;
  target: Box;
  transitions: ScxmlNode[];
  /** 与 transitions 一一对应的真实目标 id（可能各不相同，落在同一可见状态内部）。 */
  targetIds: string[];
  directCount: number;
  liftedFrom: string[];
  /** 转换实际定义在选中状态的哪些祖先上（SCXML 中祖先的转换对活动子状态生效）。 */
  inheritedFrom: string[];
}

const STATE_WIDTH = 188;
const STATE_HEIGHT = 92;
const COLUMN_GAP = 82;
const ROW_GAP = 72;
const MARGIN_X = 74;
const MARGIN_Y = 86;

function allNodes(root: ScxmlNode) {
  const result: ScxmlNode[] = [];
  const visit = (node: ScxmlNode) => {
    result.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return result;
}

function stateParent(node: ScxmlNode | undefined): ScxmlNode | undefined {
  let current = node?.parent;
  while (current && current.local !== 'scxml' && !stateElements.has(current.local)) current = current.parent;
  return current;
}

function directChildFor(target: ScxmlNode, scope: ScxmlNode): ScxmlNode | undefined {
  let current: ScxmlNode | undefined = target;
  while (current && stateParent(current) !== scope) current = stateParent(current);
  return current;
}

function summarize(transitions: ScxmlNode[], targetIds: string[]) {
  const events = transitions.flatMap((transition) => (attr(transition, 'event') || '').split(/\s+/).filter(Boolean));
  const unique = [...new Set(events)];
  const first = unique[0] || 'always';
  const suffix = unique.length > 1 ? ` +${unique.length - 1}` : '';
  const targetCount = new Set(targetIds).size;
  const transitionSuffix = transitions.length > 1
    ? ` · ${transitions.length} 条${targetCount > 1 ? ` ${targetCount} 目标` : ''}`
    : '';
  return `${first}${suffix}${transitionSuffix}`;
}

function fullDescription(transitions: ScxmlNode[], targetIds: string[]) {
  const uniqueTargets = [...new Set(targetIds)];
  const lines = transitions.map((transition, index) => {
    const condition = attr(transition, 'cond');
    const base = `${attr(transition, 'event') || 'always'}${condition ? ` [${condition}]` : ''}`;
    return uniqueTargets.length > 1 ? `${base} → ${targetIds[index]}` : base;
  });
  return uniqueTargets.length > 1 ? lines.join('\n') : `${lines.join('\n')} → ${uniqueTargets[0] ?? '—'}`;
}

function labelWidthFor(text: string) {
  let width = 18;
  for (const character of text) width += character.charCodeAt(0) > 0xff ? 9.5 : 5.2;
  return Math.max(48, Math.round(width));
}

interface NodeSpec {
  node: ScxmlNode;
  width: number;
  height: number;
}

interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  columns: number;
  rows: number;
}

/**
 * 分层布局：从初始状态出发做 DFS 去掉回边，再按最长路径分层，
 * 让转换流向自然地从左向右阅读；层内用一次重心排序减少连线交叉。
 * 没有任何本层连线时返回 undefined，调用方回退到紧凑网格。
 */
function layeredLayout(specs: NodeSpec[], links: Array<[string, string]>, preferredRoots: Set<string>): LayoutResult | undefined {
  const forward = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const connected = new Set<string>();
  const seen = new Set<string>();
  links.forEach(([from, to]) => {
    if (from === to) return;
    const pair = `${from}:${to}`;
    if (seen.has(pair)) return;
    seen.add(pair);
    forward.set(from, [...(forward.get(from) || []), to]);
    incoming.set(to, [...(incoming.get(to) || []), from]);
    connected.add(from);
    connected.add(to);
  });
  if (!connected.size) return undefined;

  const documentOrder = specs.map((spec) => spec.node.uid);
  const startOrder = [
    ...documentOrder.filter((uid) => preferredRoots.has(uid) && connected.has(uid)),
    ...documentOrder.filter((uid) => !preferredRoots.has(uid) && connected.has(uid)),
  ];

  const visitState = new Map<string, 1 | 2>();
  const dagChildren = new Map<string, string[]>([...connected].map((uid) => [uid, []]));
  const dagIndegree = new Map<string, number>([...connected].map((uid) => [uid, 0]));
  const visit = (uid: string) => {
    visitState.set(uid, 1);
    (forward.get(uid) || []).forEach((next) => {
      if (visitState.get(next) === 1) return; // 回边：忽略以保持无环
      dagChildren.get(uid)!.push(next);
      dagIndegree.set(next, dagIndegree.get(next)! + 1);
      if (!visitState.has(next)) visit(next);
    });
    visitState.set(uid, 2);
  };
  startOrder.forEach((uid) => { if (!visitState.has(uid)) visit(uid); });

  const rank = new Map<string, number>([...connected].map((uid) => [uid, 0]));
  const queue = startOrder.filter((uid) => dagIndegree.get(uid) === 0);
  for (let index = 0; index < queue.length; index += 1) {
    const uid = queue[index];
    dagChildren.get(uid)!.forEach((next) => {
      rank.set(next, Math.max(rank.get(next)!, rank.get(uid)! + 1));
      const remaining = dagIndegree.get(next)! - 1;
      dagIndegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    });
  }

  const byRank: string[][] = [];
  documentOrder.filter((uid) => connected.has(uid)).forEach((uid) => {
    const level = rank.get(uid)!;
    (byRank[level] ||= []).push(uid);
  });
  for (let level = 1; level < byRank.length; level += 1) {
    const previousRow = new Map((byRank[level - 1] || []).map((uid, row) => [uid, row]));
    byRank[level] = byRank[level]
      .map((uid, row) => {
        const anchors = (incoming.get(uid) || []).map((from) => previousRow.get(from)).filter((value): value is number => value !== undefined);
        return { uid, key: anchors.length ? anchors.reduce((sum, value) => sum + value, 0) / anchors.length : row };
      })
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.uid);
  }

  const connectedRows = Math.max(1, ...byRank.map((level) => level.length));
  const isolated = documentOrder.filter((uid) => !connected.has(uid));
  const isolatedRows = Math.max(connectedRows, Math.min(3, isolated.length));
  const isolatedStart = byRank.length;

  const slotWidth = STATE_WIDTH + COLUMN_GAP;
  const slotHeight = STATE_HEIGHT + ROW_GAP;
  const rows = Math.max(connectedRows, Math.min(isolatedRows, isolated.length));
  const specByUid = new Map(specs.map((spec) => [spec.node.uid, spec]));
  const positions = new Map<string, { x: number; y: number }>();
  const place = (uid: string, column: number, row: number, columnCount: number) => {
    const spec = specByUid.get(uid)!;
    positions.set(uid, {
      x: MARGIN_X + column * slotWidth + (STATE_WIDTH - spec.width) / 2,
      y: MARGIN_Y + ((rows - columnCount) * slotHeight) / 2 + row * slotHeight + (STATE_HEIGHT - spec.height) / 2,
    });
  };
  byRank.forEach((level, column) => level.forEach((uid, row) => place(uid, column, row, level.length)));
  isolated.forEach((uid, index) => {
    const column = isolatedStart + Math.floor(index / isolatedRows);
    const row = index % isolatedRows;
    place(uid, column, row, Math.min(isolatedRows, isolated.length - Math.floor(index / isolatedRows) * isolatedRows));
  });

  return {
    positions,
    columns: isolatedStart + (isolated.length ? Math.ceil(isolated.length / isolatedRows) : 0),
    rows,
  };
}

export default function Diagram({
  root,
  scope,
  selectedUid,
  invalidUids,
  onSelect,
  onEnter,
  showAllTransitions = false,
}: DiagramProps) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingUid, setDraggingUid] = useState<string>();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportObserverRef = useRef<ResizeObserver | undefined>(undefined);
  // 跟踪滚动容器的可视尺寸，让画布至少铺满可视区域（例如底部面板收起后多出的空间）。
  const attachScroll = useCallback((element: HTMLDivElement | null) => {
    viewportObserverRef.current?.disconnect();
    viewportObserverRef.current = undefined;
    if (!element) return;
    const update = () => setViewport((current) => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      return next.width === current.width && next.height === current.height ? current : next;
    });
    update();
    viewportObserverRef.current = new ResizeObserver(update);
    viewportObserverRef.current.observe(element);
  }, []);
  const dragRef = useRef<{ uid: string; key: string; pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | undefined>(undefined);
  const suppressClickRef = useRef(false);

  const model = useMemo(() => {
    if (!root) return undefined;
    const currentScope = scope || root;
    const visible = [...childStates(currentScope), ...scxmlChildren(currentScope, 'history')];
    const documentKey = attr(root, 'name') || attr(root, 'initial') || 'scxml';
    const currentScopeKey = attr(currentScope, 'id') || currentScope.uid;
    const specs = visible.map((node): NodeSpec => ({
      node,
      width: node.local === 'final' || node.local === 'history' ? 110 : STATE_WIDTH,
      height: node.local === 'final' || node.local === 'history' ? 78 : STATE_HEIGHT,
    }));

    const statesById = new Map<string, ScxmlNode>();
    allNodes(root).forEach((node) => {
      const id = attr(node, 'id');
      if (id && (stateElements.has(node.local) || node.local === 'history')) statesById.set(id, node);
    });

    const initialTargetIds = (() => {
      if (currentScope.local === 'parallel') return childStates(currentScope).map((node) => attr(node, 'id')).filter(Boolean) as string[];
      const initialElement = scxmlChildren(currentScope, 'initial')[0];
      const initialTransition = initialElement ? scxmlChildren(initialElement, 'transition')[0] : undefined;
      const declared = attr(currentScope, 'initial') || attr(initialTransition || currentScope, 'target');
      const firstChild = childStates(currentScope)[0];
      return declared?.split(/\s+/).filter(Boolean) || [firstChild ? attr(firstChild, 'id') : undefined].filter(Boolean) as string[];
    })();
    const visibleInitialUids = new Set(initialTargetIds.map((id) => {
      const target = statesById.get(id);
      return target ? directChildFor(target, currentScope)?.uid : undefined;
    }).filter((uid): uid is string => Boolean(uid)));

    // 收集本层连线：既包含可见状态自身的转换，也把其子孙状态指向本层
    // 其他状态的转换聚合到可见祖先上（liftedFrom 记录真实来源）。
    interface RawEdge { sourceUid: string; targetUid: string; transition: ScxmlNode; targetId: string; liftedFrom?: string; }
    const visibleUids = new Set(specs.map((spec) => spec.node.uid));
    const rawEdges: RawEdge[] = [];
    specs.forEach(({ node: source }) => {
      allNodes(source).forEach((owner) => {
        if (owner !== source && !stateElements.has(owner.local) && owner.local !== 'history') return;
        scxmlChildren(owner, 'transition').forEach((transition) => {
          (attr(transition, 'target') || '').split(/\s+/).filter(Boolean).forEach((targetId) => {
            const targetNode = statesById.get(targetId);
            const visibleTarget = targetNode ? directChildFor(targetNode, currentScope) : undefined;
            if (!visibleTarget || !visibleUids.has(visibleTarget.uid)) return;
            // 子孙内部的转换（目标仍落在同一可见状态里）不属于本层。
            if (owner !== source && visibleTarget.uid === source.uid) return;
            rawEdges.push({
              sourceUid: source.uid,
              targetUid: visibleTarget.uid,
              transition,
              targetId,
              liftedFrom: owner === source ? undefined : displayName(owner),
            });
          });
        });
      });
    });

    const layout = layeredLayout(specs, rawEdges.map((edge) => [edge.sourceUid, edge.targetUid]), visibleInitialUids);
    const gridColumns = Math.max(1, Math.min(5, visible.length <= 2 ? visible.length : Math.ceil(Math.sqrt(visible.length * 1.45))));
    const columns = layout ? layout.columns : gridColumns;
    const rows = layout ? layout.rows : Math.ceil(visible.length / gridColumns);

    const boxes = specs.map((spec, index): Box => {
      const positionKey = `${documentKey}:${currentScopeKey}:${attr(spec.node, 'id') || spec.node.uid}`;
      const saved = positions[positionKey];
      const auto = layout?.positions.get(spec.node.uid) || {
        x: MARGIN_X + (index % gridColumns) * (STATE_WIDTH + COLUMN_GAP),
        y: MARGIN_Y + Math.floor(index / gridColumns) * (STATE_HEIGHT + ROW_GAP),
      };
      return { node: spec.node, x: saved?.x ?? auto.x, y: saved?.y ?? auto.y, width: spec.width, height: spec.height };
    });
    const boxByUid = new Map(boxes.map((box) => [box.node.uid, box]));

    const groups = new Map<string, EdgeGroup>();
    rawEdges.forEach(({ sourceUid, targetUid, transition, targetId, liftedFrom }) => {
      const source = boxByUid.get(sourceUid);
      const target = boxByUid.get(targetUid);
      if (!source || !target) return;
      const key = `${sourceUid}:${targetUid}`;
      const existing = groups.get(key) || { key, source, target, transitions: [], targetIds: [], directCount: 0, liftedFrom: [], inheritedFrom: [] };
      existing.transitions.push(transition);
      existing.targetIds.push(targetId);
      if (liftedFrom) {
        if (!existing.liftedFrom.includes(liftedFrom)) existing.liftedFrom.push(liftedFrom);
      } else existing.directCount += 1;
      groups.set(key, existing);
    });

    return {
      currentScope,
      documentKey,
      currentScopeKey,
      boxes,
      visibleInitialUids,
      statesById,
      edges: [...groups.values()],
      scopeTransitions: scxmlChildren(currentScope, 'transition'),
      width: Math.max(860, 2 * MARGIN_X - 20 + columns * STATE_WIDTH + Math.max(0, columns - 1) * COLUMN_GAP),
      height: Math.max(470, 150 + rows * STATE_HEIGHT + Math.max(0, rows - 1) * ROW_GAP),
    };
  }, [root, scope, positions]);

  if (!root || !model) return <div className="diagram-empty">修复 XML 语法后将恢复可视化</div>;

  // 画布至少铺满可视区域，同时覆盖被拖出默认布局范围的节点，收缩视口时不裁掉它们。
  const canvasWidth = Math.max(model.width, viewport.width, ...model.boxes.map((box) => box.x + box.width + 24));
  const canvasHeight = Math.max(model.height, viewport.height, ...model.boxes.map((box) => box.y + box.height + 24));

  const displayedEdges = model.edges.filter((edge) =>
    showAllTransitions
    || edge.source.node.uid === selectedUid
    || edge.transitions.some((transition) => transition.uid === selectedUid || invalidUids.has(transition.uid)),
  );

  // SCXML 中祖先状态的转换对活动子状态同样生效：选中状态时，把父/祖先定义、
  // 目标仍落在本层的转换画成从选中状态出发的继承连线（目标在层外的仍由公共转换条展示）。
  const inheritedEdges: EdgeGroup[] = [];
  const selectedBox = selectedUid ? model.boxes.find((box) => box.node.uid === selectedUid) : undefined;
  if (selectedBox) {
    const inheritedGroups = new Map<string, EdgeGroup>();
    for (let ancestor = selectedBox.node.parent; ancestor && ancestor.local !== 'scxml'; ancestor = ancestor.parent) {
      if (!stateElements.has(ancestor.local)) continue;
      scxmlChildren(ancestor, 'transition').forEach((transition) => {
        (attr(transition, 'target') || '').split(/\s+/).filter(Boolean).forEach((targetId) => {
          const targetNode = model.statesById.get(targetId);
          const visibleTarget = targetNode ? directChildFor(targetNode, model.currentScope) : undefined;
          const targetBox = visibleTarget && model.boxes.find((box) => box.node.uid === visibleTarget.uid);
          if (!targetBox) return;
          const key = `inherited:${selectedBox.node.uid}:${targetBox.node.uid}`;
          const existing = inheritedGroups.get(key) || { key, source: selectedBox, target: targetBox, transitions: [], targetIds: [], directCount: 0, liftedFrom: [], inheritedFrom: [] };
          existing.transitions.push(transition);
          existing.targetIds.push(targetId);
          const origin = displayName(ancestor);
          if (!existing.inheritedFrom.includes(origin)) existing.inheritedFrom.push(origin);
          inheritedGroups.set(key, existing);
        });
      });
    }
    inheritedEdges.push(...inheritedGroups.values());
  }

  const edgeKeys = new Set(model.edges.map((edge) => edge.key));

  const positionKeyFor = (node: ScxmlNode) => `${model.documentKey}:${model.currentScopeKey}:${attr(node, 'id') || node.uid}`;

  const startDrag = (event: ReactPointerEvent<SVGGElement>, box: Box) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    suppressClickRef.current = false;
    dragRef.current = {
      uid: box.node.uid,
      key: positionKeyFor(box.node),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: box.x,
      originY: box.y,
      moved: false,
    };
    setDraggingUid(box.node.uid);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = svgRef.current?.getBoundingClientRect();
    const scaleX = bounds?.width ? canvasWidth / bounds.width : 1;
    const scaleY = bounds?.height ? canvasHeight / bounds.height : 1;
    const dx = (event.clientX - drag.startX) * scaleX;
    const dy = (event.clientY - drag.startY) * scaleY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    const box = model.boxes.find((item) => item.node.uid === drag.uid);
    const width = box?.width || STATE_WIDTH;
    const height = box?.height || STATE_HEIGHT;
    setPositions((current) => ({
      ...current,
      [drag.key]: {
        x: Math.max(24, Math.min(canvasWidth - width - 24, drag.originX + dx)),
        y: Math.max(55, Math.min(canvasHeight - height - 24, drag.originY + dy)),
      },
    }));
  };

  const finishDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    suppressClickRef.current = dragRef.current.moved;
    dragRef.current = undefined;
    setDraggingUid(undefined);
  };

  const clickNode = (node: ScxmlNode) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelect(node);
  };

  const edgePath = (edge: EdgeGroup, selfIndex: number) => {
    const sx = edge.source.x + edge.source.width / 2;
    const sy = edge.source.y + edge.source.height / 2;
    const tx = edge.target.x + edge.target.width / 2;
    const ty = edge.target.y + edge.target.height / 2;
    if (edge.source === edge.target) {
      const lift = 55 + selfIndex * 26;
      return {
        path: `M ${sx + 35} ${edge.source.y} C ${sx + 75} ${edge.source.y - lift}, ${sx - 75} ${edge.source.y - lift}, ${sx - 35} ${edge.source.y}`,
        labelX: sx,
        labelY: edge.source.y - lift + 13,
      };
    }
    // 双向转换各自向行进方向左侧偏移，避免两条线完全重叠；
    // 继承连线再多偏移一档，避免盖住同一对状态之间的直接连线。
    const bidirectional = edgeKeys.has(`${edge.target.node.uid}:${edge.source.node.uid}`);
    const horizontal = Math.abs(tx - sx) >= Math.abs(ty - sy);
    const shift = (bidirectional ? 13 : 0) + (edge.inheritedFrom.length ? 13 : 0);
    const shiftX = horizontal ? 0 : (ty > sy ? shift : -shift);
    const shiftY = horizontal ? (tx > sx ? -shift : shift) : 0;
    const fromX = (horizontal ? sx + Math.sign(tx - sx) * edge.source.width / 2 : sx) + shiftX;
    const fromY = (horizontal ? sy : sy + Math.sign(ty - sy) * edge.source.height / 2) + shiftY;
    const toX = (horizontal ? tx - Math.sign(tx - sx) * edge.target.width / 2 : tx) + shiftX;
    const toY = (horizontal ? ty : ty - Math.sign(ty - sy) * edge.target.height / 2) + shiftY;
    return {
      path: horizontal
        ? `M ${fromX} ${fromY} C ${(fromX + toX) / 2} ${fromY + shiftY}, ${(fromX + toX) / 2} ${toY + shiftY}, ${toX} ${toY}`
        : `M ${fromX} ${fromY} C ${fromX + shiftX} ${(fromY + toY) / 2}, ${toX + shiftX} ${(fromY + toY) / 2}, ${toX} ${toY}`,
      labelX: (fromX + toX) / 2 + shiftX,
      labelY: (fromY + toY) / 2 - 8 + shiftY,
    };
  };

  const selfLoopCount = new Map<string, number>();

  return (
    <div className="diagram-scroll" data-testid="diagram" ref={attachScroll}>
      <div className="diagram-mode-info">
        {!showAllTransitions && <span>选择状态查看转换</span>}
        <span>{model.boxes.length} 个本层状态</span>
        <span>{model.edges.length} 组本层连线</span>
        {!!model.scopeTransitions.length && <span className="scope-transition-info" title="该转换定义在当前复合状态上，对其活动子状态均生效">当前状态公共转换 {model.scopeTransitions.length} 条</span>}
      </div>
      {!!model.scopeTransitions.length && (
        <div className="scope-transition-strip">
          <strong>当前状态转换</strong>
          {model.scopeTransitions.map((transition) => {
            const target = attr(transition, 'target') || '—';
            return <button type="button" key={transition.uid} className={selectedUid === transition.uid ? 'active' : ''} title={fullDescription([transition], [target])} onClick={() => onSelect(transition)}><span>{summarize([transition], [target])}</span><i>→ {target}</i></button>;
          })}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} width={canvasWidth} height={canvasHeight} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
        <defs>
          <marker id="transition-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path className="transition-arrow-head" d="M0,0 L9,4.5 L0,9 z" /></marker>
          <marker id="invalid-transition-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path className="invalid-transition-arrow-head" d="M0,0 L9,4.5 L0,9 z" /></marker>
          <marker id="inherited-transition-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path className="inherited-transition-arrow-head" d="M0,0 L9,4.5 L0,9 z" /></marker>
          <marker id="initial-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path className="initial-arrow-head" d="M0,0 L8,4 L0,8 z" /></marker>
          <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>

        <g className="initial-layer">
          {model.boxes.filter((box) => model.visibleInitialUids.has(box.node.uid)).map((box, index) => (
            <g key={`initial-${box.node.uid}`} className="initial-marker">
              <circle cx={box.x - 25} cy={box.y + 20 + index * 3} r="5" />
              <path d={`M ${box.x - 19} ${box.y + 20 + index * 3} L ${box.x} ${box.y + box.height / 2}`} markerEnd="url(#initial-arrow)" />
            </g>
          ))}
        </g>

        <g className="state-layer">
          {model.boxes.map((box) => {
            const { node } = box;
            const selected = selectedUid === node.uid;
            const invalid = invalidUids.has(node.uid);
            const children = childStates(node);
            const transitions = scxmlChildren(node, 'transition');
            if (node.local === 'final') {
              return <g key={node.uid} className={`state-node final-node ${draggingUid === node.uid ? 'dragging' : ''} ${selected ? 'selected' : ''} ${invalid ? 'invalid' : ''}`} onPointerDown={(event) => startDrag(event, box)} onClick={() => clickNode(node)}><circle cx={box.x + box.width / 2} cy={box.y + 28} r="19" /><circle cx={box.x + box.width / 2} cy={box.y + 28} r="11" className="final-inner" /><text x={box.x + box.width / 2} y={box.y + 66} textAnchor="middle">{displayName(node)}</text></g>;
            }
            if (node.local === 'history') {
              return <g key={node.uid} className={`state-node history-node ${draggingUid === node.uid ? 'dragging' : ''} ${selected ? 'selected' : ''} ${invalid ? 'invalid' : ''}`} onPointerDown={(event) => startDrag(event, box)} onClick={() => clickNode(node)}><circle cx={box.x + box.width / 2} cy={box.y + 28} r="20" /><text x={box.x + box.width / 2} y={box.y + 33} textAnchor="middle">{attr(node, 'type') === 'deep' ? 'H*' : 'H'}</text><text x={box.x + box.width / 2} y={box.y + 66} textAnchor="middle" className="history-label">{displayName(node)}</text></g>;
            }
            return (
              <g key={node.uid} className={`state-node flat-node ${node.local} ${children.length ? 'compound' : ''} ${draggingUid === node.uid ? 'dragging' : ''} ${selected ? 'selected' : ''} ${invalid ? 'invalid' : ''}`} onPointerDown={(event) => startDrag(event, box)} onClick={() => clickNode(node)} onDoubleClick={() => !suppressClickRef.current && children.length && onEnter?.(node)}>
                <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="13" />
                <text x={box.x + 14} y={box.y + 25} className="state-title">{displayName(node)}</text>
                <text x={box.x + box.width - 12} y={box.y + 23} textAnchor="end" className="state-kind">{node.local === 'parallel' ? 'PARALLEL' : children.length ? 'COMPOUND' : 'STATE'}</text>
                <path d={`M ${box.x} ${box.y + 36} H ${box.x + box.width}`} className="header-line" />
                <text x={box.x + 14} y={box.y + 59} className="node-summary">{children.length ? `${children.length} 个子状态` : transitions.length ? `${transitions.length} 条转换` : '原子状态'}</text>
                {transitions.length > 0 && <g className="transition-count"><rect x={box.x + 13} y={box.y + 69} width="49" height="15" rx="7" /><text x={box.x + 37.5} y={box.y + 80} textAnchor="middle">{transitions.length} 条转换</text></g>}
                {children.length > 0 && <g className="enter-control" onClick={(event) => { event.stopPropagation(); onEnter?.(node); }}><rect x={box.x + box.width - 68} y={box.y + 63} width="55" height="20" rx="7" /><text x={box.x + box.width - 40.5} y={box.y + 77} textAnchor="middle">进入 ›</text></g>}
              </g>
            );
          })}
        </g>

        <g className="transition-layer">
          {[...displayedEdges, ...inheritedEdges].map((edge) => {
            let selfIndex = 0;
            if (edge.source === edge.target) {
              selfIndex = selfLoopCount.get(edge.source.node.uid) || 0;
              selfLoopCount.set(edge.source.node.uid, selfIndex + 1);
            }
            const route = edgePath(edge, selfIndex);
            const invalid = edge.transitions.some((transition) => invalidUids.has(transition.uid));
            const selected = edge.transitions.some((transition) => transition.uid === selectedUid);
            const label = summarize(edge.transitions, edge.targetIds);
            const labelWidth = labelWidthFor(label);
            const lifted = edge.directCount === 0 && edge.liftedFrom.length > 0;
            const originNote = (edge.liftedFrom.length ? `\n（由子状态 ${edge.liftedFrom.join('、')} 发出）` : '')
              + (edge.inheritedFrom.length ? `\n（继承自父状态 ${edge.inheritedFrom.join('、')}）` : '');
            return (
              <g key={edge.key} className={`transition ${lifted ? 'lifted' : ''} ${edge.inheritedFrom.length ? 'inherited' : ''} ${selected ? 'selected' : ''} ${invalid ? 'invalid' : ''}`} onClick={(event) => { event.stopPropagation(); onSelect(edge.transitions[0]); }}>
                <title>{fullDescription(edge.transitions, edge.targetIds) + originNote}</title>
                <path d={route.path} markerEnd={invalid ? 'url(#invalid-transition-arrow)' : edge.inheritedFrom.length ? 'url(#inherited-transition-arrow)' : 'url(#transition-arrow)'} />
                <rect x={route.labelX - labelWidth / 2} y={route.labelY - 11} width={labelWidth} height="20" rx="6" />
                <text x={route.labelX} y={route.labelY + 3} textAnchor="middle">{label}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
