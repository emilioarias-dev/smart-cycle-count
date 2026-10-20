'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { type Bin3D, FOOTPRINT, type Layout3D, layout3d, viewDirection } from '../lib/heatmap3d';
import { plural } from '../lib/format';
import { Icon } from './Icon';

// The 3D heatmap (D-015). Loaded only when the 3D view is chosen. Fixed
// orientation with an orthographic camera; zoom within limits; pan by
// dragging (mouse) or with two fingers (touch); one finger keeps scrolling
// the page; a click or tap selects a bin and keeps its details. Reset
// frames the whole plan again for the current size of the view.

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const DRAG_THRESHOLD = 6;
// Band kept free at the top of the view for the zoom and reset buttons.
const CONTROLS_BAND = 56;

type Hover = { code: string; x: number; y: number } | null;
type Labels = { rows: { text: string; x: number; y: number }[]; columns: { text: string; x: number; y: number }[]; selected: { x: number; y: number } | null };

type Stage = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: OrthographicCamera;
  bins: Group;
  floor: Group;
  meshes: Mesh[];
  layout: Layout3D | null;
  // Size of the plan seen from the camera (view units), and the home target.
  content: { width: number; height: number } | null;
  home: Vector3;
  target: Vector3;
};

function cssColor(name: string): Color {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return new Color(value);
}

// Remove and free every geometry and material under a group.
function disposeGroup(group: Group) {
  group.traverse((child) => {
    const object = child as Mesh | LineSegments;
    object.geometry?.dispose();
    const material = object.material;
    (Array.isArray(material) ? material : material ? [material] : []).forEach((m) => m.dispose());
  });
  group.clear();
}

