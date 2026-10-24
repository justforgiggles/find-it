import type { DecodedCode } from './protocol'

export interface ScanRow extends DecodedCode {
  scannedAt: string
  processingMs: number
}

function percentile(samples: number[], fraction: number): number | null {
  if (!samples.length) return null
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

function sample(samples: number[], value: number) {
  samples.push(value)
  if (samples.length > 1000) samples.shift()
}

export class ScanSession {
  private seen = new Set<string>()
  private processing: number[] = []
  private empty: number[] = []
  private successful: number[] = []
  private decoder: number[] = []
  rows: ScanRow[] = []
  attempts = 0
  duplicates = 0
  emptyResults = 0
  skipped = 0

  record(code: DecodedCode | null, processingMs: number, decodeMs: number) {
    this.attempts++
    sample(this.processing, processingMs)
    sample(this.decoder, decodeMs)
    if (!code) {
      this.emptyResults++
      sample(this.empty, processingMs)
      return false
    }
    sample(this.successful, processingMs)
    if (this.seen.has(code.hash)) {
      this.duplicates++
      return false
    }
    this.seen.add(code.hash)
    this.rows.unshift({ ...code, scannedAt: new Date().toISOString(), processingMs })
    return true
  }

  snapshot() {
    return {
      attempts: this.attempts,
      duplicates: this.duplicates,
      emptyResults: this.emptyResults,
      skipped: this.skipped,
      unique: this.seen.size,
      p50: percentile(this.processing, 0.5),
      p95: percentile(this.processing, 0.95),
      emptyP50: percentile(this.empty, 0.5),
      successP50: percentile(this.successful, 0.5),
      decoderP50: percentile(this.decoder, 0.5),
      sampleCount: this.processing.length,
      rows: [...this.rows],
    }
  }
}
