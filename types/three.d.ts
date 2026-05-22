/**
 * Three.js ambient shim — `/js/vendor/three.module.min.js` self-hosted ES module.
 *
 * Why this file exists:
 *   src/js/erp-architecture-3d.ts loads Three.js via
 *   `import * as THREE from '/js/vendor/three.module.min.js'`. The site does NOT
 *   install `@types/three` (avoids dev-dep bloat under the 0-cost baseline and
 *   keeps the vendored bundle as the single source of runtime truth). This file
 *   declares the Three.js export surface our codebase actually touches.
 *
 * Specific-shadows-wildcard semantics:
 *   `types/raw-imports.d.ts` declares a catch-all wildcard
 *   `'/js/vendor/*.module.min.js'` returning `{ default: unknown }`. We declare
 *   a MORE-SPECIFIC wildcard pattern `'/js/vendor/three.module.min*'` here
 *   (matching `three.module.min.js` plus any sub-path). TypeScript picks the
 *   match with the longest non-wildcard prefix (`/js/vendor/three.module.min`,
 *   27 chars vs the catch-all's `/js/vendor/`, 11 chars), so this declaration
 *   wins for THREE imports while the catch-all continues to cover any future
 *   vendored module without a dedicated shim.
 *
 *   Why pattern-form instead of exact `'/js/vendor/three.module.min.js'`:
 *   TypeScript's ambient module symbol-table lookup does NOT find exact-match
 *   ambient declarations whose name starts with `/` (they fall through to the
 *   filesystem resolver and fail). Wildcard patterns are matched by a separate
 *   pattern-scanning step that works regardless of leading `/`. The trailing
 *   `*` here matches `.js` exactly (and nothing else inside /js/vendor/).
 *
 * Coverage:
 *   Only the 20 Three.js exports that erp-architecture-3d.ts uses, plus the
 *   minimum field / method surface needed for its call sites. This is **not** a
 *   general-purpose Three.js typing. New Three.js usage in other files should
 *   extend this declaration deliberately.
 *
 * Narrowing decision (Mesh.material):
 *   Real Three.js types `Mesh.material` as `Material | Material[]` (multi-material
 *   per face). erp-3d only ever assigns a single MeshBasicMaterial. We narrow
 *   `Mesh.material: MeshBasicMaterial` here so call sites like
 *   `mesh.material.map = tex` typecheck without inline cast. The dispose loop in
 *   erp-3d still uses `Object3D.material: Material | Material[]` via traverse,
 *   so the array branch is structurally preserved at the base class.
 *
 * Lifecycle:
 *   Expand when erp-3d-v2 / another 3D widget needs a new Three.js export.
 *   Keep `unknown` for fields whose runtime semantic we don't depend on (e.g.
 *   `Scene.background`); never use `any` (ratchet rule C).
 */

declare module '/js/vendor/three.module.min*' {
  // ── Value types ───────────────────────────────────────────────────────────
  export class Vector2 {
    constructor(x?: number, y?: number)
    x: number
    y: number
    set(x: number, y: number): this
  }

  export class Vector3 {
    constructor(x?: number, y?: number, z?: number)
    x: number
    y: number
    z: number
    set(x: number, y: number, z: number): this
    copy(v: Vector3): this
    add(v: Vector3): this
    sub(v: Vector3): this
    subVectors(a: Vector3, b: Vector3): this
    normalize(): this
    multiplyScalar(s: number): this
    clone(): Vector3
    length(): number
  }

  export class Euler {
    x: number
    y: number
    z: number
    set(x: number, y: number, z: number): this
  }

  export class Quaternion {
    copy(q: Quaternion): this
    setFromUnitVectors(from: Vector3, to: Vector3): this
  }

  export class Color {
    constructor(color?: number | string | Color)
    r: number
    g: number
    b: number
    setHex(hex: number): this
    clone(): Color
    lerp(target: Color, alpha: number): this
  }

  // ── Object3D hierarchy ────────────────────────────────────────────────────
  // Base class: geometry/material optional so scene.traverse(obj => obj.geometry?...) works.
  // Mesh overrides material to MeshBasicMaterial (see header).
  export class Object3D {
    position: Vector3
    rotation: Euler
    scale: Vector3
    quaternion: Quaternion
    visible: boolean
    userData: Record<string, unknown>
    children: Object3D[]
    parent: Object3D | null
    geometry?: BufferGeometry
    material?: Material | Material[]
    add(...objects: Object3D[]): this
    remove(object: Object3D): this
    lookAt(x: number, y: number, z: number): void
    lookAt(target: Vector3): void
    traverse(callback: (obj: Object3D) => void): void
  }

