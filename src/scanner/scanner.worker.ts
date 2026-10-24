/// <reference lib="webworker" />
import { prepareZXingModule } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { decodeFrame } from './decoder'
import type { FrameRequest, WorkerReply } from './protocol'

declare const self: DedicatedWorkerGlobalScope
const send = (message: WorkerReply) => self.postMessage(message)
const started = performance.now()

const ready = prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? new URL(wasmUrl, self.location.href).href : prefix + path },
  fireImmediately: true,
})

void ready.then(() => send({ type: 'ready', startupMs: performance.now() - started })).catch(fail)

self.onmessage = async ({ data }: MessageEvent<FrameRequest>) => {
  try {
    await ready
    const image = new ImageData(new Uint8ClampedArray(data.rgba), data.width, data.height)
    const result = await decodeFrame(image, data.profile)
    send({ type: 'result', epoch: data.epoch, ...result })
  } catch (error) {
    fail(error)
  }
}

function fail(error: unknown) {
  send({ type: 'error', message: error instanceof Error ? error.message : 'Decoder failed. Please retry.' })
}
