import { SaxesParser, type SaxesTagNS } from 'saxes';
import { type Diagnostic, type ParseResult, type ScxmlNode } from './types';

function makeSyntaxDiagnostic(message: string, line: number, column: number, offset: number): Diagnostic {
  return {
    code: 'xml.syntax',
    severity: 'error',
    message: message.replace(/^\d+:\d+:\s*/, ''),
    loc: { line: Math.max(1, line), column: Math.max(1, column), offset: Math.max(0, offset) },
  };
}

export function parseScxml(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const stack: ScxmlNode[] = [];
  let root: ScxmlNode | undefined;
  let serial = 0;
  let openStart = { line: 1, column: 1, offset: 0 };
  const parser = new SaxesParser({ xmlns: true, position: true });

  parser.on('opentagstart', () => {
    openStart = {
      line: parser.line + 1,
      column: Math.max(1, parser.column),
      offset: Math.max(0, parser.position - 1),
    };
  });

  parser.on('opentag', (tag: SaxesTagNS) => {
    const attributes: ScxmlNode['attributes'] = {};
    Object.values(tag.attributes).forEach((raw) => {
      if (typeof raw === 'string') return;
      attributes[raw.name] = {
        name: raw.name,
        local: raw.local,
        uri: raw.uri,
        value: raw.value,
      };
      if (!raw.prefix && !attributes[raw.local]) attributes[raw.local] = attributes[raw.name];
    });
    const parent = stack.at(-1);
    const node: ScxmlNode = {
      uid: `n${serial++}`,
      name: tag.name,
      local: tag.local,
      uri: tag.uri,
      attributes,
      children: [],
      text: '',
      parent,
      loc: { ...openStart },
    };
    if (parent) parent.children.push(node);
    else if (!root) root = node;
    stack.push(node);
  });

  parser.on('text', (text) => {
    const current = stack.at(-1);
    if (current) current.text += text;
  });
  parser.on('cdata', (text) => {
    const current = stack.at(-1);
    if (current) current.text += text;
  });

  parser.on('closetag', () => {
    const node = stack.pop();
    if (node) {
      node.loc.endLine = parser.line + 1;
      node.loc.endColumn = parser.column + 1;
      node.loc.endOffset = parser.position;
    }
  });

  parser.on('error', (error) => {
    diagnostics.push(makeSyntaxDiagnostic(error.message, parser.line + 1, parser.column + 1, parser.position));
  });

  try {
    parser.write(source).close();
  } catch (error) {
    if (!diagnostics.length) {
      diagnostics.push(
        makeSyntaxDiagnostic(error instanceof Error ? error.message : String(error), parser.line + 1, parser.column + 1, parser.position),
      );
    }
  }

  if (!source.trim()) {
    diagnostics.push(makeSyntaxDiagnostic('文档不能为空', 1, 1, 0));
  }
  return { root, diagnostics };
}
