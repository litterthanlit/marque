import type { GenerationResult, LogoParams } from '../types.ts'
import { getGenerator } from '../generators/registry.ts'
import { createDefaultArtboard, VECTOR_SCHEMA_VERSION } from './document.ts'
import { pathDataToContours } from './pathSerialization.ts'
import { generatedShapesInApplyOrder } from '../illustrator/compose.ts'
import type { PathObject, VectorDocument, VectorObject } from './types.ts'

function paramsHash(params: LogoParams): string {
  return JSON.stringify({
    seed: params.seed,
    modeId: params.modeId,
    generatorId: params.generatorId,
    modeParams: params.modeParams[params.modeId] ?? {},
    brandInput: params.brandInput,
  })
}

function titleCaseShapeType(type: string): string {
  return type
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ')
}

function generatedObjectName(type: string, operation: 'add' | 'subtract', index: number): string {
  const number = String(index + 1).padStart(2, '0')
  if (operation === 'subtract') return `Cutout ${number}`
  return `Generated ${titleCaseShapeType(type)} ${number}`
}

/**
 * A generated mark as a document: one object per subpath of each shape, adds
 * before cuts, so it composes to the generated mark.
 */
export function createVectorDocumentFromGeneration(
  result: GenerationResult,
  params: LogoParams,
): VectorDocument {
  const generator = getGenerator(params.generatorId)
  const artboard = createDefaultArtboard()
  const convertedAt = new Date().toISOString()
  const source = {
    seed: params.seed,
    modeId: params.modeId,
    generatorId: params.generatorId,
    generatorVersion: generator?.version ?? 'v0',
    paramsHash: paramsHash(params),
    convertedAt,
  }

  const objects: VectorObject[] = generatedShapesInApplyOrder(result.shapes).flatMap((shape) => {
    if (!shape.pathData) return []
    const index = result.shapes.indexOf(shape)

    const contours = pathDataToContours(shape.pathData)
    return contours.map((contour, pathIndex): PathObject => ({
      id: crypto.randomUUID(),
      type: 'path',
      name: `${generatedObjectName(shape.type, shape.operation, index)}${
        contours.length > 1 ? `.${pathIndex + 1}` : ''
      }`,
      parentId: null,
      visible: true,
      locked: false,
      operation: shape.operation,
      contours: [contour],
      fillRule: 'evenodd',
      sourceShapeId: shape.id,
    }))
  })

  return {
    schemaVersion: VECTOR_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    kind: 'brand-vector',
    activeMode: 'logo',
    name: `Vector Maker ${params.seed}`,
    artboards: [artboard],
    objects,
    guides: [],
    fillets: [],
    source,
    createdAt: convertedAt,
    updatedAt: convertedAt,
  }
}