export default function Heatmap3D({ bins, scoresAsOf, onFail }: { bins: Bin3D[]; scoresAsOf: string; onFail: (reason: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [labels, setLabels] = useState<Labels>({ rows: [], columns: [], selected: null });
  const [zoom, setZoom] = useState(1);
  const [theme, setTheme] = useState(0);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  // Project the label anchors (and the selected bin's top) to the view.
  const render = useCallback(() => {
    const s = stage.current;
    const el = host.current;
    if (!s || !el || !s.layout) {
      return;
    }
    s.renderer.render(s.scene, s.camera);
    const w = el.clientWidth;
    const h = el.clientHeight;
    const toScreen = (x: number, y: number, z: number) => {
      const p = new Vector3(x, y, z).project(s.camera);
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
    };
    const cell = s.layout.cells.find((c) => c.bin.code === selectedRef.current);
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    // Labels stay whole: kept inside the view, hidden when their row or
    // column is out of it (after zooming in).
    setLabels({
      rows: s.layout.rows
        .map((r) => ({ text: r.text, ...toScreen(r.x, 0, r.z) }))
        .filter((l) => l.y > 8 && l.y < h - 8)
        .map((l) => ({ ...l, x: clamp(l.x, 46, w) })),
      columns: s.layout.columns
        .map((c) => ({ text: c.text, ...toScreen(c.x, 0, c.z) }))
        .filter((l) => l.x > 12 && l.x < w - 12)
        .map((l) => ({ ...l, y: clamp(l.y, 0, h - 18) })),
      selected: cell ? (({ x, y }) => ({ x: clamp(x, 52, w - 52), y: clamp(y, 34, h) }))(toScreen(cell.x, cell.height, cell.z)) : null,
    });
    setZoom(s.camera.zoom);
  }, []);

  // Frustum for the current container size: at zoom 1 the whole plan fits
  // below the band of the buttons, centred in the rest of the view.
  const applyFrustum = useCallback(() => {
    const s = stage.current;
    const el = host.current;
    if (!s || !el || !s.content) {
      return;
    }
    const height = Math.max(1, el.clientHeight);
    const free = 1 - CONTROLS_BAND / height;
    const aspect = el.clientWidth / height;
    const halfH = Math.max(s.content.height / 2 / free, s.content.width / 2 / aspect) * 1.04;
    const halfW = halfH * aspect;
    const shift = (halfH * CONTROLS_BAND) / height;
    Object.assign(s.camera, { left: -halfW, right: halfW, top: halfH + shift, bottom: -halfH + shift });
    s.camera.updateProjectionMatrix();
  }, []);

  const placeCamera = useCallback((target: Vector3) => {
    const s = stage.current!;
    const d = viewDirection();
    s.target.copy(target);
    s.camera.position.copy(target).add(new Vector3(d.x, d.y, d.z).multiplyScalar(40));
    s.camera.lookAt(target);
    s.camera.updateMatrixWorld();
  }, []);

  // Home view: the plan (floor, labels and the tallest column) centred and
  // fitted to the current container.
  const reset = useCallback(() => {
    const s = stage.current;
    if (!s || !s.layout) {
      return;
    }
    const { bounds } = s.layout;
    const top = Math.max(...s.layout.cells.map((c) => c.height));
    placeCamera(new Vector3(0, 0, 0));
    const view = s.camera.matrixWorldInverse;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const y of [0, top]) {
        for (const z of [bounds.minZ, bounds.maxZ]) {
          const p = new Vector3(x, y, z).applyMatrix4(view);
          xs.push(p.x);
          ys.push(p.y);
        }
      }
    }
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    s.content = { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    const right = new Vector3().setFromMatrixColumn(s.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(s.camera.matrixWorld, 1);
    s.home = right.multiplyScalar(cx).add(up.multiplyScalar(cy));
    placeCamera(s.home.clone());
    s.camera.zoom = 1;
    applyFrustum();
    render();
  }, [applyFrustum, placeCamera, render]);

  // Move the view by (dx, dy) view units, keeping the plan's centre inside it.
  const pan = useCallback(
    (dx: number, dy: number) => {
      const s = stage.current;
      if (!s || !s.content) {
        return;
      }
      const right = new Vector3().setFromMatrixColumn(s.camera.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(s.camera.matrixWorld, 1);
      const next = s.target.clone().addScaledVector(right, dx).addScaledVector(up, dy);
      const offset = next.clone().sub(s.home);
      const ox = Math.max(-s.content.width / 2, Math.min(s.content.width / 2, offset.dot(right)));
      const oy = Math.max(-s.content.height / 2, Math.min(s.content.height / 2, offset.dot(up)));
      placeCamera(s.home.clone().addScaledVector(right, ox).addScaledVector(up, oy));
      render();
    },
    [placeCamera, render],
  );

  // Zoom by a factor, keeping the point under (px, py) in place.
  const zoomBy = useCallback(
    (factor: number, px?: number, py?: number) => {
      const s = stage.current;
      const el = host.current;
      if (!s || !el) {
        return;
      }
      const before = s.camera.zoom;
      const after = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, before * factor));
      if (after === before) {
        return;
      }
      const nx = px === undefined ? 0 : (px / el.clientWidth) * 2 - 1;
      const ny = py === undefined ? 0 : 1 - (py / el.clientHeight) * 2;
      // The point under (px, py), in view units from the camera, at zoom 1.
      const ux = nx * s.camera.right;
      const uy = (s.camera.top + s.camera.bottom) / 2 + (ny * (s.camera.top - s.camera.bottom)) / 2;
      s.camera.zoom = after;
      s.camera.updateProjectionMatrix();
      if (after === MIN_ZOOM) {
        placeCamera(s.home.clone());
        render();
        return;
      }
      pan(ux * (1 / before - 1 / after), uy * (1 / before - 1 / after));
    },
    [pan, placeCamera, render],
  );

  const pick = useCallback((clientX: number, clientY: number): string | null => {
    const s = stage.current;
    if (!s) {
      return null;
    }
    const r = s.renderer.domElement.getBoundingClientRect();
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), s.camera);
    return (ray.intersectObjects(s.meshes)[0]?.object.userData.code as string | undefined) ?? null;
  }, []);

  const select = useCallback(
    (code: string | null) => {
      selectedRef.current = code;
      setSelected(code);
      const s = stage.current;
      if (s) {
        // The selected bin: an accent outline and a frame on the floor; its
        // band color stays as it is.
        for (const child of s.bins.children) {
          if (child.userData.kind === 'selection') {
            child.visible = child.userData.code === code;
          }
        }
        render();
      }
    },
    [render],
  );

  // Scene, camera, controls and their clean-up.
  useEffect(() => {
    const el = host.current!;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      failRef.current('WebGL is not available in this browser.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.prepend(renderer.domElement);

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    scene.add(new AmbientLight(0xffffff, 1.7));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(-3, 8, 5);
    scene.add(sun);
    const floor = new Group();
    const binsGroup = new Group();
    scene.add(floor, binsGroup);
    stage.current = { renderer, scene, camera, bins: binsGroup, floor, meshes: [], layout: null, content: null, home: new Vector3(), target: new Vector3() };

    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight, false);
      applyFrustum();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    // Two fingers pan and zoom the plan; one finger keeps scrolling the page.
    let pinch: { x: number; y: number; distance: number } | null = null;
    // Mouse and pen: drag pans, a click selects, hover shows code and score.
    let press: { id: number; x: number; y: number; dragging: boolean } | null = null;
    const canvas = renderer.domElement;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        press = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
        return;
      }
      if (e.button !== 0) {
        return;
      }
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD) {
          press.dragging = true;
        }
        return;
      }
      if (press && press.id === e.pointerId) {
        const dx = e.clientX - press.x;
        const dy = e.clientY - press.y;
        if (press.dragging || Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          press.dragging = true;
          const s = stage.current!;
          const unit = (s.camera.right - s.camera.left) / s.camera.zoom / el.clientWidth;
          pan(-dx * unit, dy * unit);
          press.x = e.clientX;
          press.y = e.clientY;
          setHover(null);
          el.classList.add('dragging');
        }
        return;
      }
      const code = pick(e.clientX, e.clientY);
      setHover(code ? { code, ...local(e) } : null);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!press || press.id !== e.pointerId) {
        return;
      }
      const wasDrag = press.dragging;
      press = null;
      el.classList.remove('dragging');
      if (!wasDrag && !pinch) {
        const code = pick(e.clientX, e.clientY);
        if (code) {
          select(code);
        }
      }
    };
    const onPointerCancel = () => {
      press = null;
      el.classList.remove('dragging');
    };
    const onPointerLeave = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') {
        setHover(null);
      }
    };
    // Ctrl + wheel (and a trackpad pinch) zooms; a plain wheel scrolls the page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) {
        return;
      }
      e.preventDefault();
      const p = local(e);
      zoomBy(Math.exp(-e.deltaY * 0.01), p.x, p.y);
    };
    const twoFingers = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      const r = canvas.getBoundingClientRect();
      return { x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top, distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pinch = twoFingers(e);
        press = null;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) {
        return;
      }
      e.preventDefault();
      const now = twoFingers(e);
      const s = stage.current!;
      const unit = (s.camera.right - s.camera.left) / s.camera.zoom / el.clientWidth;
      pan(-(now.x - pinch.x) * unit, (now.y - pinch.y) * unit);
      zoomBy(now.distance / pinch.distance, now.x, now.y);
      pinch = now;
    };
    // After a two-finger gesture, a tap selects again only once every finger
    // has lifted.
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        pinch = null;
      }
    };
    const onContextLost = (e: Event) => {
      e.preventDefault();
      failRef.current('The 3D view lost its WebGL context.');
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
    canvas.addEventListener('webglcontextlost', onContextLost);

    // Colors follow the theme (toggle or system).
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => setTheme((t) => t + 1);
    media.addEventListener('change', onTheme);
    const themeObserver = new MutationObserver(onTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      media.removeEventListener('change', onTheme);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      disposeGroup(binsGroup);
      disposeGroup(floor);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      stage.current = null;
    };
  }, [applyFrustum, pan, pick, render, select, zoomBy]);

  // Blocks, floor and colors from the data (and again when data or theme change).
  useEffect(() => {
    const s = stage.current;
    if (!s) {
      return;
    }
    const first = s.layout === null;
    const layout = layout3d(bins);
    s.layout = layout;
    disposeGroup(s.bins);
    disposeGroup(s.floor);

    const { bounds } = layout;
    const plane = new Mesh(new PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ), new MeshLambertMaterial({ color: cssColor('--surface-2') }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((bounds.minX + bounds.maxX) / 2, -0.002, (bounds.minZ + bounds.maxZ) / 2);
    s.floor.add(plane);
    // One darker strip per aisle groups its racks.
    const aisles = [...new Set(layout.cells.map((c) => c.bin.aisle))];
    for (const aisle of aisles) {
      const zs = layout.cells.filter((c) => c.bin.aisle === aisle).map((c) => c.z);
      const xs = layout.cells.map((c) => c.x);
      const strip = new Mesh(
        new PlaneGeometry(Math.max(...xs) - Math.min(...xs) + FOOTPRINT + 0.3, Math.max(...zs) - Math.min(...zs) + FOOTPRINT + 0.3),
        new MeshLambertMaterial({ color: cssColor('--line') }),
      );
      strip.rotation.x = -Math.PI / 2;
      strip.position.set((Math.max(...xs) + Math.min(...xs)) / 2, -0.001, (Math.max(...zs) + Math.min(...zs)) / 2);
      s.floor.add(strip);
    }

    const accent = cssColor('--accent-text');
    const meshes: Mesh[] = [];
    for (const cell of layout.cells) {
      const scored = cell.bin.score !== null;
      const geometry = new BoxGeometry(FOOTPRINT, cell.height, FOOTPRINT);
      const material = new MeshLambertMaterial({
        color: scored ? cssColor(`--${cell.bin.score!.priority}-edge`) : cssColor('--surface'),
        transparent: !scored,
        opacity: scored ? 1 : 0.9,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(cell.x, cell.height / 2, cell.z);
      mesh.userData = { code: cell.bin.code, kind: 'bin' };
      s.bins.add(mesh);
      meshes.push(mesh);
      // A bin without a score: a flat tile with a dashed outline.
      if (!scored) {
        const dashed = new LineSegments(new EdgesGeometry(geometry), new LineDashedMaterial({ color: cssColor('--muted'), dashSize: 0.08, gapSize: 0.06 }));
        dashed.computeLineDistances();
        dashed.position.copy(mesh.position);
        dashed.userData = { code: cell.bin.code, kind: 'unscored' };
        s.bins.add(dashed);
      }
      const selection = new Group();
      const outline = new LineSegments(new EdgesGeometry(new BoxGeometry(FOOTPRINT + 0.06, cell.height + 0.04, FOOTPRINT + 0.06)), new LineBasicMaterial({ color: accent }));
      outline.position.y = cell.height / 2 + 0.01;
      selection.add(outline);
      const side = FOOTPRINT + 0.3;
      for (const [w, d, dx, dz] of [
        [side, 0.1, 0, side / 2],
        [side, 0.1, 0, -side / 2],
        [0.1, side, side / 2, 0],
        [0.1, side, -side / 2, 0],
      ]) {
        const bar = new Mesh(new BoxGeometry(w, 0.02, d), new MeshLambertMaterial({ color: accent }));
        bar.position.set(dx, 0.01, dz);
        selection.add(bar);
      }
      selection.position.set(cell.x, 0, cell.z);
      selection.visible = cell.bin.code === selectedRef.current;
      selection.userData = { code: cell.bin.code, kind: 'selection' };
      s.bins.add(selection);
    }
    s.meshes = meshes;
    if (first) {
      reset();
    } else {
      render();
    }
  }, [bins, theme, render, reset]);

  // From the list: select, and bring the bin into view when zoomed in.
  const selectFromList = (code: string | null) => {
    const s = stage.current;
    const cell = s?.layout?.cells.find((c) => c.bin.code === code);
    if (s && cell && s.camera.zoom > MIN_ZOOM) {
      const p = new Vector3(cell.x, cell.height, cell.z).applyMatrix4(s.camera.matrixWorldInverse);
      pan(p.x, p.y);
    }
    select(code);
  };

  const bin = bins.find((b) => b.code === selected) ?? null;
  const hovered = hover ? bins.find((b) => b.code === hover.code) : null;

  return (
    <div className="h3d">
      <div className="h3d-toolbar">
        <label className="sr-only" htmlFor="h3d-bin">
          Select a bin in the 3D view
        </label>
        <select id="h3d-bin" className="input h3d-select" value={selected ?? ''} onChange={(e) => selectFromList(e.target.value || null)}>
          <option value="">Select a bin…</option>
          {bins.map((b) => (
            <option key={b.code} value={b.code}>
              {b.code} · {b.score ? `${b.score.value} ${b.score.priority}` : 'not scored'}
            </option>
          ))}
        </select>
      </div>
      <div className="h3d-stage" ref={host}>
        {/* Kept inside the view, so they stay at hand while it is on screen. */}
        <div className="h3d-buttons" role="group" aria-label="3D view">
          <button type="button" className="icon-btn" aria-label="Zoom in" title="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy(1.4)}>
            <Icon name="plus" />
          </button>
          <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => zoomBy(1 / 1.4)}>
            <Icon name="minus" />
          </button>
          <button type="button" className="icon-btn" aria-label="Reset view" title="Reset view" onClick={reset}>
            <Icon name="home" />
          </button>
        </div>
        <div className="h3d-labels" aria-hidden="true">
          {labels.rows.map((l) => (
            <span key={l.text} className="h3d-label row" style={{ left: l.x, top: l.y }}>
              {l.text}
            </span>
          ))}
          {labels.columns.map((l) => (
            <span key={l.text} className="h3d-label column" style={{ left: l.x, top: l.y }}>
              {l.text}
            </span>
          ))}
          {bin && labels.selected && (
            <span className="h3d-tag" style={{ left: labels.selected.x, top: labels.selected.y }}>
              {bin.code} · {bin.score ? bin.score.value : 'no score'}
            </span>
          )}
        </div>
        {hovered && hover && hovered.code !== selected && (
          <span className="h3d-tag hover" style={{ left: hover.x, top: hover.y - 10 }} aria-hidden="true">
            {hovered.code} · {hovered.score ? hovered.score.value : 'no score'}
          </span>
        )}
      </div>
      <p className="note h3d-note">
        <Icon name="info" />
        <span>
          Height and color: score on one 0–100 scale (a 0 keeps a base; a dashed flat tile has no score). Rows are racks (A-01 … C-02),
          columns positions 01–05. {scoresAsOf}. Drag or use two fingers to move, Ctrl + scroll or pinch to zoom.
        </span>
      </p>
      <div className="h3d-detail" role="status" aria-live="polite">
        {bin ? (
          <>
            <div className="h3d-detail-main">
              <b className="code">{bin.code}</b>
              {bin.score ? (
                <span className={`chip ${bin.score.priority}`}>
                  <b className="num">{bin.score.value}</b> {bin.score.label}
                </span>
              ) : (
                <span className="muted">Not scored</span>
              )}
              <span className="subline">
                {bin.palletCount === 0 ? 'Empty' : plural(bin.palletCount, 'pallet')} ·{' '}
                {bin.task === null
                  ? 'no task in the latest plan'
                  : bin.task.kind === 'pending'
                    ? `pending task (plan #${bin.task.planId})`
                    : `counted in plan #${bin.task.planId}: ${bin.task.result}`}
              </span>
            </div>
            <span className="h3d-detail-actions">
              <Link className="btn btn-primary btn-sm" href={`/bins/${bin.code}`}>
                Bin details
                <Icon name="arrow" className="arrow" />
              </Link>
              <button type="button" className="btn btn-text" onClick={() => select(null)}>
                Clear
              </button>
            </span>
          </>
        ) : (
          <span className="muted">Select a bin with a click, a tap or the list above to see its details.</span>
        )}
      </div>
    </div>
  );
}
