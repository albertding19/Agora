/**
 * Route-handler conventions: typed errors, zod body parsing, and a wrapper
 * that turns thrown errors into `{ error: { code, message } }` responses.
 */
import { NextResponse } from 'next/server'
import type { z } from 'zod'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status })
}

export function json<T>(body: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, init)
}

/** Parse and validate a JSON body; throws HttpError(400) with the zod issues. */
export async function parseBody<T extends z.ZodType>(schema: T, request: Request): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be JSON')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.map(String).join('.') || '(body)'}: ${i.message}`)
      .join('; ')
    throw new HttpError(400, 'invalid_body', detail)
  }
  return parsed.data
}

type Handler<A extends unknown[]> = (...args: A) => Promise<Response>

/** Wrap a route handler so HttpError → its status and anything else → 500 with a logged stack. */
export function withErrors<A extends unknown[]>(fn: Handler<A>): Handler<A> {
  return async (...args: A) => {
    try {
      return await fn(...args)
    } catch (err) {
      if (err instanceof HttpError) return jsonError(err.status, err.code, err.message)
      console.error('unhandled route error', err)
      return jsonError(500, 'internal', 'Something went wrong')
    }
  }
}

export function plusSeconds(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString()
}
