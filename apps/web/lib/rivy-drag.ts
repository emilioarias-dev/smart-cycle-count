// Dragging Rivy's floating button (D-018): pure geometry, so it can be
// tested without a browser. The button keeps its corner in CSS; an offset
// from that corner moves it.

export type Point = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };

// A press that moves less than this is a tap or a click, never a drag: a
// finger shakes more than a mouse.
export function dragSlop(pointerType: string): number {
  return pointerType === 'mouse' ? 4 : 10;
}

export function isDrag(dx: number, dy: number, pointerType: string): boolean {
  return Math.hypot(dx, dy) >= dragSlop(pointerType);
}

// The closest offset that keeps the button inside the area. `home` is the
// button's box at offset 0. If the area is smaller than the button, its top
// left corner stays inside.
export function clampOffset(offset: Point, home: Box, area: Box): Point {
  const x = Math.max(area.left - home.left, Math.min(offset.x, area.right - home.right));
  const y = Math.max(area.top - home.top, Math.min(offset.y, area.bottom - home.bottom));
  return { x, y };
}
