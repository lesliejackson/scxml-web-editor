import { SCXML_NS, type ScxmlNode } from './types';

function openingTagRange(source: string, node: ScxmlNode): [number, number] | undefined {
  let start = Math.max(0, Math.min(node.loc.offset, source.length - 1));
  const nearby = source.lastIndexOf('<', start + 2);
  if (nearby >= 0 && source.slice(nearby + 1).startsWith(node.name)) start = nearby;
  else {
    const found = source.indexOf(`<${node.name}`, Math.max(0, start - 2));
    if (found < 0) return undefined;
    start = found;
  }
  let quote = '';
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return [start, index + 1];
  }
  return undefined;
}

function escapeAttribute(value: string, quote: string) {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return quote === "'" ? escaped.replace(/'/g, '&apos;') : escaped.replace(/"/g, '&quot;');
}

export type StateElementType = 'state' | 'parallel' | 'final';

export interface TransitionAttributes {
  target: string;
  event?: string;
  cond?: string;
  type?: 'internal' | 'external' | '';
}

function indentationAt(source: string, offset: number): string | undefined {
  const lineStart = Math.max(source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1, 0);
  const prefix = source.slice(lineStart, offset);
  return /^[\t ]*$/.test(prefix) ? prefix : undefined;
}

function childIndentation(source: string, parent: ScxmlNode, parentStart: number): string {
  const existingChild = parent.children[0];
  if (existingChild) {
    const childStart = openingTagRange(source, existingChild)?.[0] ?? existingChild.loc.offset;
    const indentation = indentationAt(source, childStart);
    if (indentation !== undefined) return indentation;
  }
  const parentIndent = indentationAt(source, parentStart) ?? '';
  return `${parentIndent}${parentIndent.includes('\t') ? '\t' : '  '}`;
}

function qualifiedChildName(parent: ScxmlNode, type: string): string {
  const separator = parent.name.indexOf(':');
  return separator >= 0 ? `${parent.name.slice(0, separator + 1)}${type}` : type;
}

function insertChildMarkup(source: string, parent: ScxmlNode, child: string): string {
  const range = openingTagRange(source, parent);
  if (!range) return source;
  const [parentStart, openingEnd] = range;
  const openingTag = source.slice(parentStart, openingEnd);
  const parentIndent = indentationAt(source, parentStart) ?? '';
  const childIndent = childIndentation(source, parent, parentStart);
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
  const multiline = source.includes('\n');

  if (/\/\s*>$/.test(openingTag)) {
    const expandedOpening = openingTag.replace(/\s*\/\s*>$/, '>');
    const body = multiline
      ? `${lineEnding}${childIndent}${child}${lineEnding}${parentIndent}`
      : child.replace(/\r?\n[\t ]*/g, '');
    return `${source.slice(0, parentStart)}${expandedOpening}${body}</${parent.name}>${source.slice(openingEnd)}`;
  }

  const parentEnd = Math.min(parent.loc.endOffset ?? source.length, source.length);
  const closingStart = source.lastIndexOf(`</${parent.name}`, parentEnd);
  if (closingStart < openingEnd) return source;
  if (!multiline) return `${source.slice(0, closingStart)}${child.replace(/\r?\n[\t ]*/g, '')}${source.slice(closingStart)}`;

  const content = source.slice(openingEnd, closingStart);
  const trailingWhitespace = content.match(/\r?\n[\t ]*$/)?.[0];
  if (trailingWhitespace !== undefined) {
    const insertAt = closingStart - trailingWhitespace.length;
    return `${source.slice(0, insertAt)}${lineEnding}${childIndent}${child}${source.slice(insertAt)}`;
  }
  const insertion = `${lineEnding}${childIndent}${child}${lineEnding}${parentIndent}`;
  return `${source.slice(0, closingStart)}${insertion}${source.slice(closingStart)}`;
}

export function insertState(source: string, parent: ScxmlNode, type: StateElementType, id: string): string {
  if (parent.uri !== SCXML_NS || !['scxml', 'state', 'parallel'].includes(parent.local)) return source;
  if (parent.local === 'parallel' && type === 'final') return source;

  const range = openingTagRange(source, parent);
  if (!range) return source;
  const tagName = qualifiedChildName(parent, type);
  const child = `<${tagName} id="${escapeAttribute(id, '"')}"/>`;
  return insertChildMarkup(source, parent, child);
}

/** 创建带有合法初始配置的 SCXML 复合状态。 */
export function insertCompoundState(source: string, parent: ScxmlNode, id: string, initialChildId: string): string {
  if (parent.uri !== SCXML_NS || !['scxml', 'state', 'parallel'].includes(parent.local)) return source;
  const range = openingTagRange(source, parent);
  if (!range) return source;
  const [parentStart] = range;
  const childIndent = childIndentation(source, parent, parentStart);
  const parentIndent = indentationAt(source, parentStart) ?? '';
  const indentUnit = childIndent.startsWith(parentIndent) && childIndent.length > parentIndent.length
    ? childIndent.slice(parentIndent.length)
    : childIndent.includes('\t') ? '\t' : '  ';
  const stateName = qualifiedChildName(parent, 'state');
  const escapedId = escapeAttribute(id, '"');
  const escapedInitial = escapeAttribute(initialChildId, '"');
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
  const child = `<${stateName} id="${escapedId}" initial="${escapedInitial}">${lineEnding}${childIndent}${indentUnit}<${stateName} id="${escapedInitial}"/>${lineEnding}${childIndent}</${stateName}>`;
  return insertChildMarkup(source, parent, child);
}

/** 在普通或并行状态中插入一个可视化转换。 */
export function insertTransition(source: string, parent: ScxmlNode, attributes: TransitionAttributes): string {
  if (parent.uri !== SCXML_NS || !['state', 'parallel'].includes(parent.local)) return source;
  if (!attributes.target.trim()) return source;
  const tagName = qualifiedChildName(parent, 'transition');
  const values: Array<[string, string | undefined]> = [
    ['event', attributes.event?.trim()],
    ['cond', attributes.cond?.trim()],
    ['target', attributes.target.trim()],
    ['type', attributes.type || undefined],
  ];
  const serialized = values
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([name, value]) => ` ${name}="${escapeAttribute(value, '"')}"`)
    .join('');
  return insertChildMarkup(source, parent, `<${tagName}${serialized}/>`);
}

export function updateAttribute(source: string, node: ScxmlNode, name: string, value: string): string {
  const range = openingTagRange(source, node);
  if (!range) return source;
  const [start, end] = range;
  const tag = source.slice(start, end);
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(\\s${escapedName}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`);
  let nextTag: string;
  if (pattern.test(tag)) {
    nextTag = tag.replace(pattern, (_match, prefix: string, quote: string) => `${prefix}${quote}${escapeAttribute(value, quote)}${quote}`);
  } else if (!value) {
    return source;
  } else {
    const insertAt = tag.match(/\s*\/?>$/)?.index ?? tag.length - 1;
    nextTag = `${tag.slice(0, insertAt)} ${name}="${escapeAttribute(value, '"')}"${tag.slice(insertAt)}`;
  }
  if (!value) nextTag = nextTag.replace(pattern, '');
  return source.slice(0, start) + nextTag + source.slice(end);
}
