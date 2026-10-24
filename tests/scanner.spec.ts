import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer'

const require = createRequire(import.meta.url)
let images: string[]
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16)

test.beforeAll(async () => {
  await prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm')) }, fireImmediately: true })
  images = await Promise.all(['box-one', 'box-two'].map(async (value) => {
    const result = await writeBarcode(value, { format: 'Aztec', scale: 8 })
    if (!result.image) throw new Error(result.error)
    return `data:image/png;base64,${Buffer.from(await result.image.arrayBuffer()).toString('base64')}`
  }))
})

declare global {
  interface Window {
    testCamera: { image: number; streams: MediaStream[]; denied: boolean; hold: boolean; release?: () => void; photoCalls?: number; photoHold?: boolean; photoFail?: boolean; releasePhoto?: () => void; photoSettings?: unknown }
  }
}

async function mockCamera(page: Page, denied = false, fallback = false, hold = false) {
  await page.addInitScript(({ images, denied, fallback, hold }) => {
    window.testCamera = { image: -1, streams: [], denied, hold }
    Object.defineProperty(window, 'ImageCapture', { configurable: true, value: undefined })
    if (fallback) Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { value: undefined })
    // Retain the wrapper: WebKit may otherwise replace it and lose the test override.
    const mediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices })
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      value: async () => {
        if (window.testCamera.denied) throw new DOMException('Denied by test', 'NotAllowedError')
        const loaded = await Promise.all(images.map(async (src) => {
          const image = new Image()
          image.src = src
          await image.decode()
          return image
        }))
        const canvas = document.createElement('canvas')
        canvas.width = 1280
        canvas.height = 720
        const context = canvas.getContext('2d')!
        function draw() {
          context.fillStyle = 'white'
          context.fillRect(0, 0, canvas.width, canvas.height)
          const image = loaded[window.testCamera.image]
          if (image) context.drawImage(image, 450, 180, 320, 320)
          if (window.testCamera.image === 2) {
            context.drawImage(loaded[0], 20, 20, 180, 180)
            context.save()
            context.translate(1100, 550)
            context.rotate(Math.PI / 2)
            context.drawImage(loaded[1], -100, -100, 200, 200)
            context.restore()
          }
        }
        draw()
        const stream = canvas.captureStream(30)
        window.testCamera.streams.push(stream)
        const interval = setInterval(() => {
          if (stream.getTracks().every((track) => track.readyState === 'ended')) clearInterval(interval)
          else draw()
        }, 33)
        if (window.testCamera.hold) await new Promise<void>((resolve) => { window.testCamera.release = resolve })
        return stream
      },
    })
  }, { images, denied, fallback, hold })
}

async function waitScanning(page: Page) {
  await expect(page.getByText('scanning', { exact: true })).toBeVisible()
  await expect.poll(async () => Number(await page.getByTestId('Completed sweeps').textContent())).toBeGreaterThan(0)
}

