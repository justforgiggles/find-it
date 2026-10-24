import type { SearchSettings } from './settings'

export interface SceneRequest {
  sceneId: number
  bitmap: ImageBitmap
  settings: SearchSettings
}
export interface DecodedCode { hash: string; byteLength: number }
export interface SearchProgress {
  completed: number
  total: number
  stage: string
  decodeMs: number
  codes: DecodedCode[]
}
export type WorkerReply =
  | { type: 'ready'; startupMs: number }
  | ({ type: 'progress'; sceneId: number } & SearchProgress)
  | { type: 'complete'; sceneId: number }
  | { type: 'error'; message: string }
