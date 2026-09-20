/**
 * Shared contracts: API payloads and view models.
 *
 * This file is one of the three contracts frozen at hour 0-1 (with the
 * migration and the API table in ARCHITECTURE.md). Server routes validate
 * request bodies with these schemas; the UI and the simulator consume the
 * view types. Keep it dependency-free apart from zod.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const PHASES = ['pending', 'blind', 'snapshot', 'structured', 'open', 'resolved'] as const
export const PhaseSchema = z.enum(PHASES)
export type Phase = z.infer<typeof PhaseSchema>

export const ModeSchema = z.enum(['stem', 'humanities'])
export type Mode = z.infer<typeof ModeSchema>

export const StanceSchema = z.enum(['TRUE', 'FALSE', 'UNCLEAR'])
export type Stance = z.infer<typeof StanceSchema>

/** A belief as integer percent, 0-100, in steps of 5. */
export const PctSchema = z
  .number()
  .int()
  .min(0)
  .max(100)
  .refine((v) => v % 5 === 0, { message: 'must be a multiple of 5' })
export type Pct = number

export const REASONING_MAX_CHARS = 200

// ---------------------------------------------------------------------------
// API request bodies and results
// ---------------------------------------------------------------------------

export const TimersSchema = z.object({
  blindSeconds: z.number().int().min(5).max(600),
  turnSeconds: z.number().int().min(5).max(300),
  openSeconds: z.number().int().min(5).max(600),
})
export type Timers = z.infer<typeof TimersSchema>

export const CreateSessionBody = z.object({
  title: z.string().trim().min(1).max(80),
  budget: z.number().int().positive().optional(),
  k: z.number().positive().optional(),
  timers: TimersSchema.partial().optional(),
})
export type CreateSessionBody = z.infer<typeof CreateSessionBody>

export const CreateSessionResult = z.object({
  sessionId: z.uuid(),
  code: z.string(),
  teacherToken: z.string(),
})
export type CreateSessionResult = z.infer<typeof CreateSessionResult>

export const QuestionInput = z
  .object({
    proposition: z.string().trim().min(1).max(300),
    mode: ModeSchema.default('stem'),
    correctAnswer: z.boolean().optional(),
  })
  .refine((q) => q.mode !== 'stem' || typeof q.correctAnswer === 'boolean', {
    message: 'STEM questions need correctAnswer at creation',
    path: ['correctAnswer'],
  })
export type QuestionInput = z.infer<typeof QuestionInput>

export const AddQuestionsBody = z.object({ questions: z.array(QuestionInput).min(1).max(50) })
export type AddQuestionsBody = z.infer<typeof AddQuestionsBody>

export const AddQuestionsResult = z.object({
  questions: z.array(z.object({ id: z.uuid(), index: z.number().int() })),
})
export type AddQuestionsResult = z.infer<typeof AddQuestionsResult>

export const GenerateBody = z.object({ topic: z.string().trim().min(1).max(120) })
export type GenerateBody = z.infer<typeof GenerateBody>

export const JoinBody = z.object({
  code: z.string().trim().toUpperCase().length(6),
  displayName: z.string().trim().min(1).max(40),
})
export type JoinBody = z.infer<typeof JoinBody>

export const JoinResult = z.object({ sessionId: z.uuid(), participantId: z.uuid() })
export type JoinResult = z.infer<typeof JoinResult>

export const StartBody = z.object({ questionId: z.uuid() })
export type StartBody = z.infer<typeof StartBody>

export const AdvanceBody = z.object({
  from: PhaseSchema,
  correctAnswer: z.boolean().optional(),
})
export type AdvanceBody = z.infer<typeof AdvanceBody>

export const ProposeBody = z.object({
  participantId: z.uuid(),
  reasoning: z.string().trim().min(1).max(REASONING_MAX_CHARS),
})
export type ProposeBody = z.infer<typeof ProposeBody>

export const BandSchema = z.object({
  stance: StanceSchema,
  lo: z.number().int().min(0).max(100),
  hi: z.number().int().min(0).max(100),
  reading: z.string(),
})
export type Band = z.infer<typeof BandSchema>

export const ProposeResult = BandSchema.extend({ fallback: z.boolean() })
export type ProposeResult = z.infer<typeof ProposeResult>

export const SubmitBody = z.object({
  participantId: z.uuid(),
  pct: PctSchema,
  reasoning: z.string().trim().max(REASONING_MAX_CHARS).optional(),
})
export type SubmitBody = z.infer<typeof SubmitBody>

export const ReviseBody = z.object({ participantId: z.uuid(), pct: PctSchema })
export type ReviseBody = z.infer<typeof ReviseBody>

export const OkResult = z.object({ ok: z.literal(true) })

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})
export type ApiError = z.infer<typeof ApiError>

