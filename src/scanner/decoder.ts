import { readBarcodes } from 'zxing-wasm/reader'
import type { DecodedCode } from './protocol'
import { readerOptions, type Binarizer } from './settings'

export async function decodeFrame(image: ImageData, binarizer: Binarizer) {
  const started = performance.now()
  const results = await readBarcodes(image, readerOptions(binarizer))
  const decodeMs = performance.now() - started
  const codes: DecodedCode[] = []
  for (const result of results) {
    if (!result.isValid || result.symbology !== 'Aztec') continue
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(result.bytes))
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    if (!codes.some((code) => code.hash === hash)) codes.push({ hash, byteLength: result.bytes.length })
  }
  return { decodeMs, codes }
}