test('decodes through the production worker, deduplicates, pauses and resets on mobile', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mockCamera(page)
  await page.goto('./')
  await waitScanning(page)
  await expect(page.getByTestId('Unique codes')).toHaveText('0')
  await page.evaluate(() => { window.testCamera.image = 0 })
  await expect(page.getByRole('list', { name: 'Scanned codes' })).toContainText(hash('box-one'))
  await expect.poll(async () => Number(await page.getByTestId('Duplicate reads').textContent())).toBeGreaterThan(0)
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await page.evaluate(() => { window.testCamera.image = 1 })
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByTestId('Sweep p95')).not.toHaveText('—')
  await expect(page.getByLabel('Crop size')).toBeDisabled()
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  await expect(page.getByText('paused', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.testCamera.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true)
  await expect(page.getByTestId('Sweeps / second')).toHaveText('0.0')
  await page.getByRole('button', { name: 'Resume' }).tap()
  await waitScanning(page)
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  await page.getByRole('button', { name: 'Reset run' }).tap()
  await expect(page.getByTestId('Unique codes')).toHaveText('0')
  await expect(page.getByTestId('Completed sweeps')).toHaveText('0')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('permission denial is recoverable with an explicit retry', async ({ page }) => {
  await mockCamera(page, true)
  await page.goto('./')
  await expect(page.getByRole('alert')).toContainText('Camera permission was denied')
  await page.evaluate(() => { window.testCamera.denied = false })
  await page.getByRole('button', { name: 'Start / Retry' }).tap()
  await waitScanning(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('crop controls work with frame callback fallback and preserve portrait layout', async ({ page }) => {
  await mockCamera(page, false, true)
  await page.goto('./')
  await waitScanning(page)
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  await page.getByLabel('Crop size').selectOption('768')
  await page.getByLabel('Crop overlap').selectOption('0.75')
  await page.evaluate(() => { window.testCamera.image = 0 })
  await page.getByRole('button', { name: 'Resume' }).tap()
  await expect(page.getByRole('listitem')).toContainText(hash('box-one'))
  await expect(page.getByTestId('Preview FPS (estimated)')).toBeVisible()
  await page.getByText('Camera and startup details').tap()
  await expect(page.getByTestId('Scene dimensions')).toHaveText('1280 × 720')
})

test('a missing WASM asset produces a retryable error and stops camera tracks', async ({ page }) => {
  await mockCamera(page)
  await page.route('**/*.wasm', (route) => route.abort())
  await page.goto('./')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.testCamera.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true)
  await page.unroute('**/*.wasm')
  await page.getByRole('button', { name: 'Start / Retry' }).tap()
  await waitScanning(page)
})

test('exports configuration and valid manual swipe results without conflating duplicate reads', async ({ page }) => {
  await mockCamera(page)
  await page.goto('./')
  await waitScanning(page)
  await page.getByLabel('Attempted swipes').fill('20')
  await page.getByLabel('Captured swipes').fill('18')
  await expect(page.getByText('Capture success:')).toContainText('90.0%')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download run JSON' }).tap()
  const download = await downloadPromise
  const path = await download.path()
  const exported = JSON.parse(readFileSync(path!, 'utf8'))
  expect(exported.manualSwipeTest).toEqual({ attempted: 20, captured: 18, successRate: 0.9 })
  expect(exported.readerOptions.map((options: { formats: string[] }) => options.formats)).toEqual([['Aztec'], ['Aztec']])
  expect(exported.settings).toEqual({ cropSize: 1536, overlap: 0.5 })
  expect(exported.unique).toBe(0)
  expect(exported.lastCompleted).toMatchObject({ completed: 4, total: 4, source: 'video', width: 1280, height: 720 })
  expect(exported.decoderCalls).toBeGreaterThanOrEqual(exported.completedSweeps * 4)
  await page.getByLabel('Captured swipes').fill('21')
  await expect(page.getByText('Capture success:')).toContainText('—')
})


test('cancelling a pending permission request stops a late camera grant', async ({ page }) => {
  await mockCamera(page, false, false, true)
  await page.goto('./')
  await page.waitForFunction(() => Boolean(window.testCamera.release))
  await page.getByRole('button', { name: 'Cancel startup' }).tap()
  await page.evaluate(() => { window.testCamera.hold = false; window.testCamera.release?.() })
  await expect.poll(() => page.evaluate(() => window.testCamera.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true)
  await expect(page.getByText('paused', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Resume' }).tap()
  await waitScanning(page)
})

test('backgrounding the page releases the camera and requires an explicit resume', async ({ page }) => {
  await mockCamera(page)
  await page.goto('./')
  await waitScanning(page)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByText('paused', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.testCamera.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
})


test('finds both differently sized labels in one scene and deduplicates overlapping passes', async ({ page }) => {
  await mockCamera(page)
  await page.goto('./')
  await waitScanning(page)
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  await page.getByLabel('Crop size').selectOption('768')
  await page.getByLabel('Crop overlap').selectOption('0.75')
  await page.evaluate(() => { window.testCamera.image = 2 })
  await page.getByRole('button', { name: 'Resume' }).tap()
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('list', { name: 'Scanned codes' })).toContainText(hash('box-one'))
  await expect(page.getByRole('list', { name: 'Scanned codes' })).toContainText(hash('box-two'))
  await expect.poll(async () => Number(await page.getByTestId('Completed sweeps').textContent())).toBeGreaterThan(1)
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  const completed = Number(await page.getByTestId('Completed sweeps').textContent())
  const duplicates = Number(await page.getByTestId('Duplicate reads').textContent())
  expect(duplicates).toBeGreaterThanOrEqual((completed - 1) * 2)
  expect(duplicates).toBeLessThanOrEqual(completed * 2)
})


async function mockStill(page: Page, hold = false, fail = false, distant = false) {
  await page.addInitScript(({ images, hold, fail, distant }) => {
    Object.assign(window.testCamera, { photoCalls: 0, photoHold: hold, photoFail: fail })
    class PhotoCamera {
      async getPhotoCapabilities() {
        return { imageWidth: { min: 640, max: 2048, step: 1 }, imageHeight: { min: 480, max: 3072, step: 1 } }
      }
      async takePhoto(settings: unknown) {
        window.testCamera.photoCalls!++
        window.testCamera.photoSettings = settings
        if (window.testCamera.photoFail) throw new Error('Unsupported photo capture')
        if (window.testCamera.photoHold) await new Promise<void>((resolve) => { window.testCamera.releasePhoto = resolve })
        const canvas = document.createElement('canvas')
        canvas.width = distant ? 6000 : 2048
        canvas.height = distant ? 4000 : 3072
        const context = canvas.getContext('2d')!
        context.fillStyle = 'white'
        context.fillRect(0, 0, canvas.width, canvas.height)
        const labels = await Promise.all(images.map(async (src) => {
          const image = new Image()
          image.src = src
          await image.decode()
          return image
        }))
        context.drawImage(labels[0], 40, 40, distant ? 400 : 160, distant ? 400 : 160)
        if (distant) context.drawImage(labels[1], 4800, 2800, 56, 56)
        else context.drawImage(labels[1], 1800, 2800, 200, 200)
        return new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))
      }
    }
    Object.defineProperty(window, 'ImageCapture', { configurable: true, value: PhotoCamera })
  }, { images, hold, fail, distant })
}

test('prefers portrait still capture and finds labels near opposite scene edges', async ({ page }) => {
  await mockCamera(page)
  await mockStill(page)
  await page.goto('./')
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByTestId('Capture source')).toHaveText('High-resolution still')
  await expect(page.getByTestId('Scene dimensions')).toHaveText('2048 × 3072')
  await expect.poll(async () => Number(await page.getByTestId('Completed sweeps').textContent())).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  expect(await page.evaluate(() => window.testCamera.photoSettings)).toEqual({ imageWidth: 2048, imageHeight: 3072 })
  await expect(page.getByTestId('First result (last sweep)')).not.toHaveText('—')
})

test('a failed still capture falls back to video and retries stills on restart', async ({ page }) => {
  await mockCamera(page)
  await mockStill(page, false, true)
  await page.goto('./')
  await waitScanning(page)
  await expect(page.getByTestId('Capture source')).toHaveText('Video frame')
  await expect(page.getByText('Still capture failed; using video until camera restart')).toBeVisible()
  expect(await page.evaluate(() => window.testCamera.photoCalls)).toBe(1)
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  await page.evaluate(() => { window.testCamera.photoFail = false })
  await page.getByRole('button', { name: 'Resume' }).tap()
  await expect(page.getByTestId('Capture source')).toHaveText('High-resolution still')
  await expect(page.getByRole('listitem')).toHaveCount(2)
})

test('reset cancels a pending still and rejects late pixels while a new camera can restart', async ({ page }) => {
  await mockCamera(page)
  await mockStill(page, true)
  await page.goto('./')
  await page.waitForFunction(() => Boolean(window.testCamera.releasePhoto))
  await page.getByRole('button', { name: 'Reset run' }).tap()
  await expect(page.getByText('paused', { exact: true })).toBeVisible()
  await page.evaluate(() => { window.testCamera.photoHold = false })
  await page.getByRole('button', { name: 'Resume' }).tap()
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Reset run' }).tap()
  await page.evaluate(() => window.testCamera.releasePhoto?.())
  await expect(page.getByTestId('Unique codes')).toHaveText('0')
  await expect(page.getByTestId('Decoder calls')).toHaveText('0')
  expect(await page.evaluate(() => window.testCamera.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true)
})

test('reset during a long sweep discards pending results and repeated resumes remain usable', async ({ page }) => {
  await mockCamera(page)
  await mockStill(page)
  await page.goto('./')
  await waitScanning(page)
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  await page.getByLabel('Crop size').selectOption('768')
  await page.getByLabel('Crop overlap').selectOption('0.75')
  for (let run = 0; run < 3; run++) {
    await page.getByRole('button', { name: 'Resume' }).tap()
    await expect.poll(async () => Number(await page.getByTestId('Decoder calls').textContent())).toBeGreaterThan(2)
    await page.getByRole('button', { name: 'Reset run' }).tap()
    await expect(page.getByTestId('Unique codes')).toHaveText('0')
    await expect(page.getByTestId('Decoder calls')).toHaveText('0')
    await expect(page.getByTestId('Completed sweeps')).toHaveText('0')
  }
})


test('native crops recover a small second label missed by the overview and finish both binarizers', async ({ page }) => {
  await mockCamera(page)
  await mockStill(page, false, false, true)
  await page.addInitScript(() => {
    const passes: { sceneId: number; stage: string; completed: number; total: number; codes: { hash: string }[] }[] = []
    Object.assign(window, { observedPasses: passes })
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', ({ data }) => { if (data.type === 'progress') passes.push(data) })
      }
    }
  })
  await page.goto('./')
  await expect(page.getByRole('listitem')).toHaveCount(2, { timeout: 20000 })
  await expect.poll(async () => Number(await page.getByTestId('Completed sweeps').textContent())).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  const passes = await page.evaluate(() => (window as unknown as { observedPasses: { sceneId: number; stage: string; completed: number; total: number; codes: { hash: string }[] }[] }).observedPasses.filter((pass) => pass.sceneId === 1))
  const overviewHashes = passes.filter((pass) => pass.stage.startsWith('Overview')).flatMap((pass) => pass.codes.map((code) => code.hash.slice(0, 16)))
  expect(overviewHashes).toContain(hash('box-one'))
  expect(overviewHashes).not.toContain(hash('box-two'))
  expect(passes.filter((pass) => pass.stage.startsWith('Crop')).flatMap((pass) => pass.codes.map((code) => code.hash.slice(0, 16)))).toContain(hash('box-two'))
  expect(passes).toHaveLength(72)
  expect(passes.at(-1)).toMatchObject({ completed: 72, total: 72, stage: 'Crop 35 / 35 · GlobalHistogram' })
})
