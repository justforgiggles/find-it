import { useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ScannerController, type ScannerSnapshot } from '@/scanner/controller'
import { binarizers, readerOptions, type CropSize, type Overlap, type SearchSettings } from '@/scanner/settings'

const ms = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)} ms`

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="space-y-1"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums" data-testid={label}>{value}</dd></div>
}

function SwipeRun({ snapshot }: { snapshot: ScannerSnapshot }) {
  const [attempted, setAttempted] = useState('')
  const [captured, setCaptured] = useState('')
  const total = Number(attempted)
  const successes = Number(captured)
  const valid = attempted !== '' && captured !== '' && Number.isInteger(total) && Number.isInteger(successes) && total > 0 && successes >= 0 && successes <= total
  function download() {
    const data = {
      exportedAt: new Date().toISOString(), userAgent: navigator.userAgent,
      ...snapshot, readerOptions: binarizers.map(readerOptions),
      manualSwipeTest: valid ? { attempted: total, captured: successes, successRate: successes / total } : null,
      timingNote: 'Scene times include acquisition, search, hashing and worker round trips. First result is any decoded payload, including a repeat. Decoder timing is per WASM call. Percentiles cover the latest 1000 completed sweeps or calls. These are not code-entry-to-result times.',
    }
    const link = document.createElement('a')
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    link.href = url
    link.download = `aztec-${snapshot.settings.cropSize}-${Date.now()}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <Card>
    <CardHeader><CardTitle>Swipe test</CardTitle><CardDescription>Count attempted and captured swipes yourself. Repeated swipes over the same box are separate trials, even though its hash appears only once.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2"><Label htmlFor="attempted">Attempted swipes</Label><Input id="attempted" type="number" inputMode="numeric" min="0" step="1" value={attempted} onChange={(event) => setAttempted(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="captured">Captured swipes</Label><Input id="captured" type="number" inputMode="numeric" min="0" max={attempted || undefined} step="1" value={captured} onChange={(event) => setCaptured(event.target.value)} /></div>
      </div>
      <p className="text-sm">Capture success: <strong>{valid ? `${(successes / total * 100).toFixed(1)}%` : '—'}</strong></p>
      {attempted !== '' && captured !== '' && !valid && <p className="text-sm text-destructive">Enter whole numbers, with attempts above zero and captures between zero and attempts.</p>}
      <Button variant="outline" className="min-h-11" onClick={download}>Download run JSON</Button>
    </CardContent>
  </Card>
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controllerRef = useRef<ScannerController | null>(null)
  const [snapshot, setSnapshot] = useState<ScannerSnapshot>()
  const [runId, setRunId] = useState(0)

  useEffect(() => {
    if (!videoRef.current) return
    let disposed = false
    const controller = new ScannerController(videoRef.current, () => {
      if (!disposed) setSnapshot(controller.snapshot())
    })
    controllerRef.current = controller
    void controller.start()
    return () => {
      disposed = true
      controller.dispose()
      controllerRef.current = null
    }
  }, [])

  const status = snapshot?.status ?? 'starting'
  const active = status === 'starting' || status === 'scanning'
  function reset() { controllerRef.current?.reset(); setRunId((id) => id + 1) }
  function configure(settings: SearchSettings) {
    controllerRef.current?.configure(settings)
    setRunId((id) => id + 1)
  }

  return <main className="mx-auto max-w-2xl space-y-4 p-4 pb-8">
    <header className="flex items-center justify-between gap-4">
      <div><h1 className="text-xl font-semibold">Find it</h1><p className="text-sm text-muted-foreground">Aztec distance scanner</p></div>
      <Badge variant={status === 'scanning' ? 'default' : 'secondary'}>{status}</Badge>
    </header>

    <Card>
      <CardContent className="space-y-3">
        <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" className="aspect-[4/3] max-h-[50svh] w-full rounded-lg bg-muted object-contain" />
        <p className="text-sm text-muted-foreground">Hold the camera toward the boxes. Each captured scene is searched fully for multiple Aztec codes before taking the next image. Keep labels well lit and in focus.</p>
        <div className="flex flex-wrap gap-2">
          {active ? <Button className="min-h-11" variant="outline" onClick={() => controllerRef.current?.pause()}>{status === 'starting' ? 'Cancel startup' : 'Pause'}</Button>
            : <Button className="min-h-11" onClick={() => void controllerRef.current?.start()}>{status === 'paused' ? 'Resume' : 'Start / Retry'}</Button>}
          <Button className="min-h-11" variant="outline" onClick={reset}>Reset run</Button>
        </div>
        <p className="min-h-5 break-all text-sm" role="status" aria-live="polite">{snapshot?.notice || (status === 'starting' ? 'Allow camera access to start scanning…' : status === 'scanning' ? 'Ready for an Aztec code.' : 'Camera stopped.')}</p>
      </CardContent>
    </Card>

    {snapshot?.error && <Alert variant="destructive"><AlertTitle>Scanner unavailable</AlertTitle><AlertDescription>{snapshot.error}</AlertDescription></Alert>}

    {snapshot && <>
      <Card>
        <CardHeader><CardTitle>Live metrics</CardTitle><CardDescription>Results appear as each search pass finishes. Scene timings include capture, decoding, hashing, and the worker round trip.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label={snapshot.preciseFrames ? 'Preview FPS' : 'Preview FPS (estimated)'} value={snapshot.previewFps.toFixed(1)} />
            <Metric label="Sweeps / second" value={snapshot.scansPerSecond.toFixed(1)} />
            <Metric label="Sweep p50" value={ms(snapshot.sweepP50)} />
            <Metric label="Sweep p95" value={ms(snapshot.sweepP95)} />
            <Metric label="Decoder call p50" value={ms(snapshot.decoderP50)} />
            <Metric label="Completed sweeps" value={snapshot.completedSweeps} />
            <Metric label="Decoder calls" value={snapshot.decoderCalls} />
            <Metric label="Unique codes" value={snapshot.unique} />
            <Metric label="Duplicate reads" value={snapshot.duplicates} />
            <Metric label="Empty scenes" value={snapshot.emptyScenes} />
            <Metric label="Capture source" value={snapshot.captureSource || '—'} />
            <Metric label="Scene dimensions" value={snapshot.scanSize || '—'} />
            <Metric label="Capture duration" value={ms(snapshot.scene?.captureMs)} />
            <Metric label="First result (last sweep)" value={ms(snapshot.lastCompleted?.firstResultMs)} />
            <Metric label="Last sweep duration" value={ms(snapshot.lastCompleted?.sweepMs)} />
          </dl>
          <div className="space-y-1 text-sm" aria-label="Search progress">
            <p>{snapshot.scene?.stage || 'Waiting for capture'} · {snapshot.scene?.completed ?? 0} / {snapshot.scene?.total || '—'} passes</p>
            <progress className="w-full" aria-label="Completed search passes" value={snapshot.scene?.completed ?? 0} max={snapshot.scene?.total || 1} />
          </div>
          {snapshot.fallbackReason && <p className="text-sm text-muted-foreground">{snapshot.fallbackReason}</p>}
          <p className="text-xs text-muted-foreground">A sweep covers one captured scene. Both binarizers run on the overview and every crop. Duplicates count once per payload per later scene, regardless of overlapping crops. Percentiles use up to 1,000 samples ({snapshot.sampleCount} completed sweeps). Preview FPS is not sensor FPS; timings do not measure when a label entered view.</p>
          <details className="text-sm"><summary className="cursor-pointer">Camera and startup details</summary>
            <dl className="mt-3 grid grid-cols-2 gap-4">
              <Metric label="Camera settings" value={snapshot.camera || '—'} />
              <Metric label="Original capture" value={snapshot.scene?.original || '—'} />
              <Metric label="Startup to preview" value={ms(snapshot.startupMs)} />
              <Metric label="WASM startup" value={ms(snapshot.wasmStartupMs)} />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Startup includes permission and camera setup. WASM startup is measured separately inside the worker.</p>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Advanced search settings</CardTitle><CardDescription>Pause to change settings. Changes and Reset run clear results and cancel the current scene. Resume to start a fresh run.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2"><Label htmlFor="crop-size">Crop size</Label>
              <NativeSelect id="crop-size" className="min-h-11" disabled={active} value={snapshot.settings.cropSize} onChange={(event) => configure({ ...snapshot.settings, cropSize: Number(event.target.value) as CropSize })}>
                {[768, 1024, 1536, 2048].map((size) => <NativeSelectOption key={size} value={size}>{size} px</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="space-y-2"><Label htmlFor="overlap">Crop overlap</Label>
              <NativeSelect id="overlap" className="min-h-11" disabled={active} value={snapshot.settings.overlap} onChange={(event) => configure({ ...snapshot.settings, overlap: Number(event.target.value) as Overlap })}>
                {[0.25, 0.5, 0.75].map((overlap) => <NativeSelectOption key={overlap} value={overlap}>{overlap * 100}%</NativeSelectOption>)}
              </NativeSelect>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Prefer a still photo up to 25 megapixels, with video fallback. Search a 1920 px overview, then overlapping crops from the original pixels. Greater overlap takes longer. Still capture may briefly interrupt preview. Cropping cannot recover detail lost to blur or distance.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Unique results · {snapshot.unique}</CardTitle><CardDescription>SHA-256 of decoded bytes. Only a new payload adds a row. Stored in memory until reset or refresh.</CardDescription></CardHeader>
        <CardContent>
          {!snapshot.rows.length ? <p className="text-sm text-muted-foreground">No codes captured yet.</p> : <ol className="divide-y" aria-label="Scanned codes">
            {snapshot.rows.map((row) => <li key={row.hash} className="space-y-1 py-3">
              <code className="text-sm" title={row.hash}>{row.hash.slice(0, 16)}</code>
              <p className="text-xs text-muted-foreground">{new Date(row.scannedAt).toLocaleTimeString()} · {row.byteLength} bytes · {ms(row.processingMs)}</p>
            </li>)}
          </ol>}
        </CardContent>
      </Card>
      <SwipeRun key={runId} snapshot={snapshot} />
    </>}
  </main>
}

export default App
