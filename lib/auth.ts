/**
 * Identity checks. There are no accounts (hackmit-plan.md §2): the teacher
 * holds `sessions.teacher_token`, a student holds their `participants.id`.
 *
 * Teacher token: header `x-teacher-token`, or `?token=` on the URL as a
 * fallback (used by the projector tab's view fetch).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError } from '@/lib/http'
import { getParticipant, getQuestion, getSession } from '@/lib/db/queries'
import type { ParticipantRow, QuestionRow, SessionRow } from '@/lib/db/types'

export const TEACHER_TOKEN_HEADER = 'x-teacher-token'

export function teacherTokenFrom(request: Request): string | null {
  const header = request.headers.get(TEACHER_TOKEN_HEADER)
  if (header && header.trim()) return header.trim()
  const fromQuery = new URL(request.url).searchParams.get('token')
  return fromQuery && fromQuery.trim() ? fromQuery.trim() : null
}

export async function requireSession(client: SupabaseClient, sessionId: string): Promise<SessionRow> {
  const session = await getSession(client, sessionId)
  if (!session) throw new HttpError(404, 'session_not_found', 'No such session')
  return session
}

export async function requireTeacher(
  client: SupabaseClient,
  sessionId: string,
  request: Request,
): Promise<SessionRow> {
  const session = await requireSession(client, sessionId)
  assertTeacher(session, request)
  return session
}

export function assertTeacher(session: SessionRow, request: Request): void {
  const token = teacherTokenFrom(request)
  if (!token || token !== session.teacher_token) {
    throw new HttpError(401, 'unauthorized', 'Teacher token missing or wrong')
  }
}

export async function requireParticipant(
  client: SupabaseClient,
  sessionId: string,
  participantId: string,
): Promise<ParticipantRow> {
  const participant = await getParticipant(client, participantId)
  if (!participant || participant.session_id !== sessionId) {
    throw new HttpError(404, 'participant_not_found', 'Participant is not in this session')
  }
  return participant
}

export interface QuestionContext {
  question: QuestionRow
  session: SessionRow
}

/** Load a question and its session; 404 if either is missing. */
export async function requireQuestion(client: SupabaseClient, questionId: string): Promise<QuestionContext> {
  const question = await getQuestion(client, questionId)
  if (!question) throw new HttpError(404, 'question_not_found', 'No such question')
  const session = await requireSession(client, question.session_id)
  return { question, session }
}
