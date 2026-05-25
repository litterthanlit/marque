import type { GenerationResult, LogoParams } from '../types.ts'
import { getGenerator } from '../generators/registry.ts'
import { createDefaultAppearance, createDefaultArtboard, IDENTITY_MATRIX } from './document.ts'
import { pathDataToVectorPaths } from './pathSerialization.ts'
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

  const objects: VectorObject[] = result.shapes.flatMap((shape, index) => {
    if (!shape.pathData) return []

    const paths = pathDataToVectorPaths(shape.pathData)
    return paths.map((path, pathIndex): PathObject => ({
      id: crypto.randomUUID(),
      type: 'path',
      name: `${shape.type} ${index + 1}${paths.length > 1 ? `.${pathIndex + 1}` : ''}`,
      parentId: null,
      artboardId: artboard.id,
      visible: true,
      locked: false,
      transform: { ...IDENTITY_MATRIX },
      appearance: createDefaultAppearance(params.fillColor),
      source: {
        ...source,
        sourceShapeId: shape.id,
      },
      path,
      fillRule: shape.operation === 'subtract' ? 'evenodd' : result.mark.fillRule,
    }))
  })

  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    kind: 'brand-vector',
    activeMode: 'logo',
    name: `Vector Maker ${params.seed}`,
    artboards: [artboard],
    objects,
    selection: objects[0] ? { targets: [{ type: 'object', objectId: objects[0].id }] } : { targets: [] },
    source,
    createdAt: convertedAt,
    updatedAt: convertedAt,
  }
}
