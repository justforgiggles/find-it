import type { DecodedCode, SearchProgress } from './protocol'

export interface ScanRow extends DecodedCode { scannedAt: string; processingMs: number }
export interface SceneMetrics {
  id: number; source: string; width: number; height: number; original: string; captureMs: number
  completed: number; total: number; stage: string; firstResultMs: number | null; sweepMs: number | null
}
function percentile(samples: number[], fraction: number): number | null {
  if (!samples.length) return null
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}
function sample(samples: number[], value: number) { samples.push(value); if (samples.length > 1000) samples.shift() }

export class ScanSession {
  private seen = new Set<string>()
  private sceneSeen = new Set<string>()
  private sweeps: number[] = []
  private decoder: number[] = []
  rows: ScanRow[] = []
  scene: SceneMetrics | null = null
  lastCompleted: SceneMetrics | null = null
  completedSweeps = 0
  decoderCalls = 0
  duplicates = 0
  emptyScenes = 0

  begin(scene: Omit<SceneMetrics, 'completed' | 'total' | 'stage' | 'firstResultMs' | 'sweepMs'>) {
    this.sceneSeen.clear()
    this.scene = { ...scene, completed: 0, total: 0, stage: 'Overview', firstResultMs: null, sweepMs: null }
  }
  record(progress: SearchProgress, elapsedMs: number) {
    if (!this.scene) return false
    this.decoderCalls++
    sample(this.decoder, progress.decodeMs)
    Object.assign(this.scene, { completed: progress.completed, total: progress.total, stage: progress.stage })
    let added = false
    for (const code of progress.codes) {
      if (this.sceneSeen.has(code.hash)) continue
      this.sceneSeen.add(code.hash)
      this.scene.firstResultMs ??= elapsedMs
      if (this.seen.has(code.hash)) { this.duplicates++; continue }
      this.seen.add(code.hash)
      this.rows.unshift({ ...code, scannedAt: new Date().toISOString(), processingMs: elapsedMs })
      added = true
    }
    return added
  }
  complete(elapsedMs: number) {
    if (!this.scene) return
    this.scene.sweepMs = elapsedMs
    this.lastCompleted = { ...this.scene }
    this.completedSweeps++
    if (!this.sceneSeen.size) this.emptyScenes++
    sample(this.sweeps, elapsedMs)
  }
  snapshot() {
    return {
      completedSweeps: this.completedSweeps, decoderCalls: this.decoderCalls, duplicates: this.duplicates,
      emptyScenes: this.emptyScenes, unique: this.seen.size,
      sweepP50: percentile(this.sweeps, 0.5), sweepP95: percentile(this.sweeps, 0.95), decoderP50: percentile(this.decoder, 0.5),
      sampleCount: this.sweeps.length, rows: [...this.rows], scene: this.scene ? { ...this.scene } : null,
      lastCompleted: this.lastCompleted ? { ...this.lastCompleted } : null,
    }
  }
}
