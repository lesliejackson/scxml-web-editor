import {
  SCXML_NS,
  attr,
  childStates,
  scxmlChildren,
  stateElements,
  type Diagnostic,
  type ParseResult,
  type ScxmlNode,
} from './types';

const knownElements = new Set([
  'scxml', 'state', 'parallel', 'transition', 'initial', 'final', 'onentry', 'onexit',
  'history', 'raise', 'if', 'elseif', 'else', 'foreach', 'log', 'datamodel', 'data',
  'assign', 'donedata', 'content', 'param', 'script', 'send', 'cancel', 'invoke', 'finalize',
]);

const allowedChildren: Record<string, Set<string>> = {
  scxml: new Set(['state', 'parallel', 'final', 'datamodel', 'script']),
  state: new Set(['onentry', 'onexit', 'transition', 'initial', 'state', 'parallel', 'final', 'history', 'datamodel', 'invoke']),
  parallel: new Set(['onentry', 'onexit', 'transition', 'state', 'parallel', 'history', 'datamodel', 'invoke']),
  final: new Set(['onentry', 'onexit', 'donedata']),
  initial: new Set(['transition']),
  history: new Set(['transition']),
  onentry: new Set(['raise', 'if', 'foreach', 'log', 'assign', 'script', 'send', 'cancel']),
  onexit: new Set(['raise', 'if', 'foreach', 'log', 'assign', 'script', 'send', 'cancel']),
  transition: new Set(['raise', 'if', 'foreach', 'log', 'assign', 'script', 'send', 'cancel']),
  if: new Set(['raise', 'if', 'elseif', 'else', 'foreach', 'log', 'assign', 'script', 'send', 'cancel']),
  foreach: new Set(['raise', 'if', 'foreach', 'log', 'assign', 'script', 'send', 'cancel']),
  datamodel: new Set(['data']),
  data: new Set([]),
  donedata: new Set(['content', 'param']),
  content: new Set([]),
  send: new Set(['content', 'param']),
  invoke: new Set(['content', 'param', 'finalize']),
  finalize: new Set(['raise', 'if', 'foreach', 'log', 'assign', 'script', 'send', 'cancel']),
};

const ncName = /^[A-Za-z_][A-Za-z0-9._-]*$/;

const allowedAttributes: Record<string, Set<string>> = {
  scxml: new Set(['initial', 'name', 'version', 'datamodel', 'binding']),
  state: new Set(['id', 'initial']), parallel: new Set(['id']), transition: new Set(['event', 'cond', 'target', 'type']),
  initial: new Set(), final: new Set(['id']), onentry: new Set(), onexit: new Set(), history: new Set(['id', 'type']),
  raise: new Set(['event']), if: new Set(['cond']), elseif: new Set(['cond']), else: new Set(),
  foreach: new Set(['array', 'item', 'index']), log: new Set(['label', 'expr']), datamodel: new Set(),
  data: new Set(['id', 'src', 'expr']), assign: new Set(['location', 'expr']), donedata: new Set(),
  content: new Set(['expr']), param: new Set(['name', 'expr', 'location']), script: new Set(['src']),
  send: new Set(['event', 'eventexpr', 'target', 'targetexpr', 'type', 'typeexpr', 'id', 'idlocation', 'delay', 'delayexpr', 'namelist']),
  cancel: new Set(['sendid', 'sendidexpr']),
  invoke: new Set(['type', 'typeexpr', 'src', 'srcexpr', 'id', 'idlocation', 'namelist', 'autoforward']),
  finalize: new Set(),
};

function diagnostic(node: ScxmlNode, code: string, message: string, severity: Diagnostic['severity'] = 'error'): Diagnostic {
  return { code, severity, message, loc: node.loc, nodeUid: node.uid };
}

