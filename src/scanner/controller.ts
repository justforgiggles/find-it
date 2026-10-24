import type { SceneRequest, WorkerReply } from './protocol'
import { ScanSession } from './session'
import { defaultSettings, type SearchSettings } from './settings'
import { SceneCamera } from './capture'

type Status = 'idle' | 'starting' | 'scanning' | 'paused' | 'error'

export class ScannerController {
  private video: HTMLVideoElement
  private sceneCamera: SceneCamera | null = null
  private notify: () => void
  private stream: MediaStream | null = null
  private worker: Worker | null = null
  private session = new ScanSession()
  private generation = 0
  private sceneId = 0
  private busy = false
  private sentAt = 0
  private callback = 0
  private animationFrame = 0
  private tick: ReturnType<typeof setInterval> | undefined
  private watchdog: ReturnType<typeof setTimeout> | undefined
  private cancelReady: (() => void) | undefined
  private lastVideoTime = -1
  private lastPresented: number | undefined
  private windowFrames = 0
  private windowAttempts = 0
  private windowAt = 0
  private startupAt = 0

  status: Status = 'idle'
  error = ''
  notice = ''
  settings: SearchSettings = { ...defaultSettings }
  captureSource = ''
  fallbackReason = ''
  previewFps = 0
  scansPerSecond = 0
  startupMs: number | null = null
  wasmStartupMs: number | null = null
  camera = ''
  scanSize = ''
  readonly preciseFrames: boolean

  constructor(video: HTMLVideoElement, notify: () => void) {
    this.video = video
    this.notify = notify
    this.preciseFrames = typeof video.requestVideoFrameCallback === 'function'
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('pagehide', this.onPageHide)
  }

  snapshot() {
    return {
      status: this.status, error: this.error, notice: this.notice,
      settings: { ...this.settings }, captureSource: this.captureSource, fallbackReason: this.fallbackReason,
      previewFps: this.previewFps, scansPerSecond: this.scansPerSecond,
      startupMs: this.startupMs, wasmStartupMs: this.wasmStartupMs,
      camera: this.camera, scanSize: this.scanSize, preciseFrames: this.preciseFrames,
      ...this.session.snapshot(),
    }
  }

