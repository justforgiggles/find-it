import { decodeFrame } from './decoder'
import type { SearchProgress } from './protocol'
import { binarizers, cropWindows, frameSize, type SearchSettings } from './settings'

// Owns the bitmap. Keep native source pixels until every crop has been searched.
export async function searchScene(bitmap: ImageBitmap, settings: SearchSettings, progress: (value: SearchProgress) => void) {
  const width = bitmap.width
  const height = bitmap.height
  const source = new OffscreenCanvas(1, 1)
  const sourceContext = source.getContext('2d', { willReadFrequently: true })
  const canvas = new OffscreenCanvas(1, 1)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  try {
    if (!context || !sourceContext) throw new Error('This browser cannot process camera images in a worker.')
    const overview = frameSize(width, height, 1920)
    const crops = cropWindows(width, height, settings)
    const regions = [
      { x: 0, y: 0, width, height, output: overview, stage: 'Overview' },
      ...crops.map((crop, index) => ({ ...crop, output: crop, stage: `Crop ${index + 1} / ${crops.length}` })),
    ]
    const total = regions.length * binarizers.length
    let completed = 0
    for (const [index, region] of regions.entries()) {
      // Publish the cheap overview first. Convert the full source only once for native crops.
      if (index === 1) {
        source.width = width
        source.height = height
        sourceContext.drawImage(bitmap, 0, 0)
        bitmap.close()
      }
      canvas.width = region.output.width
      canvas.height = region.output.height
      context.drawImage(index === 0 ? bitmap : source, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      for (const binarizer of binarizers) {
        const result = await decodeFrame(pixels, binarizer)
        progress({ ...result, completed: ++completed, total, stage: `${region.stage} · ${binarizer}` })
        // Allow worker messages and incremental results to run between WASM calls.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
  } finally {
    bitmap.close()
    canvas.width = canvas.height = 1
    source.width = source.height = 1
  }
}