  export class Group extends Object3D {
    constructor()
  }

  export class Scene extends Object3D {
    constructor()
    background: unknown
  }

  export class PerspectiveCamera extends Object3D {
    constructor(fov?: number, aspect?: number, near?: number, far?: number)
    fov: number
    aspect: number
    near: number
    far: number
    updateProjectionMatrix(): void
  }

  export class AmbientLight extends Object3D {
    constructor(color?: number | Color | string, intensity?: number)
  }

  export class DirectionalLight extends Object3D {
    constructor(color?: number | Color | string, intensity?: number)
  }

  // ── Geometry ──────────────────────────────────────────────────────────────
  export class BufferAttribute {
    constructor(array: ArrayLike<number>, itemSize: number, normalized?: boolean)
    count: number
    getX(index: number): number
    getY(index: number): number
    getZ(index: number): number
  }

  export class BufferGeometry {
    attributes: { position: BufferAttribute; [key: string]: BufferAttribute | undefined }
    setAttribute(name: string, attribute: BufferAttribute): this
    dispose(): void
  }

  export class CylinderGeometry extends BufferGeometry {
    constructor(
      radiusTop?: number,
      radiusBottom?: number,
      height?: number,
      radialSegments?: number,
      heightSegments?: number,
      openEnded?: boolean,
      thetaStart?: number,
      thetaLength?: number,
    )
  }

  export class PlaneGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, widthSegments?: number, heightSegments?: number)
  }

  export class ConeGeometry extends BufferGeometry {
    constructor(
      radius?: number,
      height?: number,
      radialSegments?: number,
      heightSegments?: number,
      openEnded?: boolean,
      thetaStart?: number,
      thetaLength?: number,
    )
  }

  // ── Material ──────────────────────────────────────────────────────────────
  // map?: Texture lives on base Material so dispose loop's `m.map?.dispose?.()`
  // typechecks for any material that traverse() hands back.
  export class Material {
    color: Color
    opacity: number
    transparent: boolean
    side: number
    depthWrite: boolean
    visible: boolean
    needsUpdate: boolean
    map?: Texture
    dispose(): void
  }

  export class MeshBasicMaterial extends Material {
    constructor(parameters?: {
      color?: number | Color | string
      transparent?: boolean
      opacity?: number
      side?: number
      depthWrite?: boolean
      vertexColors?: boolean
      map?: Texture | null
    })
  }

  // ── Mesh ──────────────────────────────────────────────────────────────────
  // material narrowed to MeshBasicMaterial — erp-3d single-material usage (see header).
  export class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material | Material[])
    geometry: BufferGeometry
    material: MeshBasicMaterial
  }

  // ── Texture ───────────────────────────────────────────────────────────────
  export class Texture {
    wrapS: number
    wrapT: number
    minFilter: number
    magFilter: number
    needsUpdate: boolean
    offset: Vector2
    repeat: Vector2
    anisotropy: number
    colorSpace: string
    dispose(): void
  }

  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement)
  }

  // ── Raycaster ─────────────────────────────────────────────────────────────
  export interface Intersection {
    object: Object3D
    distance: number
    point: Vector3
  }

  export class Raycaster {
    constructor()
    setFromCamera(coords: Vector2, camera: PerspectiveCamera): void
    intersectObjects(objects: Object3D[], recursive?: boolean): Intersection[]
  }

  // ── WebGLRenderer ─────────────────────────────────────────────────────────
  export class WebGLRenderer {
    constructor(parameters?: {
      canvas?: HTMLCanvasElement
      alpha?: boolean
      antialias?: boolean
    })
    domElement: HTMLCanvasElement
    setPixelRatio(value: number): void
    setSize(width: number, height: number, updateStyle?: boolean): void
    setClearColor(color: number | Color | string, alpha?: number): void
    render(scene: Scene, camera: PerspectiveCamera): void
    dispose(): void
  }

  // ── Constants ─────────────────────────────────────────────────────────────
  export const DoubleSide: number
  export const RepeatWrapping: number
  export const LinearFilter: number
  export const SRGBColorSpace: string
}
