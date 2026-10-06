import type { CarveSpec } from '../carve/spec.ts'

/**
 * The document, schema version 2. Every point is in artboard space: nothing
 * stores a transform, so what an object holds is what it draws. The version
 * 1 types live on in `v1.ts`, for reading old links and saved marks.
 */

export type VectorDocumentKind = 'brand-vector'
export type VectorWorkspaceMode = 'logo' | 'wordmark'

export interface Vec2 {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface VectorArtboard {
  id: string
  name: string
  rect: Rect
  background: string | null
}

/** One anchor of a contour. Its handles are relative to it; null is no handle. */
export interface Segment {
  point: Vec2
  handleIn: Vec2 | null
  handleOut: Vec2 | null
}

export interface Contour {
  closed: boolean
  segments: Segment[]
}

export type Operation = 'add' | 'subtract'

export interface ObjectBase {
  id: string
  name: string
  /** The group this object belongs to. A group's members follow its header in the stack. */
  parentId: string | null
  visible: boolean
  locked: boolean
}

export interface PathObject extends ObjectBase {
  type: 'path'
  operation: Operation
  /** Holes are further contours. */
  contours: Contour[]
  /** Read only for two or more contours, so a single contour draws the same either way. */
  fillRule: 'nonzero' | 'evenodd'
  /** Recipe for slabs and cuts: the object is then one closed contour, the outline of the recipe. */
  carve?: CarveSpec
  /** The contours are made by the follow pass from the objects the link names. */
  link?: ObjectLink
  /** The recipe's centre is held on another object's centre. */
  pin?: { centreOf: string }
  /**
   * How far a free path's box is turned, in degrees: its handles sit around
   * the path as measured in that frame. Compose and export ignore it. A
   * recipe has its own rotation and never carries one.
   */
  frame?: { rotation: number }
  /** The generated shape this object came from. */
  sourceShapeId?: string
}

export interface GroupObject extends ObjectBase {
  type: 'group'
  /** Members compose alone and enter the stack as one input. */
  isolated: boolean
  /** Read only when isolated. */
  operation: Operation
  frame?: { rotation: number }
}

export type VectorObject = PathObject | GroupObject

export type ObjectLink =
  /** The recipe is a band between objects `a` and `b`. */
  | { kind: 'band'; a: string; b: string }
  /** A copy of `of`, larger by `distance`, or smaller when it is negative. */
  | { kind: 'offset'; of: string; distance: number }

/** Which construction line of a shape a guide follows. */
export type ConstructionRole =
  | 'centre-x'
  | 'centre-y'
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'circumcircle'
  | 'incircle'
  | `axis-${number}`

/** A construction line. Guides are never composed, exported or hit as material. */
export interface Guide {
  id: string
  name: string
  visible: boolean
  locked: boolean
  style: 'solid' | 'dashed' | 'dotted'
  shape:
    /** An infinite line through `p`, at `angle` degrees. */
    | { kind: 'line'; p: Vec2; angle: number }
    | { kind: 'circle'; c: Vec2; r: number }
    | { kind: 'path'; contour: Contour }
  link?: { kind: 'construction'; of: string; role: ConstructionRole }
}

/** A rounded corner of the composed ink: a finishing pass after the stack. */
export interface Fillet {
  id: string
  visible: boolean
  radius: number
  /** The corner where it last solved. */
  at: Vec2
  /** The objects whose outlines meet there; the same id twice for a corner of one object. */
  between: [string, string]
}

/**
 * What is selected. It lives in the store beside the document, never in it:
 * links, saved marks and history steps of objects leave it out.
 */
export type VectorSelectionTarget =
  | { type: 'object'; objectId: string }
  | { type: 'anchor'; objectId: string; contourIndex: number; segmentIndex: number }
  | { type: 'handle'; objectId: string; contourIndex: number; segmentIndex: number; handle: 'in' | 'out' }
  | { type: 'guide'; guideId: string }

export interface VectorSelection {
  targets: VectorSelectionTarget[]
}

export interface VectorDocumentSource {
  seed: number
  modeId: string
  generatorId: string
  generatorVersion: string
  paramsHash: string
  convertedAt: string
}

export interface VectorDocument {
  schemaVersion: 2
  id: string
  kind: VectorDocumentKind
  activeMode: VectorWorkspaceMode
  name: string
  artboards: VectorArtboard[]
  /** Stack order: index 0 is at the bottom. */
  objects: VectorObject[]
  /** Never composed or exported. */
  guides: Guide[]
  /** A finishing pass over the composed ink. */
  fillets: Fillet[]
  source: VectorDocumentSource | null
  createdAt: string
  updatedAt: string
}
