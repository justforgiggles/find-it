import { readBarcodes } from 'zxing-wasm/reader'
import type { DecodedCode } from './protocol'
import { readerOptions, type Profile } from './settings'

export async function decodeFrame(image: ImageData, profile: Profile) {
  const started = performance.now()
  const results = await readBarcodes(image, readerOptions(profile))
  const decodeMs = performance.now() - started
  const valid = results.find((result) => result.isValid && result.symbology === 'Aztec')
  let code: DecodedCode | null = null
  if (valid) {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(valid.bytes))
    code = {
      hash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      byteLength: valid.bytes.length,
    }
  }
  return { decodeMs, code }
}
