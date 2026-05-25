import type { MarkData } from '../illustrator/types.ts'
import { vectorPathToPathData } from './pathSerialization.ts'
import type { PathObject, VectorDocument, VectorObject } from './types.ts'

function isVisiblePath(object: VectorObject): object is PathObject {
  return object.type === 'path' && object.visible && !object.locked
}

export function composeVectorMark(document: VectorDocument | null): MarkData | null {
  if (!document) return null

  const artboard = document.artboards[0]
  if (!artboard) return null

  const paths = document.objects
    .filter(isVisiblePath)
    .map((object) => vectorPathToPathData(object.path))
    .filter(Boolean)

  return {
    compoundPathData: paths.join(' '),
    fillRule: 'evenodd',
    viewBox: {
      x: artboard.rect.x,
      y: artboard.rect.y,
      width: artboard.rect.width,
      height: artboard.rect.height,
    },
  }
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
    .map((object) => {
      const fill =
        object.appearance.fill.type === 'solid' ? object.appearance.fill.color : fallbackFill
      const opacity = object.appearance.opacity < 1 ? ` opacity="${object.appearance.opacity}"` : ''

      return `  <path d="${vectorPathToPathData(object.path)}" fill="${fill}" fill-rule="${object.fillRule}"${opacity} />`
    })
    .join('\n')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">`,
    body,
    '</svg>',
  ].join('\n')
}
