import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Diagram from './Diagram';
import { analyzeScxml } from '../scxml/validator';
import { defaultScxml } from '../scxml/sample';

describe('SCXML visualization', () => {
  it('renders compound, parallel and final state semantics', () => {
    const root = analyzeScxml(defaultScxml).root!;
    const { container } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} showAllTransitions />);
    expect(container.querySelectorAll('.state-node.parallel')).toHaveLength(1);
    expect(container.querySelectorAll('.final-node')).toHaveLength(1);
    expect(container.querySelectorAll('.state-node')).toHaveLength(4);
    expect(container.querySelector('.flat-node.compound')).toBeInTheDocument();
    expect(container.querySelectorAll('.initial-marker').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.transition').length).toBeGreaterThan(0);
  });

  it('selects a state from the diagram', () => {
    const root = analyzeScxml(defaultScxml).root;
    const onSelect = vi.fn();
    const { container } = render(<Diagram root={root} invalidUids={new Set()} onSelect={onSelect} />);
    fireEvent.click(container.querySelector('.state-node.state')!);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('shows a recovery message without a model', () => {
    render(<Diagram invalidUids={new Set()} onSelect={() => undefined} />);
    expect(screen.getByText('修复 XML 语法后将恢复可视化')).toBeInTheDocument();
  });

  it('renders shallow and deep history pseudo states with SCXML notation', () => {
    const xml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null"><state id="a"><history id="h" type="deep"><transition target="b"/></history><state id="b"/></state></scxml>';
    const root = analyzeScxml(xml).root!;
    const scope = root.children.find((node) => node.attributes.id?.value === 'a');
    const { container } = render(<Diagram root={root} scope={scope} invalidUids={new Set()} onSelect={() => undefined} showAllTransitions />);
    expect(container.querySelector('.history-node')).toBeInTheDocument();
    expect(container.querySelector('.history-node')).toHaveTextContent('H*');
    expect(container.querySelectorAll('.transition')).toHaveLength(1);
  });

  it('visualizes default initial states and every parallel region entry', () => {
    const xml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null"><parallel id="p"><state id="left"><state id="l1"/></state><state id="right"><state id="r1"/></state></parallel></scxml>';
    const root = analyzeScxml(xml).root!;
    const parallel = root.children.find((node) => node.attributes.id?.value === 'p');
    const { container } = render(<Diagram root={root} scope={parallel} invalidUids={new Set()} onSelect={() => undefined} />);
    // Entering a parallel level marks every direct region as active initially.
    expect(container.querySelectorAll('.initial-marker')).toHaveLength(2);
  });

  it('hides dense edges until their source state is selected', () => {
    const root = analyzeScxml(defaultScxml).root!;
    const { container, rerender } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} />);
    expect(container.querySelectorAll('.transition')).toHaveLength(0);
    const idle = root.children.find((node) => node.local === 'state' && node.attributes.id?.value === 'idle')!;
    rerender(<Diagram root={root} selectedUid={idle.uid} invalidUids={new Set()} onSelect={() => undefined} />);
    expect(container.querySelectorAll('.transition')).toHaveLength(1);
  });

  it('uses a compact grid for compound states with many children', () => {
    const states = Array.from({ length: 12 }, (_, index) => `<state id="s${index}"/>`).join('');
    const root = analyzeScxml(`<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null"><state id="many">${states}</state></scxml>`).root!;
    const scope = root.children.find((node) => node.attributes.id?.value === 'many');
    const { container } = render(<Diagram root={root} scope={scope} invalidUids={new Set()} onSelect={() => undefined} />);
    const [, , width, height] = container.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    expect(width).toBeGreaterThan(height);
    expect(height).toBeLessThan(700);
  });

  it('summarizes long event lists while retaining full details in the tooltip', () => {
    const xml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null"><state id="a"><transition event="First Second Third Fourth" target="b"/></state><state id="b"/></scxml>';
    const root = analyzeScxml(xml).root;
    const { container } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} showAllTransitions />);
    expect(container.querySelector('.transition text')).toHaveTextContent('First +3');
    expect(container.querySelector('.transition title')).toHaveTextContent('First Second Third Fourth → b');
  });

  it('shows only one hierarchy level and enters compound states explicitly', () => {
    const root = analyzeScxml(defaultScxml).root!;
    const review = root.children.find((node) => node.attributes.id?.value === 'review')!;
    const onEnter = vi.fn();
    const { container, rerender } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} onEnter={onEnter} />);
    expect(container.querySelectorAll('.state-node')).toHaveLength(4);
    fireEvent.doubleClick([...container.querySelectorAll('.state-node')].find((node) => node.textContent?.includes('review'))!);
    expect(onEnter).toHaveBeenCalledWith(review);
    rerender(<Diagram root={root} scope={review} invalidUids={new Set()} onSelect={() => undefined} />);
    expect(container.querySelectorAll('.state-node')).toHaveLength(3);
    expect(container.textContent).toContain('manual');
    expect(container.textContent).not.toContain('fulfillment');
  });

  it('shows transitions owned by the current compound state as a compact strip', () => {
    const xml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="null"><state id="parent"><transition event="Reset Cancel" target="a"/><state id="a"/><state id="b"/></state></scxml>';
    const root = analyzeScxml(xml).root!;
    const parent = root.children.find((node) => node.attributes.id?.value === 'parent');
    const onSelect = vi.fn();
    const { container } = render(<Diagram root={root} scope={parent} invalidUids={new Set()} onSelect={onSelect} />);
    expect(container.querySelector('.scope-transition-strip')).toHaveTextContent('Reset +1');
    expect(container.querySelectorAll('.transition')).toHaveLength(0);
    fireEvent.click(container.querySelector('.scope-transition-strip button')!);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('drags a state and keeps its transition attached', () => {
    const root = analyzeScxml(defaultScxml).root!;
    const { container } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} showAllTransitions />);
    const svg = container.querySelector('svg')!;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 860, bottom: 470, width: 860, height: 470, toJSON: () => ({}) });
    const state = container.querySelector('.flat-node')!;
    const rect = state.querySelector(':scope > rect')!;
    const beforeX = Number(rect.getAttribute('x'));
    const pathBefore = container.querySelector('.transition path')!.getAttribute('d');
    fireEvent.pointerDown(state, { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: 150, clientY: 125 });
    fireEvent.pointerUp(svg, { pointerId: 7, clientX: 150, clientY: 125 });
    expect(Number(container.querySelector('.flat-node > rect')!.getAttribute('x'))).toBeGreaterThan(beforeX);
    expect(container.querySelector('.transition path')!.getAttribute('d')).not.toBe(pathBefore);
  });

  it('uses dedicated light transition arrows', () => {
    const root = analyzeScxml(defaultScxml).root;
    const { container } = render(<Diagram root={root} invalidUids={new Set()} onSelect={() => undefined} showAllTransitions />);
    expect(container.querySelector('#transition-arrow .transition-arrow-head')).toBeInTheDocument();
    expect(container.querySelector('.transition path')).toHaveAttribute('marker-end', 'url(#transition-arrow)');
  });
});
