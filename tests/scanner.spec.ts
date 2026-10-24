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
    testCamera: { image: number; streams: MediaStream[]; denied: boolean; hold: boolean; release?: () => void }
  }
}

async function mockCamera(page: Page, denied = false, fallback = false, hold = false) {
  await page.addInitScript(({ images, denied, fallback, hold }) => {
    window.testCamera = { image: -1, streams: [], denied, hold }
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
  await expect.poll(async () => Number(await page.getByTestId('Completed scans').textContent())).toBeGreaterThan(0)
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
  await expect(page.getByTestId('Processing p95')).not.toHaveText('—')
  await expect(page.getByLabel('Search profile')).toBeDisabled()
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  await expect(page.getByText('paused', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.testCamera.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true)
  await expect(page.getByTestId('Scans / second')).toHaveText('0.0')
  await page.getByRole('button', { name: 'Resume' }).tap()
  await waitScanning(page)
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  await page.getByRole('button', { name: 'Reset run' }).tap()
  await expect(page.getByTestId('Unique codes')).toHaveText('0')
  await expect(page.getByTestId('Completed scans')).toHaveText('0')
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

test('fast profile works with frame callback fallback and preserves portrait layout', async ({ page }) => {
  await mockCamera(page, false, true)
  await page.goto('./')
  await waitScanning(page)
  await page.getByRole('button', { name: 'Pause', exact: true }).tap()
  await page.getByLabel('Search profile').selectOption('fast')
  await page.getByLabel('Maximum frame edge').selectOption('640')
  await page.evaluate(() => { window.testCamera.image = 0 })
  await page.getByRole('button', { name: 'Resume' }).tap()
  await expect(page.getByRole('listitem')).toContainText(hash('box-one'))
  await expect(page.getByTestId('Preview FPS (estimated)')).toBeVisible()
  await page.getByText('Camera and startup details').tap()
  await expect(page.getByTestId('Processed frame')).toHaveText('640 × 360')
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
  expect(exported.settings.formats).toEqual(['Aztec'])
  expect(exported.unique).toBe(0)
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
