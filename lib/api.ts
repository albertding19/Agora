/**
 * Typed HTTP client for the Agora API. Works in the browser (relative URLs)
 * and in tsx scripts (absolute base URL). Every route in ARCHITECTURE.md has
 * a method here; the UI and the simulator both go through this file.
 */
import type { z } from 'zod'
import {
  AddQuestionsResult,
  ApiError,
  ArgumentVoteResult,
  CandidatesResult,
  CreateSessionResult,
  FeaturesResult,
  JoinResult,
  OkResult,
  OpposeResult,
  ProposeResult,
  QuestionHistory,
  SocratesResult,
  SteelmanResult,
  StudentView,
  TeacherView,
  type AddQuestionsBody,
  type AdvanceBody,
  type AnswerBody,
  type ArgumentVoteBody,
  type CreateSessionBody,
  type FeaturesPatchBody,
  type JoinBody,
  type OpposeBody,
  type ProposeBody,
  type ReviseBody,
  type StartBody,
  type SteelmanBody,
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

type Method = 'GET' | 'POST' | 'PATCH'

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
    /** Plan §17: switch feature flags on or off mid-session; only the keys sent change. */
    setFeatures: (sessionId: string, patch: FeaturesPatchBody) =>
      request('PATCH', `/api/sessions/${q(sessionId)}/features`, patch, FeaturesResult),
    /** Plan §17.3: five propositions from a topic (fills the P1 stub). */
    generate: (sessionId: string, topic: string) =>
      request('POST', `/api/sessions/${q(sessionId)}/generate`, { topic }, CandidatesResult),
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

    // --- plan §17 extensions (routes land feature by feature) -------------
    /** §17.1 consider the opposite: the second number; the blind number becomes the blend. */
    oppose: (questionId: string, body: OpposeBody) =>
      request('POST', `/api/questions/${q(questionId)}/oppose`, body, OpposeResult),
    /** §17.3 open question: a free-text answer. */
    answer: (questionId: string, body: AnswerBody) =>
      request('POST', `/api/questions/${q(questionId)}/answer`, body, OkResult),
    /** §17.3 teacher: sharpen the clustered answers into candidate propositions. */
    sharpen: (questionId: string) =>
      request('POST', `/api/questions/${q(questionId)}/sharpen`, {}, CandidatesResult),
    /** §17.4 teacher: prepare one Socratic question per speaker in every group. */
    socrates: (questionId: string) =>
      request('POST', `/api/questions/${q(questionId)}/socrates`, {}, SocratesResult),
    /** §17.7 student: submit the other side's best argument for grading. */
    steelman: (questionId: string, body: SteelmanBody) =>
      request('POST', `/api/questions/${q(questionId)}/steelman`, body, SteelmanResult),
    /** §17.6 / §17.8 teacher: the price trajectory with anonymous annotations. */
    history: (questionId: string) => request('GET', `/api/questions/${q(questionId)}/history`, undefined, QuestionHistory),
    /** §17.9b student: one pairwise comparison of two anonymous arguments. */
    argumentVote: (questionId: string, body: ArgumentVoteBody) =>
      request('POST', `/api/questions/${q(questionId)}/argument-vote`, body, ArgumentVoteResult),
  }
}

export type Api = ReturnType<typeof createApi>
