/**
 * Typed HTTP client for the Agora API. Works in the browser (relative URLs)
 * and in tsx scripts (absolute base URL). Every route in ARCHITECTURE.md has
 * a method here; the UI and the simulator both go through this file.
 */
import type { z } from 'zod'
import {
  AddQuestionsResult,
  ApiError,
  CreateSessionResult,
  JoinResult,
  OkResult,
  ProposeResult,
  StudentView,
  TeacherView,
  type AddQuestionsBody,
  type AdvanceBody,
  type CreateSessionBody,
  type JoinBody,
  type ProposeBody,
  type ReviseBody,
  type StartBody,
  type SubmitBody,
} from '@/lib/types'

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

export interface ApiOptions {
  /** Defaults to '' in the browser and NEXT_PUBLIC_APP_URL (or localhost:3000) elsewhere. */
  baseUrl?: string
  teacherToken?: string
  fetchImpl?: typeof fetch
}

function defaultBaseUrl(): string {
  if (typeof window !== 'undefined') return ''
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

type Method = 'GET' | 'POST'

export function createApi(opts: ApiOptions = {}) {
  const base = (opts.baseUrl ?? defaultBaseUrl()).replace(/\/$/, '')
  const fetchImpl = opts.fetchImpl ?? fetch

  async function request<T>(method: Method, path: string, body?: unknown, schema?: z.ZodType<T>): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (opts.teacherToken) headers['x-teacher-token'] = opts.teacherToken

    let res: Response
    try {
      res = await fetchImpl(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      })
    } catch (e) {
      throw new ApiRequestError(0, 'network', e instanceof Error ? e.message : String(e))
    }

    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }

    if (!res.ok) {
      const parsed = ApiError.safeParse(json)
      const code = parsed.success ? parsed.data.error.code : `http_${res.status}`
      const message = parsed.success ? parsed.data.error.message : text || res.statusText || 'request failed'
      throw new ApiRequestError(res.status, code, message)
    }
    return schema ? schema.parse(json) : (json as T)
  }

  const q = (id: string) => encodeURIComponent(id)

  return {
    createSession: (body: CreateSessionBody) => request('POST', '/api/sessions', body, CreateSessionResult),
    addQuestions: (sessionId: string, body: AddQuestionsBody) =>
      request('POST', `/api/sessions/${q(sessionId)}/questions`, body, AddQuestionsResult),
    generate: (sessionId: string, topic: string) =>
      request<{ ok: boolean }>('POST', `/api/sessions/${q(sessionId)}/generate`, { topic }),
    join: (body: JoinBody) => request('POST', '/api/join', body, JoinResult),
    studentView: (sessionId: string, participantId: string) =>
      request('GET', `/api/sessions/${q(sessionId)}/view?participantId=${q(participantId)}`, undefined, StudentView),
    teacherView: (sessionId: string) =>
      request('GET', `/api/sessions/${q(sessionId)}/teacher-view`, undefined, TeacherView),
    start: (sessionId: string, body: StartBody) => request('POST', `/api/sessions/${q(sessionId)}/start`, body, OkResult),
    advance: (questionId: string, body: AdvanceBody) =>
      request('POST', `/api/questions/${q(questionId)}/advance`, body, OkResult),
    reveal: (questionId: string) => request('POST', `/api/questions/${q(questionId)}/reveal`, {}, OkResult),
    cluster: (questionId: string) => request('POST', `/api/questions/${q(questionId)}/cluster`, {}, OkResult),
    recomputeSnapshot: (questionId: string) =>
      request('POST', `/api/questions/${q(questionId)}/recompute-snapshot`, {}, OkResult),
    narrate: (questionId: string) => request<{ narration: string | null }>('GET', `/api/questions/${q(questionId)}/narrate`),
    propose: (questionId: string, body: ProposeBody) =>
      request('POST', `/api/questions/${q(questionId)}/propose`, body, ProposeResult),
    submit: (questionId: string, body: SubmitBody) =>
      request('POST', `/api/questions/${q(questionId)}/submit`, body, OkResult),
    revise: (questionId: string, body: ReviseBody) =>
      request('POST', `/api/questions/${q(questionId)}/revise`, body, OkResult),
  }
}

export type Api = ReturnType<typeof createApi>
