import { describe, expect, it } from 'vitest'
import { budgetSize, cropWindows, defaultSettings, MAX_PIXELS } from './settings'
import { photoSettings } from './capture'

describe('native-resolution search geometry', () => {
  it('covers portrait sources and aligns the final crops with both edges', () => {
    const windows = cropWindows(4284, 5712, defaultSettings)
    expect(windows).toHaveLength(35)
    expect(windows[0]).toEqual({ x: 0, y: 0, width: 1536, height: 1536 })
    expect(windows.at(-1)).toEqual({ x: 2748, y: 4176, width: 1536, height: 1536 })
    for (const y of [0, 767, 1535, 3000, 5711]) for (const x of [0, 767, 1535, 3000, 4283]) {
      expect(windows.some((crop) => x >= crop.x && x < crop.x + crop.width && y >= crop.y && y < crop.y + crop.height)).toBe(true)
    }
  })
  it('does not upscale small or narrow sources', () => {
    expect(cropWindows(320, 480, defaultSettings)).toEqual([{ x: 0, y: 0, width: 320, height: 480 }])
    expect(cropWindows(320, 2000, defaultSettings).at(-1)).toEqual({ x: 0, y: 464, width: 320, height: 1536 })
  })
  it('limits captures to 25 MP and keeps aspect ratio', () => {
    expect(budgetSize(4284, 5712)).toEqual({ width: 4284, height: 5712 })
    const size = budgetSize(8000, 6000)
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_PIXELS)
    expect(size.width / size.height).toBeCloseTo(4 / 3, 3)
  })
  it('uses camera defaults when photo capability dimensions are unavailable', () => {
    expect(photoSettings({})).toBeUndefined()
    expect(photoSettings({ imageWidth: {}, imageHeight: {} })).toBeUndefined()
  })
  it('requests supported photo steps within the pixel budget', () => {
    const settings = photoSettings({ imageWidth: { min: 640, max: 8000, step: 16 }, imageHeight: { min: 480, max: 6000, step: 16 } })!
    expect(settings.imageWidth * settings.imageHeight).toBeLessThanOrEqual(MAX_PIXELS)
    expect((settings.imageWidth - 640) % 16).toBe(0)
    expect((settings.imageHeight - 480) % 16).toBe(0)
  })
})
