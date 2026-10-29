// 3D flip-through preview of the folded zine.
//
// The folded zine is 4 leaves hinged at a spine along x = 0. Leaf k carries
// page 2k+1 on its front and page 2k+2 on its back, so closed it shows page 1
// (cover) and fully turned it shows page 8 (back cover). Turning a leaf
// rotates it π around the spine, with a little curl while it's in the air.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const SEGMENTS = 32; // columns per leaf, for the curl
const GAP = 0.004; // z spacing between stacked leaves
const TURN_MS = 700;

interface Leaf {
  front: THREE.Mesh;
  back: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  progress: number; // 0 = lying on the right, 1 = turned onto the left
  from: number;
  to: number;
  start: number;
}

export class Booklet {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private controls: OrbitControls;
  private book = new THREE.Group();
  private leaves: Leaf[] = [];
  private textures: THREE.Texture[] = [];
  private pageW = 1;
  private pageH = 1.5;
  private turned = 0;
  private bookX = 0;
  private frame = 0;
  private resizeObserver: ResizeObserver;

  /** Called whenever the visible spread changes. */
  onChange: (turned: number, total: number) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xffffff);
    container.append(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-1, 2, 4);
    this.scene.add(sun);
    this.scene.add(this.book);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 1;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.resetView();
    this.loop();
  }

  /** Replace the booklet with these pages (in reading order, page 1 first). */
  setPages(pages: HTMLCanvasElement[]) {
    this.clear();
    const first = pages[0];
    this.pageH = 1.5;
    this.pageW = (this.pageH * first.width) / first.height;

    for (let k = 0; k < pages.length / 2; k++) {
      const geometry = new THREE.PlaneGeometry(this.pageW, this.pageH, SEGMENTS, 1);
      // Hinge on the left edge: u = 0 sits on the spine.
      geometry.translate(this.pageW / 2, 0, 0);

      const frontTex = this.texture(pages[2 * k], false);
      const backTex = this.texture(pages[2 * k + 1], true);
      const front = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ map: frontTex, side: THREE.FrontSide, roughness: 0.9 }),
      );
      const back = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ map: backTex, side: THREE.BackSide, roughness: 0.9 }),
      );
      this.book.add(front, back);
      this.leaves.push({ front, back, geometry, progress: 0, from: 0, to: 0, start: 0 });
    }

    this.turned = 0;
    this.bookX = this.targetX();
    this.leaves.forEach((leaf, i) => this.pose(leaf, i));
    this.resetView();
    this.onChange(this.turned, this.leaves.length);
  }

  next() { this.goTo(this.turned + 1); }
  prev() { this.goTo(this.turned - 1); }

  goTo(n: number) {
    n = Math.max(0, Math.min(this.leaves.length, n));
    if (n === this.turned) return;
    const now = performance.now();
    // Stagger multi-leaf jumps so the pages fan over one after another.
    const order = n > this.turned ? range(this.turned, n) : range(n, this.turned).reverse();
    order.forEach((i, j) => {
      const leaf = this.leaves[i];
      leaf.from = leaf.progress;
      leaf.to = i < n ? 1 : 0;
      leaf.start = now + j * 120;
    });
    this.turned = n;
    this.onChange(this.turned, this.leaves.length);
  }

  resetView() {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, -0.15, 1).normalize().multiplyScalar(this.fitDistance());
    this.controls.update();
  }

  /** Camera distance at which an open spread (plus a margin) fills the stage. */
  private fitDistance(): number {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const byHeight = (this.pageH * 1.3) / 2 / Math.tan(vFov / 2);
    const byWidth = (this.pageW * 2 * 1.15) / 2 / Math.tan(hFov / 2);
    return Math.max(byHeight, byWidth);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------- internals -------

  private texture(canvas: HTMLCanvasElement, mirrored: boolean): THREE.Texture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    if (mirrored) {
      // The back face is seen from behind, so flip u to read the right way round.
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = -1;
    }
    this.textures.push(tex);
    return tex;
  }

  private clear() {
    for (const leaf of this.leaves) {
      leaf.geometry.dispose();
      (leaf.front.material as THREE.Material).dispose();
      (leaf.back.material as THREE.Material).dispose();
      this.book.remove(leaf.front, leaf.back);
    }
    for (const t of this.textures) t.dispose();
    this.leaves = [];
    this.textures = [];
  }

  /** Keep whatever's showing centred: a closed book sits to one side of the spine. */
  private targetX(): number {
    if (this.turned === 0) return -this.pageW / 2;
    if (this.turned === this.leaves.length) return this.pageW / 2;
    return 0;
  }

  /** Bend leaf i's vertices for its current progress. */
  private pose(leaf: Leaf, i: number) {
    const t = leaf.progress;
    const n = this.leaves.length;
    const angle = Math.PI * easeInOut(t);
    // Curl is strongest mid-turn and vanishes at rest.
    const curl = 0.9 * Math.sin(Math.PI * t);
    // Stack order: leaf 0 on top on the right, leaf n-1 on top on the left.
    const z = (1 - t) * (n - 1 - i) * GAP + t * i * GAP;

    const pos = leaf.geometry.attributes.position as THREE.BufferAttribute;
    const step = this.pageW / SEGMENTS;
    // Walk out from the spine, turning a little more with each column.
    let x = 0;
    let zz = 0;
    for (let c = 0; c <= SEGMENTS; c++) {
      if (c > 0) {
        // The free edge trails behind the spine; clamp so it never dips into the stacks.
        const a = Math.max(0, Math.min(Math.PI, angle - curl * ((c - 0.5) / SEGMENTS)));
        x += step * Math.cos(a);
        zz += step * Math.sin(a);
      }
      for (let r = 0; r <= 1; r++) {
        const idx = r * (SEGMENTS + 1) + c;
        pos.setX(idx, x);
        pos.setZ(idx, zz + z);
      }
    }
    pos.needsUpdate = true;
    leaf.geometry.computeVertexNormals();
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Keep the viewing angle the user chose but re-fit the distance.
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.camera.position.copy(this.controls.target).add(offset.setLength(this.fitDistance()));
    this.controls.maxDistance = this.fitDistance() * 2.5;
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();

    this.leaves.forEach((leaf, i) => {
      if (leaf.progress === leaf.to) return;
      const k = Math.max(0, Math.min(1, (now - leaf.start) / TURN_MS));
      leaf.progress = leaf.from + (leaf.to - leaf.from) * k;
      this.pose(leaf, i);
    });

    this.bookX += (this.targetX() - this.bookX) * 0.12;
    this.book.position.x = this.bookX;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a }, (_, i) => a + i);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
