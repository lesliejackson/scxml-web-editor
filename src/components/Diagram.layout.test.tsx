import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Diagram from './Diagram';
import { analyzeScxml } from '../scxml/validator';
import { attr, type ScxmlNode } from '../scxml/types';

function findById(node: ScxmlNode, id: string): ScxmlNode | undefined {
  if (attr(node, 'id') === id) return node;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found) return found;
  }
}

describe('diagram layered layout and edge routing', () => {
  it('gives bidirectional transitions two distinct non-overlapping paths', () => {
    const xml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null" initial="a"><state id="a"><transition event="go" target="b"/></state><state id="b"><transition event="back" target="a"/></state></scxml>';
    const root = analyzeScxml(xml).root!;
    const { container } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} showAllTransitions />);
    const paths = [...container.querySelectorAll('.transition path')].map((p) => p.getAttribute('d'));
    expect(paths).toHaveLength(2);
    expect(paths[0]).not.toBe(paths[1]);
  });

  it('ranks the flow left-to-right from the initial state', () => {
    const xml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null" initial="mid"><state id="last"/><state id="mid"><transition event="e" target="last"/></state><state id="first"><transition event="e" target="mid"/></state></scxml>';
    const root = analyzeScxml(xml).root!;
    const { container } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} showAllTransitions />);
    const x = (id: string) => {
      const g = [...container.querySelectorAll('.state-node')].find((n) => n.textContent?.includes(id))!;
      return Number(g.querySelector('rect')!.getAttribute('x'));
    };
    expect(x('first')).toBeLessThan(x('mid'));
    expect(x('mid')).toBeLessThan(x('last'));
  });

  it('lifts descendant transitions to the visible ancestor as dashed edges', () => {
    const xml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null" initial="outer"><state id="outer" initial="inner"><state id="inner"><transition event="leave" target="other"/></state></state><state id="other"/></scxml>';
    const root = analyzeScxml(xml).root!;
    const { container } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} showAllTransitions />);
    const lifted = container.querySelector('.transition.lifted');
    expect(lifted).toBeInTheDocument();
    expect(lifted!.querySelector('title')!.textContent).toContain('inner');
  });

  it('keeps each real target visible when transitions to different children merge into one edge', () => {
    const xml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null" initial="standby"><state id="standby"><transition event="AutoFront" target="front"/><transition event="AutoLeft" target="left"/></state><state id="views" initial="front"><state id="front"/><state id="left"/></state></scxml>';
    const root = analyzeScxml(xml).root!;
    const { container } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} showAllTransitions />);
    const edges = container.querySelectorAll('.transition');
    expect(edges).toHaveLength(1);
    const title = edges[0].querySelector('title')!.textContent!;
    expect(title).toContain('AutoFront → front');
    expect(title).toContain('AutoLeft → left');
    expect(edges[0].querySelector('text')).toHaveTextContent('2 目标');
  });

  it('shows ancestor-defined transitions from the selected child as inherited edges', () => {
    const xml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null" initial="views"><state id="views" initial="front"><transition event="GoHome" target="front"/><state id="front"/><state id="left"/></state></scxml>';
    const root = analyzeScxml(xml).root!;
    const views = findById(root, 'views')!;
    const left = findById(root, 'left')!;
    const { container } = render(<Diagram root={root} scope={views} selectedUid={left.uid} invalidUids={new Set()} onSelect={() => undefined} />);
    const inherited = container.querySelector('.transition.inherited');
    expect(inherited).toBeInTheDocument();
    const title = inherited!.querySelector('title')!.textContent!;
    expect(title).toContain('GoHome');
    expect(title).toContain('继承自父状态 views');

    const { container: unselected } = render(<Diagram root={root} scope={views} invalidUids={new Set()} onSelect={() => undefined} />);
    expect(unselected.querySelector('.transition.inherited')).toBeNull();
  });

  it('expands the canvas to fill a viewport larger than the layout content', () => {
    const widthSpy = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1600);
    const heightSpy = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(1200);
    try {
      const xml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null" initial="a"><state id="a"/><state id="b"/></scxml>';
      const root = analyzeScxml(xml).root!;
      const { container } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} />);
      const svg = container.querySelector('svg')!;
      expect(Number(svg.getAttribute('width'))).toBe(1600);
      expect(Number(svg.getAttribute('height'))).toBe(1200);
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it('keeps internal descendant transitions off the parent level', () => {
    const xml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null" initial="outer"><state id="outer" initial="a"><state id="a"><transition event="e" target="b"/></state><state id="b"/></state><state id="other"/></scxml>';
    const root = analyzeScxml(xml).root!;
    const { container } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} showAllTransitions />);
    expect(container.querySelectorAll('.transition')).toHaveLength(0);
  });
});
