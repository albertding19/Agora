/**
 * localStorage helpers. Keys are scoped per session so phones that joined a
 * rehearsal session do not carry a stale participant id into the demo.
 *
 *   agora:p:<CODE>       → { sessionId, participantId }   (student)
 *   agora:t:<sessionId>  → teacher token                  (teacher)
 *   agora:t:last         → last session id created here  (teacher)
 */
import { useSyncExternalStore } from 'react'

const studentKey = (code: string) => `agora:p:${code.toUpperCase()}`
const teacherKey = (sessionId: string) => `agora:t:${sessionId}`
const LAST_TEACHER_SESSION = 'agora:t:last'

const listeners = new Set<() => void>()

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: the page still works for this tab.
  }
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

export interface StudentIdentity {
  sessionId: string
  participantId: string
}

export function getStudentIdentity(code: string): StudentIdentity | null {
  const raw = read(studentKey(code))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StudentIdentity>
    if (typeof parsed.sessionId === 'string' && typeof parsed.participantId === 'string') {
      return { sessionId: parsed.sessionId, participantId: parsed.participantId }
    }
  } catch {
    // fall through
  }
  return null
}

export function setStudentIdentity(code: string, identity: StudentIdentity): void {
  write(studentKey(code), JSON.stringify(identity))
}

export function getTeacherToken(sessionId: string): string | null {
  return read(teacherKey(sessionId))
}

export function setTeacherToken(sessionId: string, token: string): void {
  write(teacherKey(sessionId), token)
  write(LAST_TEACHER_SESSION, sessionId)
}

export function getLastTeacherSession(): string | null {
  return read(LAST_TEACHER_SESSION)
}

/** Reactive read of a raw key; null during server rendering and hydration. */
export function useStoredValue(key: string): string | null {
  return useSyncExternalStore(subscribe, () => read(key), () => null)
}

export function useStudentIdentity(code: string): StudentIdentity | null {
  const raw = useStoredValue(studentKey(code))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StudentIdentity>
    if (typeof parsed.sessionId === 'string' && typeof parsed.participantId === 'string') {
      return { sessionId: parsed.sessionId, participantId: parsed.participantId }
    }
  } catch {
    // fall through
  }
  return null
}

export function useTeacherToken(sessionId: string): string | null {
  return useStoredValue(teacherKey(sessionId))
}

/** False during SSR and hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
}
