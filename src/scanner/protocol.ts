import type { Profile } from './settings'

export interface FrameRequest {
  epoch: number
  rgba: ArrayBuffer
  width: number
  height: number
  profile: Profile
}

export interface DecodedCode {
  hash: string
  byteLength: number
}

export type WorkerReply =
  | { type: 'ready'; startupMs: number }
  | { type: 'result'; epoch: number; decodeMs: number; code: DecodedCode | null }
  | { type: 'error'; message: string }
