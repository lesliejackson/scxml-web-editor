import type { ScxmlNode } from './types';

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
