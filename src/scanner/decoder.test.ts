/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { prepareZXingModule as prepareReader } from 'zxing-wasm/reader'
import { prepareZXingModule as prepareWriter, writeBarcode, type BarcodeSymbol } from 'zxing-wasm/writer'
import { decodeFrame } from './decoder'
import { ScanSession } from './session'
import { frameSize } from './settings'

const require = createRequire(import.meta.url)
beforeAll(async () => {
  await Promise.all([
    prepareReader({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) }, fireImmediately: true }),
    prepareWriter({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm')) }, fireImmediately: true }),
  ])
})

function frame(symbol?: BarcodeSymbol): ImageData {
  const width = 640
  const height = 480
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  if (symbol) {
    const scale = 5
    for (let y = 0; y < symbol.height * scale; y++) {
      for (let x = 0; x < symbol.width * scale; x++) {
        const value = symbol.data[Math.floor(y / scale) * symbol.width + Math.floor(x / scale)]
        const offset = ((y + 100) * width + x + 160) * 4
        data[offset] = data[offset + 1] = data[offset + 2] = value
      }
    }
  }
  return { width, height, data, colorSpace: 'srgb' }
}

describe('actual WASM decoding and session identity', () => {
  it.each(['LocalAverage', 'GlobalHistogram'] as const)('decodes binary Aztec bytes with the %s profile', async (profile) => {
    const payload = new Uint8Array([0, 1, 127, 128, 255, 65, 90, 84, 69, 67])
    const encoded = await writeBarcode(payload, { format: 'Aztec', rotate: 90 })
    expect(encoded.error).toBe('')
    const result = await decodeFrame(frame(encoded.symbol), profile)
    expect(result.codes).toEqual([{ hash: createHash('sha256').update(payload).digest('hex'), byteLength: payload.length }])
  })

  it('rejects blank frames and QR codes', async () => {
    const qr = await writeBarcode('not an Aztec code', { format: 'QRCode' })
    expect((await decodeFrame(frame(), 'LocalAverage')).codes).toEqual([])
    expect((await decodeFrame(frame(qr.symbol), 'LocalAverage')).codes).toEqual([])
  })

  it('deduplicates overlapping passes within a scene and repeats across scenes', async () => {
    const barcode = await writeBarcode('box-1', { format: 'Aztec' })
    const { codes } = await decodeFrame(frame(barcode.symbol), 'LocalAverage')
    expect(codes).toHaveLength(1)
    const session = new ScanSession()
    const scene = { id: 1, source: 'video', width: 640, height: 480, original: '640 × 480', captureMs: 2 }
    const progress = { codes, decodeMs: 8, completed: 1, total: 4, stage: 'Overview' }
    session.begin(scene)
    expect(session.record(progress, 10)).toBe(true)
    expect(session.record(progress, 20)).toBe(false)
    session.complete(25)
    expect(session.snapshot()).toMatchObject({ unique: 1, duplicates: 0, completedSweeps: 1, decoderCalls: 2 })
    session.begin({ ...scene, id: 2 })
    session.record(progress, 15)
    session.record(progress, 20)
    session.complete(30)
    expect(session.snapshot()).toMatchObject({ unique: 1, duplicates: 1, completedSweeps: 2, sweepP50: 25, sweepP95: 30 })
    session.begin({ ...scene, id: 3 })
    session.record({ ...progress, codes: [] }, 5)
    session.complete(10)
    expect(session.snapshot()).toMatchObject({ emptyScenes: 1, lastCompleted: { firstResultMs: null } })
  })

  it.each([['box-two', 2], ['box-one', 1]] as const)('handles two rotated labels with second payload %s as %i identities', async (payload, count) => {
    const first = await writeBarcode('box-one', { format: 'Aztec' })
    const second = await writeBarcode(payload, { format: 'Aztec', rotate: 270 })
    const image = frame(first.symbol)
    const other = frame(second.symbol)
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < 300; x++) {
        const src = (y * image.width + x) * 4
        const dst = (y * image.width + x + 300) * 4
        image.data.set(other.data.subarray(src, src + 4), dst)
      }
    }
    expect((await decodeFrame(image, 'LocalAverage')).codes).toHaveLength(count)
  })

  it('preserves portrait framing and never upscales low-resolution camera input', () => {
    expect(frameSize(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 })
    expect(frameSize(640, 480, 1920)).toEqual({ width: 640, height: 480 })
  })
})
