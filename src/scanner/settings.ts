import type { ReaderOptions } from 'zxing-wasm/reader'

export type Profile = 'capture' | 'fast'
export type Resolution = 640 | 1280 | 1920

export function readerOptions(profile: Profile): ReaderOptions {
  return {
    formats: ['Aztec'],
    maxNumberOfSymbols: 1,
    tryHarder: profile === 'capture',
    tryDownscale: profile === 'capture',
    tryRotate: true,
    tryInvert: false,
    tryDenoise: false,
    isPure: false,
    returnErrors: false,
    binarizer: 'LocalAverage',
    downscaleFactor: 3,
    downscaleThreshold: 500,
  }
}

export function frameSize(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
