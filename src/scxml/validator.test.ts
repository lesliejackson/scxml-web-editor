import { describe, expect, it } from 'vitest';
import { analyzeScxml } from './validator';
import { defaultScxml } from './sample';

function codes(xml: string) {
  return analyzeScxml(xml).diagnostics.map((item) => item.code);
}

const wrap = (body: string, attributes = 'version="1.0" datamodel="null"') =>
  `<scxml xmlns="http://www.w3.org/2005/07/scxml" ${attributes}>${body}</scxml>`;

describe('SCXML document validation', () => {
  it('accepts the bundled hierarchical and parallel example', () => {
    expect(analyzeScxml(defaultScxml).diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  });

  it('reports malformed XML with a line and column', () => {
    const result = analyzeScxml('<scxml><state></scxml>');
    expect(result.diagnostics[0].code).toBe('xml.syntax');
    expect(result.diagnostics[0].loc.line).toBeGreaterThan(0);
  });

  it('requires the standard namespace and version', () => {
    const result = codes('<scxml version="2.0"><state id="a"/></scxml>');
    expect(result).toContain('root.invalid');
  });

  it('requires at least one child state', () => {
    expect(codes(wrap(''))).toContain('scxml.empty');
  });

  it('detects duplicate and invalid IDs', () => {
    const result = codes(wrap('<state id="not valid"/><state id="same"/><final id="same"/>'));
    expect(result).toContain('id.invalid');
    expect(result).toContain('id.duplicate');
  });

  it('detects unresolved transition targets', () => {
    expect(codes(wrap('<state id="a"><transition event="go" target="missing"/></state>'))).toContain('target.missing');
  });

  it('rejects initial declarations on atomic states', () => {
    expect(codes(wrap('<state id="a" initial="x"/>'))).toContain('atomic.initial');
  });

  it('rejects initial attributes and initial elements used together', () => {
    const result = codes(wrap('<state id="parent" initial="a"><initial><transition target="a"/></initial><state id="a"/></state>'));
    expect(result).toContain('initial.conflict');
  });

  it('requires an eventless and unconditional initial transition', () => {
    const result = codes(wrap('<state id="parent"><initial><transition event="go" cond="true"/></initial><state id="a"/></state>'));
    expect(result).toContain('initial.transition.event');
    expect(result).toContain('initial.target');
  });

  it('checks initial target scope', () => {
    const result = codes(wrap('<state id="outside"/><state id="parent" initial="outside"><state id="inside"/></state>'));
    expect(result).toContain('initial.scope');
  });

  it('rejects empty parallel states', () => {
    expect(codes(wrap('<parallel id="p"/>'))).toContain('parallel.empty');
  });

  it('checks attribute and child-content mutual exclusion', () => {
    const xml = wrap('<state id="a"><onentry><send event="x" eventexpr="x"><content/><param name="p"/></send></onentry></state>');
    const result = codes(xml);
    expect(result).toContain('attribute.exclusive');
    expect(result).toContain('content.param.exclusive');
  });

  it('rejects data model content in the null data model', () => {
    const result = codes(wrap('<datamodel><data id="x" expr="1"/></datamodel><state id="a"/>'));
    expect(result).toContain('null-datamodel.unsupported');
  });

  it('rejects ancestor and descendant as simultaneous targets', () => {
    const xml = wrap('<state id="a"><state id="b"/></state><state id="source"><transition target="a b"/></state>');
    expect(codes(xml)).toContain('target.configuration');
  });

  it('retains executable foreign namespace extensions', () => {
    const result = analyzeScxml(wrap('<state id="a"><onentry><ext:trace xmlns:ext="urn:test"/></onentry></state>'));
    expect(result.diagnostics.some((item) => item.code === 'element.unknown')).toBe(false);
    expect(result.diagnostics.some((item) => item.code === 'extension.location')).toBe(false);
  });

  it('rejects extensions outside executable content', () => {
    expect(codes(wrap('<state id="a"><ext:trace xmlns:ext="urn:test"/></state>'))).toContain('extension.location');
  });

  it('checks executable content required attributes and if ordering', () => {
    const xml = wrap('<state id="a"><onentry><if><else/><else/><elseif/></if><foreach/></onentry></state>', 'version="1.0" datamodel="ecmascript"');
    const result = codes(xml);
    expect(result).toContain('conditional.cond');
    expect(result).toContain('else.multiple');
    expect(result).toContain('elseif.order');
    expect(result).toContain('foreach.array');
    expect(result).toContain('foreach.item');
  });

  it('requires donedata content and checks cardinality', () => {
    expect(codes(wrap('<final id="done"><donedata/></final>'))).toContain('donedata.empty');
  });

  it('reports attributes that are not defined for an SCXML element', () => {
    const result = codes(wrap('<parallel id="p" initial="not-allowed"><state id="a"/></parallel>'));
    expect(result).toContain('attribute.unknown');
  });

  it('checks param expression and location exclusivity', () => {
    const result = codes(wrap('<final id="done"><donedata><param name="p" expr="1" location="x"/></donedata></final>'));
    expect(result).toContain('attribute.exclusive');
  });
});
