import { describe, expect, it } from 'vitest';
import { updateAttribute } from './editor';
import { parseScxml } from './parser';

describe('minimal source edits', () => {
  it('updates an existing attribute without reformatting the document', () => {
    const source = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0"><state id="old" /></scxml>';
    const state = parseScxml(source).root!.children[0];
    expect(updateAttribute(source, state, 'id', 'new')).toBe(source.replace('id="old"', 'id="new"'));
  });

  it('adds and removes attributes while preserving other text', () => {
    const source = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0">\n  <state id="a"/>\n</scxml>';
    const state = parseScxml(source).root!.children[0];
    const added = updateAttribute(source, state, 'initial', 'child');
    expect(added).toContain('<state id="a" initial="child"/>');
    const reparsed = parseScxml(added).root!.children[0];
    expect(updateAttribute(added, reparsed, 'initial', '')).toContain('<state id="a"/>');
  });

  it('escapes XML attribute values', () => {
    const source = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0"><state id="a"/></scxml>';
    const state = parseScxml(source).root!.children[0];
    expect(updateAttribute(source, state, 'id', 'a&b"c')).toContain('id="a&amp;b&quot;c"');
  });
});
