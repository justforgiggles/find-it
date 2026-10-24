import { budgetSize } from './settings'

interface PhotoRange { min?: number; max?: number; step?: number }
interface PhotoCapabilities { imageWidth?: PhotoRange; imageHeight?: PhotoRange }
interface StillCamera {
  getPhotoCapabilities?: () => Promise<PhotoCapabilities>
  takePhoto: (settings?: { imageWidth: number; imageHeight: number }) => Promise<Blob>
}

export function photoSettings(capabilities: PhotoCapabilities) {
  const { imageWidth: w, imageHeight: h } = capabilities
  if (!w?.max || !h?.max || !Number.isFinite(w.max) || !Number.isFinite(h.max)) return undefined
  const size = budgetSize(w.max, h.max)
  const align = (value: number, range: PhotoRange) => {
    const min = range.min ?? 0
    const step = range.step && range.step > 0 ? range.step : 1
    return min + Math.floor((value - min) / step) * step
  }
  const imageWidth = align(size.width, w)
  const imageHeight = align(size.height, h)
  if (imageWidth <= 0 || imageHeight <= 0 || imageWidth < (w.min ?? 0) || imageHeight < (h.min ?? 0)) return undefined
  return { imageWidth, imageHeight }
}

export class SceneCamera {
  private photo: StillCamera | undefined
  private settings: { imageWidth: number; imageHeight: number } | undefined
  private initialized = false
  fallbackReason = 'Still capture unavailable'

  constructor(track: MediaStreamTrack) {
    const Constructor = globalThis.ImageCapture
    try {
      if (Constructor && typeof Constructor.prototype.takePhoto === 'function') this.photo = new Constructor(track)
    } catch { /* Video remains available. */ }
  }

  async capture(video: HTMLVideoElement, active: () => boolean) {
    const started = performance.now()
    let bitmap: ImageBitmap | undefined
    let source: 'still' | 'video' = 'video'
    try {
      if (this.photo) {
        try {
          if (!this.initialized) {
            this.initialized = true
            // Capability failure alone should not disable an otherwise usable takePhoto.
            try {
              const capabilities = await this.photo.getPhotoCapabilities?.()
              if (capabilities) this.settings = photoSettings(capabilities)
            } catch { /* Try the camera's default photo settings. */ }
          }
          if (!active()) return null
          const blob = await this.photo.takePhoto(this.settings)
          if (!active()) return null
          bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
          source = 'still'
        } catch {
          this.photo = undefined
          this.fallbackReason = 'Still capture failed; using video until camera restart'
        }
      }
      if (!active()) { bitmap?.close(); return null }
      if (!bitmap) bitmap = await createImageBitmap(video)
      if (!active()) { bitmap.close(); return null }
      const original = `${bitmap.width} × ${bitmap.height}`
      const size = budgetSize(bitmap.width, bitmap.height)
      if (size.width !== bitmap.width || size.height !== bitmap.height) {
        const resized = await createImageBitmap(bitmap, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' })
        bitmap.close()
        bitmap = resized
      }
      if (!active()) { bitmap.close(); return null }
      return { bitmap, source, original, width: bitmap.width, height: bitmap.height, captureMs: performance.now() - started,
        fallbackReason: source === 'video' ? this.fallbackReason : '' }
    } catch (error) { bitmap?.close(); throw error }
  }
}
