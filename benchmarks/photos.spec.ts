import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'

// Deliberately separate from public CI. No traces, screenshots, raw bytes, or payload text in reports.
const directory = process.env.LOCAL_PHOTOS
if (!directory) throw new Error('Set LOCAL_PHOTOS to a local directory of orientation-tagged PNG or JPEG fixtures.')
const files = readdirSync(directory).filter((name) => /^IMG_\d+\.(png|jpe?g)$/i.test(name) && (!process.env.LOCAL_PHOTO_FILTER || name.includes(process.env.LOCAL_PHOTO_FILTER))).sort()
if (!files.length) throw new Error('No IMG_*.png or IMG_*.jpg fixtures found.')
const require = createRequire(import.meta.url)
const reports: unknown[] = []
test.beforeAll(async () => {
  await prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) }, fireImmediately: true })
})
test.afterAll(() => {
  mkdirSync('local-results', { recursive: true })
  writeFileSync('local-results/photos.json', JSON.stringify(reports, null, 2))
})

for (const file of files) test(`local comparison ${file}`, async ({ page }) => {
  await page.route('**/__local-photo', (route) => route.fulfill({ path: resolve(directory!, file), contentType: file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' }))
  await page.addInitScript(() => {
    const state = { release: () => {}, calls: 0 }
    Object.assign(window, { benchmarkCamera: state })
    const devices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', { value: devices })
    Object.defineProperty(devices, 'getUserMedia', { value: async () => {
      await new Promise<void>((resolve) => { state.release = resolve })
      const canvas = document.createElement('canvas')
      canvas.width = 1280; canvas.height = 720
      const context = canvas.getContext('2d')!
      const stream = canvas.captureStream(30)
      const timer = setInterval(() => {
        context.fillStyle = 'white'; context.fillRect(0, 0, 1280, 720)
        if (stream.getTracks().every((track) => track.readyState === 'ended')) clearInterval(timer)
      }, 33)
      return stream
    } })
    class PhotoCamera {
      async takePhoto() {
        if (++state.calls > 1) await new Promise(() => {})
        return (await fetch('./__local-photo')).blob()
      }
    }
    Object.defineProperty(window, 'ImageCapture', { value: PhotoCamera })
  })
  await page.goto('./')
  const baselineImage = await page.evaluate(async () => {
    const bitmap = await createImageBitmap(await (await fetch('./__local-photo')).blob(), { imageOrientation: 'from-image' })
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    let binary = ''
    for (let offset = 0; offset < pixels.data.length; offset += 8192) binary += String.fromCharCode(...pixels.data.subarray(offset, offset + 8192))
    return { width: canvas.width, height: canvas.height, rgba: btoa(binary) }
  })
  const started = performance.now()
  const baseline = await readBarcodes({ width: baselineImage.width, height: baselineImage.height, data: new Uint8ClampedArray(Buffer.from(baselineImage.rgba, 'base64')), colorSpace: 'srgb' }, {
    formats: ['Aztec'], maxNumberOfSymbols: 1, tryHarder: true, tryDownscale: true, tryRotate: true,
    tryInvert: false, tryDenoise: false, isPure: false, returnErrors: false, binarizer: 'LocalAverage', downscaleFactor: 3, downscaleThreshold: 500,
  })
  const baselineMs = performance.now() - started
  const baselineHashes = baseline.filter((result) => result.isValid && result.symbology === 'Aztec').map((result) => createHash('sha256').update(result.bytes).digest('hex'))
  if (process.env.CROP_SIZE || process.env.CROP_OVERLAP) {
    await page.getByRole('button', { name: 'Cancel startup' }).click()
    if (process.env.CROP_SIZE) await page.getByLabel('Crop size').selectOption(process.env.CROP_SIZE)
    if (process.env.CROP_OVERLAP) await page.getByLabel('Crop overlap').selectOption(process.env.CROP_OVERLAP)
    await page.getByRole('button', { name: 'Resume' }).click()
  }
  await page.evaluate(() => (window as unknown as { benchmarkCamera: { release: () => void } }).benchmarkCamera.release())
  await expect(page.getByTestId('Completed sweeps')).toHaveText('1', { timeout: 90000 })
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download run JSON' }).click()
  const download = await downloaded
  const run = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  const report = {
    file, baseline: { hashes: baselineHashes, decoderMs: baselineMs, count: baselineHashes.length },
    distance: { hashes: run.rows.map((row: { hash: string }) => row.hash), count: run.unique,
      scene: run.lastCompleted, decoderCalls: run.decoderCalls, decoderP50: run.decoderP50, settings: run.settings },
  }
  reports.push(report)
  // The baseline must not lose any already-readable identity.
  for (const hash of baselineHashes) expect(report.distance.hashes).toContain(hash)
  console.log(JSON.stringify({ file, baselineCount: baselineHashes.length, distanceCount: run.unique,
    sweepMs: run.lastCompleted.sweepMs, decoderCalls: run.decoderCalls }))
})
