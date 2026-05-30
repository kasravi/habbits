import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.35'
const MEDIAPIPE_WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`

export type FaceToneLabel = 'joyful' | 'calm' | 'flat' | 'stressed'

export interface FaceSentimentResult {
  label: FaceToneLabel
  score: number
  smile: number
  frown: number
  tension: number
}

export interface FaceSentimentAnalysis {
  result: FaceSentimentResult | null
  status: 'ready' | 'no-face' | 'error'
  message: string
  delegate: 'GPU' | 'CPU'
}

interface BlendshapeCategory {
  categoryName: string
  score: number
}

const faceLandmarkerPromises: Partial<Record<'GPU' | 'CPU', Promise<FaceLandmarker>>> = {}

function getBlendshapeScore(categories: BlendshapeCategory[], name: string): number {
  return categories.find((category) => category.categoryName === name)?.score ?? 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function scoreFaceTone(categories: BlendshapeCategory[]): FaceSentimentResult {
  const smile =
    (getBlendshapeScore(categories, 'mouthSmileLeft') +
      getBlendshapeScore(categories, 'mouthSmileRight')) /
    2
  const frown =
    (getBlendshapeScore(categories, 'mouthFrownLeft') +
      getBlendshapeScore(categories, 'mouthFrownRight')) /
    2
  const browDown =
    (getBlendshapeScore(categories, 'browDownLeft') +
      getBlendshapeScore(categories, 'browDownRight')) /
    2
  const browInnerUp = getBlendshapeScore(categories, 'browInnerUp')
  const mouthPress =
    (getBlendshapeScore(categories, 'mouthPressLeft') +
      getBlendshapeScore(categories, 'mouthPressRight')) /
    2

  const tension = clamp((frown + browDown + mouthPress) / 3, 0, 1)
  const score = clamp(smile * 1.2 - frown * 0.95 - browDown * 0.45 + browInnerUp * 0.1, -1, 1)

  if (score >= 0.3) {
    return { label: 'joyful', score, smile, frown, tension }
  }
  if (score >= 0.05) {
    return { label: 'calm', score, smile, frown, tension }
  }
  if (score >= -0.25) {
    return { label: 'flat', score, smile, frown, tension }
  }
  return { label: 'stressed', score, smile, frown, tension }
}

async function ensureFaceLandmarker(delegate: 'GPU' | 'CPU'): Promise<FaceLandmarker> {
  if (!faceLandmarkerPromises[delegate]) {
    faceLandmarkerPromises[delegate] = (async () => {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE_URL)

      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate,
        },
        runningMode: 'IMAGE',
        outputFaceBlendshapes: true,
        numFaces: 1,
      })
    })().catch((error) => {
      delete faceLandmarkerPromises[delegate]
      throw error
    })
  }

  return faceLandmarkerPromises[delegate] as Promise<FaceLandmarker>
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load image for face analysis.'))
    image.src = src
  })
}

export async function analyzeFaceSentiment(imageDataUrl: string): Promise<FaceSentimentAnalysis> {
  const image = await loadImage(imageDataUrl)

  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      const landmarker = await ensureFaceLandmarker(delegate)
      const detection = landmarker.detect(image)
      const categories = (detection.faceBlendshapes?.[0]?.categories ?? []) as BlendshapeCategory[]

      if (!categories.length) {
        return {
          result: null,
          status: 'no-face',
          message:
            delegate === 'GPU'
              ? 'No usable face blendshapes were returned.'
              : 'No usable face blendshapes were returned, even after CPU fallback.',
          delegate,
        }
      }

      return {
        result: scoreFaceTone(categories),
        status: 'ready',
        message: `${delegate} analysis completed successfully.`,
        delegate,
      }
    } catch (error) {
      if (delegate === 'CPU') {
        return {
          result: null,
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Face analysis failed on both GPU and CPU delegates.',
          delegate,
        }
      }
    }
  }

  return {
    result: null,
    status: 'error',
    message: 'Face analysis could not start.',
    delegate: 'CPU',
  }
}
