// node --test: tap or drag, and the button kept on screen (D-018).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampOffset, isDrag } from './rivy-drag.ts';

describe("Rivy's button: tap or drag", () => {
  it('a small movement is a tap (finger) or a click (mouse); more is a drag', () => {
    assert.equal(isDrag(6, 6, 'touch'), false);
    assert.equal(isDrag(8, 6, 'touch'), true);
    assert.equal(isDrag(3, 0, 'mouse'), false);
    assert.equal(isDrag(4, 0, 'mouse'), true);
    assert.equal(isDrag(0, -9, 'pen'), false);
  });
});

describe("Rivy's button: kept inside the area", () => {
  // A 56 px button in the bottom right corner of a 375 × 812 screen, above a
  // 64 px tab bar; the area leaves 8 px at each side and starts under a
  // 56 px top bar.
  const home = { left: 303, top: 680, right: 359, bottom: 736 };
  const area = { left: 8, top: 64, right: 367, bottom: 740 };

  it('any offset inside the area is kept', () => {
    assert.deepEqual(clampOffset({ x: -200, y: -300 }, home, area), { x: -200, y: -300 });
    assert.deepEqual(clampOffset({ x: 0, y: 0 }, home, area), { x: 0, y: 0 });
  });

  it('beyond an edge, it stops at that edge: never over the bars or off screen', () => {
    assert.deepEqual(clampOffset({ x: -1000, y: 0 }, home, area), { x: -295, y: 0 });
    assert.deepEqual(clampOffset({ x: 50, y: 0 }, home, area), { x: 8, y: 0 });
    assert.deepEqual(clampOffset({ x: 0, y: -1000 }, home, area), { x: 0, y: -616 });
    assert.deepEqual(clampOffset({ x: 0, y: 100 }, home, area), { x: 0, y: 4 });
  });

  it('after a rotation the same offset is brought back inside the new area', () => {
    // Landscape: 812 × 375; the corner moved with the screen.
    const homeLandscape = { left: 740, top: 243, right: 796, bottom: 299 };
    const areaLandscape = { left: 8, top: 64, right: 804, bottom: 303 };
    assert.deepEqual(clampOffset({ x: -200, y: -300 }, homeLandscape, areaLandscape), { x: -200, y: -179 });
  });

  it('an area smaller than the button keeps its top left corner inside', () => {
    assert.deepEqual(clampOffset({ x: 0, y: 0 }, { left: 0, top: 0, right: 56, bottom: 56 }, { left: 8, top: 8, right: 40, bottom: 40 }), { x: 8, y: 8 });
  });
});
