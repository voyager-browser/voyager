import { shell } from 'electron'
import { broadcastExtensionApiEvent } from './events'
import { registerExtensionApiHandler } from './registry'
import { getApiSetting, setApiSetting } from './storage'
import type { ExtensionApiContext } from './types'

interface TtsVoice {
  voiceName: string
  lang: string
  gender: 'male' | 'female'
  remote: boolean
}

interface TtsState {
  speaking: boolean
  paused: boolean
  text: string
  rate: number
  pitch: number
  volume: number
  wordIndex: number
  startedAt: number
  voiceName?: string
}

interface WordSpan {
  start: number
  length: number
}

interface ActiveUtterance {
  text: string
  words: WordSpan[]
  index: number
  timer: NodeJS.Timeout | null
}

const VOICES: TtsVoice[] = [
  { voiceName: 'Samantha', lang: 'en-US', gender: 'female', remote: false },
  { voiceName: 'Daniel', lang: 'en-GB', gender: 'male', remote: false },
  { voiceName: 'Google US English', lang: 'en-US', gender: 'female', remote: false },
  { voiceName: 'Google UK English Male', lang: 'en-GB', gender: 'male', remote: false },
  { voiceName: 'Microsoft Zira', lang: 'en-US', gender: 'female', remote: false },
  { voiceName: 'Microsoft David', lang: 'en-US', gender: 'male', remote: false }
]

const active = new Map<string, ActiveUtterance>()

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const storageKey = (extensionId: string): string => `tts:${extensionId}`
const activeKey = (profileId: string, extensionId: string): string =>
  `${profileId}\u0000${extensionId}`

function defaultState(): TtsState {
  return {
    speaking: false,
    paused: false,
    text: '',
    rate: 1,
    pitch: 1,
    volume: 1,
    wordIndex: 0,
    startedAt: 0
  }
}

function readState(profileId: string, extensionId: string): TtsState {
  const stored = getApiSetting<Partial<TtsState> | null>(profileId, storageKey(extensionId), null)
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaultState()
  return {
    speaking: stored.speaking === true,
    paused: stored.paused === true,
    text: typeof stored.text === 'string' ? stored.text : '',
    rate: typeof stored.rate === 'number' && stored.rate > 0 ? stored.rate : 1,
    pitch: typeof stored.pitch === 'number' ? stored.pitch : 1,
    volume: typeof stored.volume === 'number' ? stored.volume : 1,
    wordIndex: typeof stored.wordIndex === 'number' ? stored.wordIndex : 0,
    startedAt: typeof stored.startedAt === 'number' ? stored.startedAt : 0,
    ...(typeof stored.voiceName === 'string' ? { voiceName: stored.voiceName } : {})
  }
}

function writeState(profileId: string, extensionId: string, state: TtsState): void {
  setApiSetting(profileId, storageKey(extensionId), state)
}

function wordsOf(text: string): WordSpan[] {
  const spans: WordSpan[] = []
  const pattern = /\S+/g
  let match: RegExpExecArray | null = pattern.exec(text)
  while (match) {
    spans.push({ start: match.index, length: match[0].length })
    match = pattern.exec(text)
  }
  return spans
}

function delayFor(state: TtsState): number {
  const rate = state.rate > 0 ? state.rate : 1
  return Math.max(30, Math.round(260 / rate))
}

function emit(context: ExtensionApiContext, event: string, payload: Record<string, unknown>): void {
  broadcastExtensionApiEvent(
    context.profileId,
    { path: ['tts'], event, args: [payload], extensionId: context.extensionId },
    'tts'
  )
}

/**
 * Prefer a system speech hook when the host exposes one. Stock Electron has no
 * speech API, so this normally returns false and the in-process simulation
 * drives the events without launching a process or using the network.
 */
function speakWithSystem(text: string, options: Record<string, unknown>): boolean {
  try {
    const candidate = (shell as unknown as Record<string, unknown>).speak
    if (typeof candidate !== 'function') return false
    return candidate.call(shell, text, options) !== false
  } catch {
    return false
  }
}

function finish(context: ExtensionApiContext, key: string, utterance: ActiveUtterance): void {
  if (utterance.timer) clearTimeout(utterance.timer)
  utterance.timer = null
  active.delete(key)
  const state = readState(context.profileId, context.extensionId)
  state.speaking = false
  state.paused = false
  state.wordIndex = utterance.words.length
  writeState(context.profileId, context.extensionId, state)
  emit(context, 'onEnd', { type: 'end', charIndex: utterance.text.length })
}