// ---------------------------------------------------------------------------
// View models (everything a screen needs; visibility enforced server-side)
// ---------------------------------------------------------------------------

export const LeaderboardRow = z.object({
  name: z.string(),
  calibration: z.number().nullable(),
  persuasion: z.number().nullable(),
})
export type LeaderboardRow = z.infer<typeof LeaderboardRow>

export const StudentStatus = z.enum(['lobby', 'in-question', 'waiting-next-question', 'ended'])
export type StudentStatus = z.infer<typeof StudentStatus>

export const StudentView = z.object({
  session: z.object({ code: z.string(), title: z.string() }),
  me: z.object({ participantId: z.uuid(), name: z.string() }),
  /** ISO timestamp from the server; clients derive a clock offset from it. */
  serverTime: z.string(),
  status: StudentStatus,
  phase: PhaseSchema.nullable(),
  phaseStartedAt: z.string().nullable(),
  phaseEndsAt: z.string().nullable(),
  question: z
    .object({
      id: z.uuid(),
      proposition: z.string(),
      mode: ModeSchema,
      index: z.number().int(),
      count: z.number().int(),
    })
    .nullable(),
  my: z
    .object({
      reasoning: z.string().nullable(),
      band: BandSchema.nullable(),
      pct: z.number().int().nullable(),
      /** True once a blind number has been submitted. */
      submitted: z.boolean(),
    })
    .nullable(),
  group: z
    .object({
      members: z.array(z.object({ name: z.string() })),
      /** Display names in speaking order (least sure first). */
      turnOrder: z.array(z.string()),
      turnSeconds: z.number().int(),
    })
    .nullable(),
  /** Visible only when the phase allows it (open, resolved, or after reveal). */
  pricePct: z.number().nullable(),
  result: z
    .object({
      outcome: z.boolean().nullable(),
      calibrationFinal: z.number().nullable(),
      calibrationBlind: z.number().nullable(),
      persuasion: z.number().nullable(),
      leaderboardTop: z.array(LeaderboardRow),
    })
    .nullable(),
})
export type StudentView = z.infer<typeof StudentView>

export const TeacherQuestionRow = z.object({
  id: z.uuid(),
  index: z.number().int(),
  proposition: z.string(),
  mode: ModeSchema,
  phase: PhaseSchema,
  correctAnswer: z.boolean().nullable(),
  blindPricePct: z.number().nullable(),
  postPricePct: z.number().nullable(),
  /** Post minus blind, signed; null until resolved. */
  movementPct: z.number().nullable(),
  /** Belief-map reading, e.g. "Shared misconception". */
  reading: z.string().nullable(),
})
export type TeacherQuestionRow = z.infer<typeof TeacherQuestionRow>

export const ClustersStatus = z.enum(['none', 'ready', 'skipped'])

export const TeacherView = z.object({
  session: z.object({
    id: z.uuid(),
    code: z.string(),
    title: z.string(),
    joinUrl: z.string(),
    budget: z.number().int(),
    k: z.number(),
    timers: TimersSchema,
    status: z.enum(['lobby', 'active', 'ended']),
  }),
  serverTime: z.string(),
  participants: z.array(z.object({ id: z.uuid(), name: z.string(), joinedAt: z.string() })),
  questions: z.array(TeacherQuestionRow),
  current: z
    .object({
      questionId: z.uuid(),
      index: z.number().int(),
      proposition: z.string(),
      mode: ModeSchema,
      correctAnswer: z.boolean().nullable(),
      phase: PhaseSchema,
      phaseStartedAt: z.string().nullable(),
      phaseEndsAt: z.string().nullable(),
      submissionCount: z.number().int(),
      participantCount: z.number().int(),
      blindPricePct: z.number().nullable(),
      blindRevealed: z.boolean(),
      /** Live price; null during blind. */
      pricePct: z.number().nullable(),
      /** Ten bins: 0-9, 10-19, ..., 90-100. */
      histogramBlind: z.array(z.number().int()).length(10),
      histogramCurrent: z.array(z.number().int()).length(10),
      clustersStatus: ClustersStatus,
      clusters: z.array(z.object({ index: z.number().int(), label: z.string(), count: z.number().int() })),
      groups: z.array(
        z.object({
          index: z.number().int(),
          members: z.array(z.object({ name: z.string(), blindPct: z.number().int().nullable() })),
          turnOrder: z.array(z.string()),
        }),
      ),
      priceHistory: z.array(z.object({ t: z.string(), pct: z.number() })),
      narration: z.string().nullable(),
    })
    .nullable(),
  leaderboard: z.array(LeaderboardRow),
  realtime: z.object({ tickVersion: z.number() }),
})
export type TeacherView = z.infer<typeof TeacherView>
