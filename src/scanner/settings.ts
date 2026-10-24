import type { ReaderOptions } from 'zxing-wasm/reader'

export type CropSize = 768 | 1024 | 1536 | 2048
export type Overlap = 0.25 | 0.5 | 0.75
export interface SearchSettings { cropSize: CropSize; overlap: Overlap }
export const defaultSettings: SearchSettings = { cropSize: 1536, overlap: 0.5 }
export const MAX_PIXELS = 25_000_000
export const binarizers = ['LocalAverage', 'GlobalHistogram'] as const
export type Binarizer = typeof binarizers[number]

export function readerOptions(binarizer: Binarizer): ReaderOptions {
  return {
    formats: ['Aztec'], maxNumberOfSymbols: 0,
    tryHarder: true, tryDownscale: false, tryRotate: true,
    tryInvert: false, tryDenoise: false, isPure: false, returnErrors: false,
    binarizer,
  }
}

export function frameSize(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function budgetSize(width: number, height: number) {
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)))
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

function starts(length: number, size: number, overlap: number) {
  const end = Math.max(0, length - size)
  const positions = [0]
  const stride = Math.max(1, Math.floor(size * (1 - overlap)))
  while (positions[positions.length - 1] < end) positions.push(Math.min(end, positions[positions.length - 1] + stride))
  return positions
}

export function cropWindows(width: number, height: number, settings: SearchSettings) {
  const w = Math.min(width, settings.cropSize)
  const h = Math.min(height, settings.cropSize)
  return starts(height, h, settings.overlap).flatMap((y) =>
    starts(width, w, settings.overlap).map((x) => ({ x, y, width: w, height: h })))
}
