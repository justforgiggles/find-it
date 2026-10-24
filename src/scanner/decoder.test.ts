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
  it.each(['capture', 'fast'] as const)('decodes binary Aztec bytes with the %s profile', async (profile) => {
    const payload = new Uint8Array([0, 1, 127, 128, 255, 65, 90, 84, 69, 67])
    const encoded = await writeBarcode(payload, { format: 'Aztec', rotate: 90 })
    expect(encoded.error).toBe('')
    const result = await decodeFrame(frame(encoded.symbol), profile)
    expect(result.code).toEqual({ hash: createHash('sha256').update(payload).digest('hex'), byteLength: payload.length })
  })

  it('rejects blank frames and QR codes', async () => {
    const qr = await writeBarcode('not an Aztec code', { format: 'QRCode' })
    expect((await decodeFrame(frame(), 'capture')).code).toBeNull()
    expect((await decodeFrame(frame(qr.symbol), 'capture')).code).toBeNull()
  })

  it('keeps one row for repeat reads and counts empty and duplicate results separately', async () => {
    const barcode = await writeBarcode('box-1', { format: 'Aztec' })
    const { code } = await decodeFrame(frame(barcode.symbol), 'capture')
    expect(code).not.toBeNull()
    const session = new ScanSession()
    expect(session.record(code, 10, 8)).toBe(true)
    expect(session.record(code, 20, 18)).toBe(false)
    expect(session.record(null, 5, 3)).toBe(false)
    expect(session.snapshot()).toMatchObject({ unique: 1, duplicates: 1, attempts: 3, emptyResults: 1, p50: 10, p95: 20, emptyP50: 5 })
    expect(new ScanSession().record(code, 12, 9)).toBe(true)
  })

  it('preserves portrait framing and never upscales low-resolution camera input', () => {
    expect(frameSize(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 })
    expect(frameSize(640, 480, 1920)).toEqual({ width: 640, height: 480 })
  })
})
