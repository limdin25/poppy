// Edge-based bridging is THE core mechanic: the edge IS the input assignment.
// These tests pin the full validity matrix, the auto-slot order, overflow
// rejection, targeted replace, and cycle/self/duplicate rejection.

import { describe, it, expect } from 'vitest';
import { canConnect, applyConnect, removeEdge } from '../../src/core/graph/connect';
import { doc, node, edge } from './helpers/build';

function videoDoc() {
  return doc({
    nodes: [
      node('img1', 'photo'),
      node('img2', 'photo'),
      node('img3', 'photo'),
      node('img4', 'photo'),
      node('img5', 'photo'),
      node('img6', 'photo'),
      node('img7', 'photo'),
      node('vox', 'voice'),
      node('vid', 'video'),
      node('sticky', 'note'),
      node('txt', 'text'),
    ],
  });
}

describe('canConnect: validity matrix', () => {
  it('image out -> video in: ok, lands on the first free slot (startImage)', () => {
    const r = canConnect(videoDoc(), { source: 'img1', target: 'vid' });
    expect(r).toEqual({ ok: true, slot: 'startImage' });
  });

  it('audio out -> video in: ok, lands on the audio slot', () => {
    const r = canConnect(videoDoc(), { source: 'vox', target: 'vid' });
    expect(r).toEqual({ ok: true, slot: 'audio' });
  });

  it('audio out -> photo in: type mismatch (photo only accepts images)', () => {
    const r = canConnect(videoDoc(), { source: 'vox', target: 'img1' });
    expect(r).toEqual({ ok: false, reason: 'type-mismatch' });
  });

  it('text out -> video in: type mismatch', () => {
    const r = canConnect(videoDoc(), { source: 'txt', target: 'vid' });
    expect(r).toEqual({ ok: false, reason: 'type-mismatch' });
  });

  it('a note produces nothing and can never be a source', () => {
    const r = canConnect(videoDoc(), { source: 'sticky', target: 'vid' });
    expect(r).toEqual({ ok: false, reason: 'no-output' });
  });

  it('voice accepts no inputs in phase 1', () => {
    const r = canConnect(videoDoc(), { source: 'img1', target: 'vox' });
    expect(r).toEqual({ ok: false, reason: 'type-mismatch' });
  });

  it('self connection rejected', () => {
    const r = canConnect(videoDoc(), { source: 'vid', target: 'vid' });
    expect(r).toEqual({ ok: false, reason: 'self' });
  });

  it('unknown nodes rejected', () => {
    const r = canConnect(videoDoc(), { source: 'ghost', target: 'vid' });
    expect(r).toEqual({ ok: false, reason: 'unknown-node' });
  });
});

describe('auto slot assignment order', () => {
  it('image connections fill startImage, endImage, then refImage1..4, then reject', () => {
    let d = videoDoc();
    const landed: string[] = [];
    for (const src of ['img1', 'img2', 'img3', 'img4', 'img5', 'img6']) {
      const r = canConnect(d, { source: src, target: 'vid' });
      expect(r.ok, `${src} should connect`).toBe(true);
      if (r.ok) {
        landed.push(r.slot);
        d = applyConnect(d, { source: src, target: 'vid' });
      }
    }
    expect(landed).toEqual(['startImage', 'endImage', 'refImage1', 'refImage2', 'refImage3', 'refImage4']);
    const overflow = canConnect(d, { source: 'img7', target: 'vid' });
    expect(overflow).toEqual({ ok: false, reason: 'no-free-slot' });
  });

  it('the same source connecting twice to the same node is a duplicate', () => {
    let d = videoDoc();
    d = applyConnect(d, { source: 'img1', target: 'vid' });
    const r = canConnect(d, { source: 'img1', target: 'vid' });
    expect(r).toEqual({ ok: false, reason: 'duplicate' });
  });
});

describe('targeted slot drop', () => {
  it('a drop on a named slot wins over auto order', () => {
    const r = canConnect(videoDoc(), { source: 'img1', target: 'vid', targetHandle: 'refImage3' });
    expect(r).toEqual({ ok: true, slot: 'refImage3' });
  });

  it('a drop on an occupied slot replaces the old edge deterministically', () => {
    let d = videoDoc();
    d = applyConnect(d, { source: 'img1', target: 'vid', targetHandle: 'startImage' });
    d = applyConnect(d, { source: 'img2', target: 'vid', targetHandle: 'startImage' });
    const bound = d.edges.filter((e) => e.target === 'vid' && e.targetHandle === 'startImage');
    expect(bound).toHaveLength(1);
    expect(bound[0]!.source).toBe('img2');
  });

  it('a drop on a slot that cannot accept the type is a mismatch even if named', () => {
    const r = canConnect(videoDoc(), { source: 'vox', target: 'vid', targetHandle: 'startImage' });
    expect(r).toEqual({ ok: false, reason: 'type-mismatch' });
  });
});

describe('cycles', () => {
  it('a connection that would create a cycle is rejected', () => {
    // photo img1 -> video vid exists; vid -> img1 would cycle.
    // Video output is video type; photo does not accept video, so build the
    // cycle through two photo nodes instead: img1 -> img2, then img2 -> img1.
    let d = videoDoc();
    d = applyConnect(d, { source: 'img1', target: 'img2', targetHandle: 'refImage1' });
    const r = canConnect(d, { source: 'img2', target: 'img1' });
    expect(r).toEqual({ ok: false, reason: 'cycle' });
  });

  it('longer cycles are caught too', () => {
    let d = videoDoc();
    d = applyConnect(d, { source: 'img1', target: 'img2', targetHandle: 'refImage1' });
    d = applyConnect(d, { source: 'img2', target: 'img3', targetHandle: 'refImage1' });
    const r = canConnect(d, { source: 'img3', target: 'img1' });
    expect(r).toEqual({ ok: false, reason: 'cycle' });
  });
});

describe('removeEdge', () => {
  it('deleting an edge removes the binding and nothing else', () => {
    let d = videoDoc();
    d = applyConnect(d, { source: 'img1', target: 'vid' });
    const e = d.edges[0]!;
    d = removeEdge(d, e.id);
    expect(d.edges).toHaveLength(0);
    expect(d.nodes).toHaveLength(videoDoc().nodes.length);
  });
});

describe('applyConnect rejects invalid connections loudly', () => {
  it('throws on an invalid connect instead of silently mutating', () => {
    expect(() => applyConnect(videoDoc(), { source: 'vid', target: 'vid' })).toThrow();
  });

  it('edge ids are deterministic so the same connect twice cannot fork history', () => {
    const a = applyConnect(videoDoc(), { source: 'img1', target: 'vid' });
    const b = applyConnect(videoDoc(), { source: 'img1', target: 'vid' });
    expect(a.edges[0]!.id).toBe(b.edges[0]!.id);
  });
});

// edge() helper is exercised implicitly; keep the import used.
void edge;
