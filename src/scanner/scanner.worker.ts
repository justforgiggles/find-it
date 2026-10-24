/// <reference lib="webworker" />
import { prepareZXingModule } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { searchScene } from './search'
import type { SceneRequest, WorkerReply } from './protocol'

declare const self: DedicatedWorkerGlobalScope
const send = (message: WorkerReply) => self.postMessage(message)
const started = performance.now()
const ready = prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? new URL(wasmUrl, self.location.href).href : prefix + path },
  fireImmediately: true,
})
void ready.then(() => send({ type: 'ready', startupMs: performance.now() - started })).catch(fail)
self.onmessage = async ({ data }: MessageEvent<SceneRequest>) => {
  try {
    await ready
    await searchScene(data.bitmap, data.settings, (progress) => send({ type: 'progress', sceneId: data.sceneId, ...progress }))
    send({ type: 'complete', sceneId: data.sceneId })
  } catch (error) { fail(error) }
}
function fail(error: unknown) {
  send({ type: 'error', message: error instanceof Error ? error.message : 'Decoder failed. Please retry.' })
}