function scheduleNext(context: ExtensionApiContext, key: string, utterance: ActiveUtterance): void {
  if (utterance.timer) clearTimeout(utterance.timer)
  const state = readState(context.profileId, context.extensionId)
  if (state.paused) {
    utterance.timer = null
    return
  }
  const delay = delayFor(state)
  if (utterance.index >= utterance.words.length) {
    utterance.timer = setTimeout(() => finish(context, key, utterance), delay)
    return
  }
  utterance.timer = setTimeout(() => {
    utterance.timer = null
    if (active.get(key) !== utterance) return
    const span = utterance.words[utterance.index]
    if (!span) {
      finish(context, key, utterance)
      return
    }
    utterance.index += 1
    const current = readState(context.profileId, context.extensionId)
    current.wordIndex = utterance.index
    writeState(context.profileId, context.extensionId, current)
    emit(context, 'onWordBoundary', {
      type: 'word',
      charIndex: span.start,
      charLength: span.length
    })
    scheduleNext(context, key, utterance)
  }, delay)
}

export function registerTts(): void {
  registerExtensionApiHandler('tts', {
    permissions: ['tts'],
    invoke(context, method, args): unknown {
      const key = activeKey(context.profileId, context.extensionId)

      if (method === 'speak') {
        const text = typeof args[0] === 'string' ? args[0] : ''
        const options = record(args[1])
        if (!text) {
          emit(context, 'onError', { type: 'error', errorMessage: 'No text to speak' })
          return false
        }
        const previous = active.get(key)
        if (previous) {
          if (previous.timer) clearTimeout(previous.timer)
          active.delete(key)
        }
        const rate = typeof options.rate === 'number' && options.rate > 0 ? options.rate : 1
        const pitch = typeof options.pitch === 'number' ? options.pitch : 1
        const volume = typeof options.volume === 'number' ? options.volume : 1
        const voiceName = typeof options.voiceName === 'string' ? options.voiceName : undefined
        writeState(context.profileId, context.extensionId, {
          speaking: true,
          paused: false,
          text,
          rate,
          pitch,
          volume,
          wordIndex: 0,
          startedAt: Date.now(),
          ...(voiceName === undefined ? {} : { voiceName })
        })
        speakWithSystem(text, {
          rate,
          pitch,
          volume,
          ...(voiceName === undefined ? {} : { voice: voiceName })
        })
        const utterance: ActiveUtterance = {
          text,
          words: wordsOf(text),
          index: 0,
          timer: null
        }
        active.set(key, utterance)
        emit(context, 'onStart', { type: 'start', charIndex: 0 })
        scheduleNext(context, key, utterance)
        return true
      }
      if (method === 'stop') {
        const utterance = active.get(key)
        if (utterance) {
          if (utterance.timer) clearTimeout(utterance.timer)
          active.delete(key)
          const state = readState(context.profileId, context.extensionId)
          state.speaking = false
          state.paused = false
          writeState(context.profileId, context.extensionId, state)
          emit(context, 'onEnd', {
            type: 'end',
            charIndex: utterance.text.length,
            interrupted: true
          })
        } else {
          const state = readState(context.profileId, context.extensionId)
          if (state.speaking) {
            state.speaking = false
            state.paused = false
            writeState(context.profileId, context.extensionId, state)
          }
        }
        return undefined
      }
      if (method === 'pause') {
        const utterance = active.get(key)
        if (!utterance) return undefined
        if (utterance.timer) clearTimeout(utterance.timer)
        utterance.timer = null
        const state = readState(context.profileId, context.extensionId)
        state.paused = true
        writeState(context.profileId, context.extensionId, state)
        return undefined
      }
      if (method === 'resume') {
        const utterance = active.get(key)
        if (!utterance) return undefined
        const state = readState(context.profileId, context.extensionId)
        if (!state.paused) return undefined
        state.paused = false
        writeState(context.profileId, context.extensionId, state)
        scheduleNext(context, key, utterance)
        return undefined
      }
      if (method === 'isSpeaking') {
        const state = readState(context.profileId, context.extensionId)
        if (!active.has(key)) {
          if (state.speaking) {
            state.speaking = false
            state.paused = false
            writeState(context.profileId, context.extensionId, state)
          }
          return false
        }
        return state.speaking
      }
      if (method === 'getVoices') {
        const options = record(args[0])
        const lang = typeof options.lang === 'string' ? options.lang.toLowerCase() : ''
        const voices = lang
          ? VOICES.filter((voice) => voice.lang.toLowerCase().startsWith(lang))
          : VOICES
        return voices.map((voice) => ({ ...voice }))
      }
      throw new Error(`chrome.tts.${method} is not supported.`)
    }
  })
}
