import type { FrameRequest, WorkerReply } from './protocol'
import { ScanSession } from './session'
import { frameSize, type Profile, type Resolution } from './settings'

type Status = 'idle' | 'starting' | 'scanning' | 'paused' | 'error'

export class ScannerController {
  private video: HTMLVideoElement
  private canvas = document.createElement('canvas')
  private context = this.canvas.getContext('2d', { willReadFrequently: true })
  private notify: () => void
  private stream: MediaStream | null = null
  private worker: Worker | null = null
  private session = new ScanSession()
  private generation = 0
  private epoch = 0
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
  profile: Profile = 'capture'
  resolution: Resolution = 1280
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
      profile: this.profile, resolution: this.resolution,
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
      if (!this.context) throw new Error('This browser cannot capture video frames.')
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
            clearTimeout(this.watchdog)
            this.busy = false
            if (data.epoch !== this.epoch || this.status !== 'scanning') return
            this.windowAttempts++
            const isNew = this.session.record(data.code, performance.now() - this.sentAt, data.decodeMs)
            if (isNew && data.code) {
              this.notice = `New code: ${data.code.hash.slice(0, 16)}`
              this.notify()
            }
          }
        }
      })
      // Both begin immediately. A late permission grant is stopped after cancellation.
      const camera = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: Math.max(1280, this.resolution) },
          height: { ideal: Math.max(720, Math.round(this.resolution * 9 / 16)) },
          frameRate: { ideal: 60 },
        },
      }).then((stream) => {
        if (generation !== this.generation) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        this.stream = stream
        const track = stream.getVideoTracks()[0]
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
    this.epoch++
    this.session = new ScanSession()
    this.notice = ''
    this.previewFps = 0
    this.scansPerSecond = 0
    this.resetRateWindow()
    this.notify()
  }

  configure(profile: Profile, resolution: Resolution) {
    if (this.status === 'starting' || this.status === 'scanning') return
    this.profile = profile
    this.resolution = resolution
    this.scanSize = ''
    this.camera = ''
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
        this.capture()
        this.scheduleFrame()
      })
    } else {
      this.animationFrame = requestAnimationFrame(() => {
        if (this.video.currentTime !== this.lastVideoTime) {
          this.lastVideoTime = this.video.currentTime
          this.windowFrames++
          this.capture()
        }
        this.scheduleFrame()
      })
    }
  }

  private capture() {
    if (this.status !== 'scanning' || !this.worker || !this.context || this.video.readyState < 2) return
    if (this.busy) { this.session.skipped++; return }
    if (!this.video.videoWidth || !this.video.videoHeight) return
    try {
      this.busy = true
      this.sentAt = performance.now()
      const { width, height } = frameSize(this.video.videoWidth, this.video.videoHeight, this.resolution)
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width
        this.canvas.height = height
        this.scanSize = `${width} × ${height}`
      }
      this.context.drawImage(this.video, 0, 0, width, height)
      const pixels = this.context.getImageData(0, 0, width, height)
      const rgba = pixels.data.buffer as ArrayBuffer
      const request: FrameRequest = { epoch: this.epoch, rgba, width, height, profile: this.profile }
      this.worker.postMessage(request, [rgba])
      this.watchdog = setTimeout(() => this.fail('A scan stalled. Please retry.'), 15000)
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Could not capture a camera frame.')
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