function allNodes(root: ScxmlNode): ScxmlNode[] {
  const result: ScxmlNode[] = [];
  const visit = (node: ScxmlNode) => {
    result.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return result;
}

function stateDescendantOf(node: ScxmlNode, ancestor: ScxmlNode): boolean {
  let cursor = node.parent;
  while (cursor) {
    if (cursor === ancestor) return true;
    cursor = cursor.parent;
  }
  return false;
}

function nearestStateParent(node: ScxmlNode): ScxmlNode | undefined {
  let cursor = node.parent;
  while (cursor) {
    if (cursor.uri === SCXML_NS && (stateElements.has(cursor.local) || cursor.local === 'scxml')) return cursor;
    cursor = cursor.parent;
  }
  return undefined;
}

function validateMutualExclusion(node: ScxmlNode, diagnostics: Diagnostic[]) {
  const has = (...names: string[]) => names.filter((name) => attr(node, name) !== undefined);
  const exclusiveGroups: Record<string, string[][]> = {
    data: [['src', 'expr']],
    content: [['expr']],
    param: [['expr', 'location']],
    send: [['event', 'eventexpr'], ['target', 'targetexpr'], ['type', 'typeexpr'], ['id', 'idlocation'], ['delay', 'delayexpr']],
    invoke: [['type', 'typeexpr'], ['src', 'srcexpr'], ['id', 'idlocation']],
  };
  for (const group of exclusiveGroups[node.local] || []) {
    const present = has(...group);
    if (present.length > 1) diagnostics.push(diagnostic(node, 'attribute.exclusive', `属性 ${present.join('、')} 不能同时出现`));
  }
  const elementChildren = scxmlChildren(node);
  const hasContent = elementChildren.some((child) => child.local === 'content');
  const hasParam = elementChildren.some((child) => child.local === 'param');
  if (hasContent && hasParam) diagnostics.push(diagnostic(node, 'content.param.exclusive', '<content> 和 <param> 不能同时使用'));
  if (node.local === 'data' && (attr(node, 'src') || attr(node, 'expr')) && (node.text.trim() || node.children.length)) {
    diagnostics.push(diagnostic(node, 'data.content.exclusive', '<data> 使用 src 或 expr 时不能包含内联内容'));
  }
  if (node.local === 'content' && attr(node, 'expr') && (node.text.trim() || node.children.length)) {
    diagnostics.push(diagnostic(node, 'content.expr.exclusive', '<content> 使用 expr 时不能包含内联内容'));
  }
}

export function validateScxml(parsed: ParseResult): Diagnostic[] {
  const diagnostics = [...parsed.diagnostics];
  const root = parsed.root;
  if (!root || parsed.diagnostics.some((item) => item.code === 'xml.syntax')) return diagnostics;

  if (root.local !== 'scxml' || root.uri !== SCXML_NS) {
    diagnostics.push(diagnostic(root, 'root.invalid', `根元素必须是命名空间 ${SCXML_NS} 中的 <scxml>`));
    return diagnostics;
  }
  if (attr(root, 'version') !== '1.0') diagnostics.push(diagnostic(root, 'scxml.version', '<scxml> 必须声明 version="1.0"'));
  if (!childStates(root).length) diagnostics.push(diagnostic(root, 'scxml.empty', '<scxml> 至少需要一个 <state>、<parallel> 或 <final> 子元素'));
  if (attr(root, 'binding') && !['early', 'late'].includes(attr(root, 'binding')!)) {
    diagnostics.push(diagnostic(root, 'binding.invalid', 'binding 只能是 early 或 late'));
  }

  const nodes = allNodes(root);
  const ids = new Map<string, ScxmlNode>();
  for (const node of nodes) {
    if (node.uri !== SCXML_NS) {
      const executableParents = new Set(['onentry', 'onexit', 'transition', 'if', 'foreach', 'finalize']);
      if (node.parent?.uri === SCXML_NS && !executableParents.has(node.parent.local)) {
        diagnostics.push(diagnostic(node, 'extension.location', `扩展元素 <${node.name}> 只能出现在可执行内容区域`));
      }
      continue;
    }
    if (!knownElements.has(node.local)) {
      diagnostics.push(diagnostic(node, 'element.unknown', `SCXML 命名空间中不存在 <${node.local}> 元素`));
      continue;
    }
    const parent = node.parent;
    if (parent?.uri === SCXML_NS) {
      const allowed = allowedChildren[parent.local];
      if (allowed && !allowed.has(node.local)) {
        diagnostics.push(diagnostic(node, 'child.invalid', `<${node.local}> 不能作为 <${parent.local}> 的子元素`));
      }
    }
    validateMutualExclusion(node, diagnostics);
    Object.values(node.attributes).forEach((attribute) => {
      if (attribute.name !== attribute.local || attribute.uri) return;
      if (!allowedAttributes[node.local]?.has(attribute.local)) {
        diagnostics.push(diagnostic(node, 'attribute.unknown', `<${node.local}> 不允许使用属性 ${attribute.name}`));
      }
    });

    const id = attr(node, 'id');
    if (id !== undefined) {
      if (!ncName.test(id)) diagnostics.push(diagnostic(node, 'id.invalid', `“${id}”不是合法的 XML ID`));
      if (node.local === 'data' && id.startsWith('_')) diagnostics.push(diagnostic(node, 'data.id.reserved', '<data> 的 id 不能以下划线开头'));
      if (ids.has(id)) diagnostics.push(diagnostic(node, 'id.duplicate', `ID “${id}”重复`));
      else ids.set(id, node);
    }

    if (node.local === 'state') {
      const children = childStates(node);
      if (!children.length && attr(node, 'initial')) diagnostics.push(diagnostic(node, 'atomic.initial', '原子 <state> 不能声明 initial'));
      if (attr(node, 'initial') && scxmlChildren(node, 'initial').length) diagnostics.push(diagnostic(node, 'initial.conflict', 'initial 属性和 <initial> 元素不能同时使用'));
      if (scxmlChildren(node, 'initial').length > 1) diagnostics.push(diagnostic(node, 'initial.multiple', '<state> 最多只能包含一个 <initial>'));
    }
    if (node.local === 'parallel' && !childStates(node).length) diagnostics.push(diagnostic(node, 'parallel.empty', '<parallel> 至少需要一个子状态'));
    const count = (local: string) => scxmlChildren(node, local).length;
    if (node.local === 'scxml' || node.local === 'state' || node.local === 'parallel') {
      if (count('datamodel') > 1) diagnostics.push(diagnostic(node, 'datamodel.multiple', `<${node.local}> 最多只能包含一个 <datamodel>`));
    }
    if (node.local === 'final' && count('donedata') > 1) diagnostics.push(diagnostic(node, 'donedata.multiple', '<final> 最多只能包含一个 <donedata>'));
    if (node.local === 'donedata' && count('content') + count('param') === 0) diagnostics.push(diagnostic(node, 'donedata.empty', '<donedata> 必须包含一个 <content> 或至少一个 <param>'));
    if (['send', 'invoke', 'donedata'].includes(node.local) && count('content') > 1) diagnostics.push(diagnostic(node, 'content.multiple', `<${node.local}> 最多只能包含一个 <content>`));
    if (node.local === 'invoke' && count('finalize') > 1) diagnostics.push(diagnostic(node, 'finalize.multiple', '<invoke> 最多只能包含一个 <finalize>'));
    if (node.local === 'history') {
      if (attr(node, 'type') && !['shallow', 'deep'].includes(attr(node, 'type')!)) diagnostics.push(diagnostic(node, 'history.type', 'history type 只能是 shallow 或 deep'));
      const transitions = scxmlChildren(node, 'transition');
      if (transitions.length > 1) diagnostics.push(diagnostic(node, 'history.transition', '<history> 最多只能有一个默认转换'));
      transitions.forEach((transition) => {
        if (attr(transition, 'event') || attr(transition, 'cond')) diagnostics.push(diagnostic(transition, 'history.transition.event', '历史状态的默认转换不能包含 event 或 cond'));
      });
    }
    if (node.local === 'initial') {
      const transitions = scxmlChildren(node, 'transition');
      if (transitions.length !== 1) diagnostics.push(diagnostic(node, 'initial.transition', '<initial> 必须恰好包含一个 <transition>'));
      if (transitions[0] && (attr(transitions[0], 'event') || attr(transitions[0], 'cond'))) diagnostics.push(diagnostic(transitions[0], 'initial.transition.event', '初始转换不能包含 event 或 cond'));
    }
    if (node.local === 'transition' && attr(node, 'type') && !['internal', 'external'].includes(attr(node, 'type')!)) {
      diagnostics.push(diagnostic(node, 'transition.type', 'transition type 只能是 internal 或 external'));
    }
    if (node.local === 'raise' && !attr(node, 'event')) diagnostics.push(diagnostic(node, 'raise.event', '<raise> 必须声明 event'));
    if ((node.local === 'if' || node.local === 'elseif') && !attr(node, 'cond')) diagnostics.push(diagnostic(node, 'conditional.cond', `<${node.local}> 必须声明 cond`));
    if (node.local === 'if') {
      let sawElse = false;
      scxmlChildren(node).forEach((child) => {
        if (child.local === 'else') {
          if (sawElse) diagnostics.push(diagnostic(child, 'else.multiple', '<if> 最多只能包含一个 <else>'));
          sawElse = true;
        } else if (child.local === 'elseif' && sawElse) diagnostics.push(diagnostic(child, 'elseif.order', '<elseif> 不能出现在 <else> 之后'));
      });
    }
    if (node.local === 'foreach') {
      if (!attr(node, 'array')) diagnostics.push(diagnostic(node, 'foreach.array', '<foreach> 必须声明 array'));
      if (!attr(node, 'item')) diagnostics.push(diagnostic(node, 'foreach.item', '<foreach> 必须声明 item'));
    }
    if (node.local === 'assign' && !attr(node, 'location')) diagnostics.push(diagnostic(node, 'assign.location', '<assign> 必须声明 location'));
    if (node.local === 'data' && !id) diagnostics.push(diagnostic(node, 'data.id', '<data> 必须声明 id'));
    if (node.local === 'param' && !attr(node, 'name')) diagnostics.push(diagnostic(node, 'param.name', '<param> 必须声明 name'));
  }

  const stateIds = new Map<string, ScxmlNode>();
  nodes.filter((node) => node.uri === SCXML_NS && (stateElements.has(node.local) || node.local === 'history')).forEach((node) => {
    const id = attr(node, 'id');
    if (id) stateIds.set(id, node);
  });

  const validateTargets = (node: ScxmlNode, value: string, isInitial: boolean) => {
    const targets = value.trim().split(/\s+/).filter(Boolean);
    const resolved = targets.map((target) => stateIds.get(target));
    targets.forEach((target, index) => {
      if (!resolved[index]) diagnostics.push(diagnostic(node, 'target.missing', `目标状态 “${target}”不存在`));
    });
    const actual = resolved.filter((item): item is ScxmlNode => Boolean(item));
    if (new Set(targets).size !== targets.length) diagnostics.push(diagnostic(node, 'target.duplicate', '目标状态列表不能包含重复 ID'));
    for (let i = 0; i < actual.length; i++) {
      for (let j = i + 1; j < actual.length; j++) {
        if (stateDescendantOf(actual[i], actual[j]) || stateDescendantOf(actual[j], actual[i])) {
          diagnostics.push(diagnostic(node, 'target.configuration', '多目标转换不能同时指向祖先状态和它的后代状态'));
        }
      }
    }
    if (isInitial) {
      const owner = node.local === 'scxml' || node.local === 'state' ? node : nearestStateParent(node);
      actual.forEach((target) => {
        if (owner && !stateDescendantOf(target, owner)) diagnostics.push(diagnostic(node, 'initial.scope', `初始目标 “${attr(target, 'id')}”必须是当前状态的后代`));
      });
    }
  };

  nodes.forEach((node) => {
    if (node.uri !== SCXML_NS) return;
    const initial = attr(node, 'initial');
    if (initial && (node.local === 'scxml' || node.local === 'state')) validateTargets(node, initial, true);
    if (node.local === 'transition') {
      const target = attr(node, 'target');
      if (target) validateTargets(node, target, node.parent?.local === 'initial');
      if (node.parent?.local === 'initial' && !target) diagnostics.push(diagnostic(node, 'initial.target', '初始转换必须声明 target'));
    }
  });

  const datamodel = attr(root, 'datamodel') || 'null';
  if (datamodel === 'null') {
    const unsupported = new Set(['datamodel', 'data', 'assign', 'foreach', 'script']);
    nodes.forEach((node) => {
      if (node.uri === SCXML_NS && unsupported.has(node.local)) diagnostics.push(diagnostic(node, 'null-datamodel.unsupported', `null datamodel 不支持 <${node.local}>`));
    });
  } else if (datamodel !== 'ecmascript') {
    diagnostics.push(diagnostic(root, 'datamodel.unsupported', `编辑器目前只能严格检查 null 和 ecmascript datamodel；“${datamodel}”将按扩展模型保留`, 'warning'));
  }

  return diagnostics.sort((a, b) => a.loc.offset - b.loc.offset || (a.severity === 'error' ? -1 : 1));
}

export function analyzeScxml(source: string) {
  const parsed = parseScxmlLazy(source);
  return { ...parsed, diagnostics: validateScxml(parsed) };
}

// Kept behind a tiny indirection to make validator rules straightforward to unit test.
import { parseScxml as parseScxmlLazy } from './parser';
