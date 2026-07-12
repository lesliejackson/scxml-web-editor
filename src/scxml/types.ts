export const SCXML_NS = 'http://www.w3.org/2005/07/scxml';

export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
  endLine?: number;
  endColumn?: number;
  endOffset?: number;
}

export interface ScxmlAttribute {
  name: string;
  local: string;
  uri: string;
  value: string;
}

export interface ScxmlNode {
  uid: string;
  name: string;
  local: string;
  uri: string;
  attributes: Record<string, ScxmlAttribute>;
  children: ScxmlNode[];
  text: string;
  parent?: ScxmlNode;
  loc: SourceLocation;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  loc: SourceLocation;
  nodeUid?: string;
}

export interface ParseResult {
  root?: ScxmlNode;
  diagnostics: Diagnostic[];
}

export const stateElements = new Set(['state', 'parallel', 'final']);
export const pseudoStateElements = new Set(['initial', 'history']);

export function attr(node: ScxmlNode, name: string): string | undefined {
  return node.attributes[name]?.value;
}

export function scxmlChildren(node: ScxmlNode, local?: string): ScxmlNode[] {
  return node.children.filter(
    (child) => child.uri === SCXML_NS && (!local || child.local === local),
  );
}

export function childStates(node: ScxmlNode): ScxmlNode[] {
  return scxmlChildren(node).filter((child) => stateElements.has(child.local));
}

export function displayName(node: ScxmlNode): string {
  return attr(node, 'id') || `<${node.local}>`;
}