  async start() {
    if (this.status === 'starting' || this.status === 'scanning') return
    this.stopRuntime()
    const generation = this.generation
    this.status = 'starting'
    this.error = ''
    this.notice = ''
    this.startupMs = null
    this.wasmStartupMs = null
    this.startupAt = performance.now()
    this.notify()
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost and a supported browser.')
      if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('This browser needs ImageBitmap and OffscreenCanvas support. Please update your browser.')
      const worker = new Worker(new URL('./scanner.worker.ts', import.meta.url), { type: 'module' })
      this.worker = worker
      const ready = new Promise<void>((resolve, reject) => {
        this.cancelReady = () => reject(new Error('Scanner stopped.'))
        this.watchdog = setTimeout(() => this.fail('The scanner took too long to load. Check your connection and retry.'), 20000)
        worker.onerror = () => this.fail('The scanner worker failed. Please retry.')
        worker.onmessageerror = () => this.fail('The scanner returned an unreadable message. Please retry.')
        worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
          if (generation !== this.generation) return
          if (data.type === 'ready') {
            clearTimeout(this.watchdog)
            this.wasmStartupMs = data.startupMs
            this.cancelReady = undefined
            resolve()
          } else if (data.type === 'error') {
            this.fail(data.message)
          } else {
            if (data.sceneId !== this.sceneId || this.status !== 'scanning') return
            clearTimeout(this.watchdog)
            if (data.type === 'progress') {
              const added = this.session.record(data, performance.now() - this.sentAt)
              if (added) this.notice = `New code: ${this.session.rows[0].hash.slice(0, 16)}`
              this.watchdog = setTimeout(() => this.fail('A decoder call stalled. Please retry.'), 30000)
            } else {
              this.session.complete(performance.now() - this.sentAt)
              this.busy = false
              this.windowAttempts++
            }
            this.notify()
          }
        }
      })
      // Both begin immediately. A late permission grant is stopped after cancellation.
      const camera = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 4096 },
          height: { ideal: 3072 },
          frameRate: { ideal: 30 },
        },
      }).then((stream) => {
        if (generation !== this.generation) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        this.stream = stream
        const track = stream.getVideoTracks()[0]
        this.sceneCamera = new SceneCamera(track)
        const settings = track.getSettings()
        this.camera = `${settings.width ?? '?'} × ${settings.height ?? '?'} · ${settings.frameRate?.toFixed(0) ?? '?'} fps reported`
        track.onended = () => this.fail('Camera access ended. Tap Start / Retry to reconnect.')
        this.video.srcObject = stream
      })
      await Promise.all([ready, camera])
      if (generation !== this.generation) return
      await this.video.play()
      if (generation !== this.generation) return
      if (document.hidden) { this.pause(); return }
      this.status = 'scanning'
      this.startupMs = performance.now() - this.startupAt
      this.resetRateWindow()
      this.tick = setInterval(() => {
        const now = performance.now()
        const seconds = (now - this.windowAt) / 1000
        this.previewFps = this.windowFrames / seconds
        this.scansPerSecond = this.windowAttempts / seconds
        this.resetRateWindow()
        this.notify()
      }, 1000)
      this.scheduleFrame()
      this.notify()
    } catch (error) {
      if (generation !== this.generation) return
      const name = error instanceof Error ? error.name : ''
      const message = name === 'NotAllowedError'
        ? 'Camera permission was denied or playback was blocked. Allow camera access in browser settings, then tap Start / Retry.'
        : name === 'NotFoundError' ? 'No camera was found. Connect a camera and retry.'
          : name === 'NotReadableError' ? 'The camera is unavailable. Close other apps using it and retry.'
            : error instanceof Error ? error.message : 'Could not start the camera. Please retry.'
      this.fail(message)
    }
  }

  pause() {
    this.stopRuntime()
    this.status = 'paused'
    this.notify()
  }

  reset() {
    // Termination cancels the active sweep; a late acquisition is closed by its generation guard.
    this.pause()
    this.session = new ScanSession()
    this.notice = ''
    this.captureSource = ''
    this.scanSize = ''
    this.fallbackReason = ''
    this.resetRateWindow()
    this.notify()
  }

  configure(settings: SearchSettings) {
    if (this.status === 'starting' || this.status === 'scanning') return
    this.settings = { ...settings }
    this.reset()
  }

  dispose() {
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('pagehide', this.onPageHide)
    this.stopRuntime()
  }

  private resetRateWindow() {
    this.windowAt = performance.now()
    this.windowFrames = 0
    this.windowAttempts = 0
  }

  private onVisibility = () => {
    if (document.hidden && (this.status === 'scanning' || this.status === 'starting')) this.pause()
  }

  private onPageHide = () => this.pause()

  private scheduleFrame() {
    if (this.status !== 'scanning') return
    if (this.preciseFrames) {
      this.callback = this.video.requestVideoFrameCallback((_now, metadata) => {
        const frames = this.lastPresented === undefined ? 1 : Math.max(1, metadata.presentedFrames - this.lastPresented)
        this.lastPresented = metadata.presentedFrames
        this.windowFrames += frames
        void this.capture()
        this.scheduleFrame()
      })
    } else {
      this.animationFrame = requestAnimationFrame(() => {
        if (this.video.currentTime !== this.lastVideoTime) {
          this.lastVideoTime = this.video.currentTime
          this.windowFrames++
          void this.capture()
        }
        this.scheduleFrame()
      })
    }
  }

  private async capture() {
    if (this.status !== 'scanning' || !this.worker || !this.sceneCamera || this.video.readyState < 2) return
    if (this.busy || !this.video.videoWidth || !this.video.videoHeight) return
    const generation = this.generation
    const current = () => generation === this.generation && this.status === 'scanning'
    this.busy = true
    this.sentAt = performance.now()
    this.watchdog = setTimeout(() => this.fail('Camera capture stalled. Please retry.'), 45000)
    try {
      const captured = await this.sceneCamera.capture(this.video, current)
      if (!captured) return
      if (!current() || !this.worker) { captured.bitmap.close(); return }
      const { bitmap, source, width, height, original, captureMs, fallbackReason } = captured
      this.captureSource = source === 'still' ? 'High-resolution still' : 'Video frame'
      this.fallbackReason = fallbackReason
      this.scanSize = `${width} × ${height}`
      const sceneId = ++this.sceneId
      this.session.begin({ id: sceneId, source, width, height, original, captureMs })
      const request: SceneRequest = { sceneId, bitmap, settings: { ...this.settings } }
      try { this.worker.postMessage(request, [bitmap]) } catch (error) { bitmap.close(); throw error }
      clearTimeout(this.watchdog)
      this.watchdog = setTimeout(() => this.fail('A decoder call stalled. Please retry.'), 30000)
      this.notify()
    } catch (error) {
      if (current()) this.fail(error instanceof Error ? error.message : 'Could not capture a camera image.')
    }
  }

  private fail(message: string) {
    this.stopRuntime()
    this.status = 'error'
    this.error = message
    this.notify()
  }

  private stopRuntime() {
    this.generation++
    this.cancelReady?.()
    this.cancelReady = undefined
    clearTimeout(this.watchdog)
    clearInterval(this.tick)
    if (this.preciseFrames) this.video.cancelVideoFrameCallback(this.callback)
    cancelAnimationFrame(this.animationFrame)
    this.worker?.terminate()
    this.worker = null
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    this.stream = null
    this.sceneCamera = null
    this.video.pause()
    this.video.srcObject = null
    this.busy = false
    this.lastVideoTime = -1
    this.lastPresented = undefined
    this.previewFps = 0
    this.scansPerSecond = 0
  }
}

export type ScannerSnapshot = ReturnType<ScannerController['snapshot']>
