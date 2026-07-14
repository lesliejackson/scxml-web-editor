import { describe, expect, it } from 'vitest';
import { insertCompoundState, insertState, insertTransition, updateAttribute } from './editor';
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

  it('inserts a state at the current level while preserving indentation', () => {
    const source = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0">\n  <state id="a"/>\n</scxml>';
    const root = parseScxml(source).root!;
    expect(insertState(source, root, 'state', 'b')).toBe(
      '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0">\n  <state id="a"/>\n  <state id="b"/>\n</scxml>',
    );
  });

  it('expands a self-closing parent when inserting a child state', () => {
    const source = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0">\n  <state id="parent"/>\n</scxml>';
    const parent = parseScxml(source).root!.children[0];
    expect(insertState(source, parent, 'final', 'done')).toContain(
      '  <state id="parent">\n    <final id="done"/>\n  </state>',
    );
  });

  it('preserves an SCXML namespace prefix for inserted states', () => {
    const source = '<s:scxml xmlns:s="http://www.w3.org/2005/07/scxml" version="1.0"><s:state id="a"/></s:scxml>';
    const root = parseScxml(source).root!;
    expect(insertState(source, root, 'parallel', 'work')).toContain('<s:parallel id="work"/>');
  });

  it('inserts a compound state with an initial child state', () => {
    const source = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0">\n  <state id="a"/>\n</scxml>';
    const root = parseScxml(source).root!;
    expect(insertCompoundState(source, root, 'parent', 'first')).toContain(
      '  <state id="parent" initial="first">\n    <state id="first"/>\n  </state>',
    );
  });

  it('preserves an SCXML namespace prefix for compound states', () => {
    const source = '<s:scxml xmlns:s="http://www.w3.org/2005/07/scxml" version="1.0"/>';
    const root = parseScxml(source).root!;
    expect(insertCompoundState(source, root, 'parent', 'first')).toContain(
      '<s:state id="parent" initial="first"><s:state id="first"/></s:state>',
    );
  });

  it('inserts a transition and expands a self-closing source state', () => {
    const source = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0">\n  <state id="a"/>\n  <state id="b"/>\n</scxml>';
    const owner = parseScxml(source).root!.children[0];
    expect(insertTransition(source, owner, { target: 'b', event: 'go', cond: 'x < 2', type: 'external' })).toContain(
      '  <state id="a">\n    <transition event="go" cond="x &lt; 2" target="b" type="external"/>\n  </state>',
    );
  });

  it('does not insert transitions into final states', () => {
    const source = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0"><final id="done"/></scxml>';
    const owner = parseScxml(source).root!.children[0];
    expect(insertTransition(source, owner, { target: 'done' })).toBe(source);
  });

  it('does not insert final states directly under parallel states', () => {
    const source = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0"><parallel id="work"><state id="a"/></parallel></scxml>';
    const parent = parseScxml(source).root!.children[0];
    expect(insertState(source, parent, 'final', 'done')).toBe(source);
  });

  it('does not insert into an element outside the SCXML namespace', () => {
    const source = '<state xmlns="urn:example" id="foreign"/>';
    const parent = parseScxml(source).root!;
    expect(insertState(source, parent, 'state', 'child')).toBe(source);
  });
});
