import type { MarkData } from '../illustrator/types.ts'
import { composeIllustratorMark } from '../illustrator/compose.ts'
import { vectorDocumentToIllustratorDocument } from './legacyIllustratorAdapter.ts'
import { vectorPathToPathData } from './pathSerialization.ts'
import type { Matrix2D, Paint, PathObject, VectorDocument, VectorObject } from './types.ts'

function isVisiblePath(object: VectorObject): object is PathObject {
  return object.type === 'path' && object.visible
}

function isOnArtboard(artboardId: string) {
  return (object: VectorObject): boolean => object.artboardId === artboardId
}

function serializePaintAttribute(name: 'fill' | 'stroke', paint: Paint, fallbackFill: string): string {
  if (paint.type === 'none') return `${name}="none"`

  if (name === 'fill') return `${name}="${paint.color || fallbackFill}"`

  return `${name}="${paint.color}"`
}

function serializeTransform(transform: Matrix2D): string {
  const { a, b, c, d, e, f } = transform
  return `matrix(${a} ${b} ${c} ${d} ${e} ${f})`
}

export function composeVectorMark(document: VectorDocument | null): MarkData | null {
  if (!document) return null
  return composeIllustratorMark(vectorDocumentToIllustratorDocument(document))
}

export function serializeVectorDocumentToSvg(
  document: VectorDocument,
  fallbackFill = '#111111',
): string {
  const artboard = document.artboards[0]
  const viewBox = artboard
    ? `${artboard.rect.x} ${artboard.rect.y} ${artboard.rect.width} ${artboard.rect.height}`
    : '-512 -512 1024 1024'

  const body = document.objects
    .filter(isVisiblePath)
    .filter(artboard ? isOnArtboard(artboard.id) : () => true)
    .map((object) => {
      const { appearance } = object
      const attributes = [
        `d="${vectorPathToPathData(object.path)}"`,
        serializePaintAttribute('fill', appearance.fill, fallbackFill),
        serializePaintAttribute('stroke', appearance.stroke, fallbackFill),
        `stroke-width="${appearance.strokeWidth}"`,
        `stroke-linecap="${appearance.strokeCap}"`,
        `stroke-linejoin="${appearance.strokeJoin}"`,
        `stroke-miterlimit="${appearance.strokeMiterLimit}"`,
        `fill-rule="${object.fillRule}"`,
        `opacity="${appearance.opacity}"`,
        `transform="${serializeTransform(object.transform)}"`,
      ]

      if (appearance.strokeDashArray.length > 0) {
        attributes.push(`stroke-dasharray="${appearance.strokeDashArray.join(' ')}"`)
      }

      return `  <path ${attributes.join(' ')} />`
    })
    .join('\n')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">`,
    body,
    '</svg>',
  ].join('\n')
}
