/**
 * Shared contracts: API payloads and view models.
 *
 * This file is one of the three contracts frozen at hour 0-1 (with the
 * migration and the API table in ARCHITECTURE.md). Server routes validate
 * request bodies with these schemas; the UI and the simulator consume the
 * view types. Keep it dependency-free apart from zod.
 *
 * Extension fields (plan §17) are additive: every new view field is nullable
 * or defaulted, and fields added to types that tests build as literals are
 * optional, so an older client and the existing tests keep working.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const PHASES = ['pending', 'blind', 'snapshot', 'structured', 'open', 'resolved'] as const
export const PhaseSchema = z.enum(PHASES)
export type Phase = z.infer<typeof PhaseSchema>

/**
 * Question modes. `open` is a free-text question (plan §17.3): no number and
 * no price; the answers are clustered and sharpened into a proposition. Not
 * to be confused with the `open` *phase* — use `isOpenQuestion()` from
 * lib/phases/machine.ts rather than comparing the string.
 */
export const ModeSchema = z.enum(['stem', 'humanities', 'open'])
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
export const STEELMAN_MAX_CHARS = 200

// ---------------------------------------------------------------------------
// Feature flags (plan §17). Per session, all off by default.
// ---------------------------------------------------------------------------

/**
 * Parse `{}` to get the all-false object. Zod 4 note: a `.default()` on the
 * object itself would short-circuit the inner defaults, so there is none;
 * use `featuresOf()` from lib/features.ts for raw (jsonb) input.
 */
export const FeaturesSchema = z.object({
  considerOpposite: z.boolean().default(false),
  predictClass: z.boolean().default(false),
  steelman: z.boolean().default(false),
  socrates: z.boolean().default(false),
  contrarianCredit: z.boolean().default(false),
  argumentElo: z.boolean().default(false),
})
export type Features = z.infer<typeof FeaturesSchema>
export type FeatureKey = keyof Features
export const FEATURE_KEYS = Object.keys(FeaturesSchema.shape) as FeatureKey[]

/**
 * A partial update: only the keys present change. Deliberately not
 * `FeaturesSchema.partial()`, which in zod 4 still fills absent keys with
 * `false` and would reset every other flag on merge.
 */
export const FeaturesPatchBody = z.object({
  considerOpposite: z.boolean().optional(),
  predictClass: z.boolean().optional(),
  steelman: z.boolean().optional(),
  socrates: z.boolean().optional(),
  contrarianCredit: z.boolean().optional(),
  argumentElo: z.boolean().optional(),
})
export type FeaturesPatchBody = z.infer<typeof FeaturesPatchBody>

/** Returned by PATCH /api/sessions/:id/features: the merged flags. */
export const FeaturesResult = z.object({ ok: z.literal(true), features: FeaturesSchema })
export type FeaturesResult = z.infer<typeof FeaturesResult>

/** One phase boundary of a question, appended by every transition. */
export const PhaseLogEntry = z.object({ phase: PhaseSchema, at: z.string() })
export type PhaseLogEntry = z.infer<typeof PhaseLogEntry>

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
  /** Flags to switch on at creation; everything absent stays off. */
  features: FeaturesPatchBody.optional(),
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
    /** Cascade mode (plan §17.5): the live consensus is visible during the blind phase. */
    cascade: z.boolean().optional(),
    /** Open questions only: what a right answer says, so "wrong" is definable. */
    referenceAnswer: z.string().trim().max(300).optional(),
    /** The open question this proposition was sharpened from (plan §17.3). */
    sourceQuestionId: z.uuid().optional(),
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
  /** Predict the class (plan §17.2): what percent of the class will say TRUE. */
  predictedTruePct: PctSchema.optional(),
})
export type SubmitBody = z.infer<typeof SubmitBody>

export const ReviseBody = z.object({ participantId: z.uuid(), pct: PctSchema })
export type ReviseBody = z.infer<typeof ReviseBody>

/** Consider the opposite (plan §17.1): the second number, given the first is wrong. */
export const OpposeBody = z.object({
  participantId: z.uuid(),
  pct: PctSchema,
  reasoning: z.string().trim().max(REASONING_MAX_CHARS).optional(),
})
export type OpposeBody = z.infer<typeof OpposeBody>

/** Returned by POST /api/questions/:id/oppose: the blended blind number now on record. */
export const OpposeResult = z.object({ ok: z.literal(true), blindPct: z.number().int() })
export type OpposeResult = z.infer<typeof OpposeResult>

/** Open question (plan §17.3): a free-text answer. */
export const AnswerBody = z.object({
  participantId: z.uuid(),
  text: z.string().trim().min(1).max(REASONING_MAX_CHARS),
})
export type AnswerBody = z.infer<typeof AnswerBody>

/** Which side a student is asked to steelman: the side they lean against, or either at 50. */
export const SteelmanSideSchema = z.enum(['TRUE', 'FALSE', 'EITHER'])
export type SteelmanSide = z.infer<typeof SteelmanSideSchema>

export const SteelmanBody = z.object({
  participantId: z.uuid(),
  text: z.string().trim().min(1).max(STEELMAN_MAX_CHARS),
})
export type SteelmanBody = z.infer<typeof SteelmanBody>

/** Argument Elo (plan §17.9b): one pairwise comparison of two anonymous arguments. */
export const ArgumentVoteBody = z
  .object({
    participantId: z.uuid(),
    winnerSubmissionId: z.uuid(),
    loserSubmissionId: z.uuid(),
  })
  .refine((v) => v.winnerSubmissionId !== v.loserSubmissionId, {
    message: 'winner and loser must differ',
    path: ['loserSubmissionId'],
  })
export type ArgumentVoteBody = z.infer<typeof ArgumentVoteBody>

/** `counted` is false when this voter had already compared the pair (nothing was written). */
export const ArgumentVoteResult = z.object({ ok: z.literal(true), counted: z.boolean() })
export type ArgumentVoteResult = z.infer<typeof ArgumentVoteResult>

export const OkResult = z.object({ ok: z.literal(true) })
export type OkResult = z.infer<typeof OkResult>

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})
export type ApiError = z.infer<typeof ApiError>

// ---------------------------------------------------------------------------
// Agent results returned by routes (plan §17.3, §17.4, §17.7)
// ---------------------------------------------------------------------------

/** A generated proposition (from a topic, or sharpened from an open question's cluster). */
export const CandidateSchema = z.object({
  text: z.string(),
  correctAnswer: z.boolean(),
  misconception: z.string(),
  /** Index of the answer cluster it came from; null for topic generation. */
  sourceClusterIndex: z.number().int().nullable(),
})
export type Candidate = z.infer<typeof CandidateSchema>

export const CandidatesResult = z.object({
  ok: z.literal(true),
  fallback: z.boolean(),
  candidates: z.array(CandidateSchema),
})
export type CandidatesResult = z.infer<typeof CandidatesResult>

export const SocraticStatus = z.enum(['none', 'ready', 'skipped'])
export type SocraticStatus = z.infer<typeof SocraticStatus>

export const SocratesResult = z.object({
  ok: z.literal(true),
  skipped: z.boolean(),
  fallbackCount: z.number().int(),
  groups: z.array(z.object({ index: z.number().int(), questions: z.array(z.string()) })),
})
export type SocratesResult = z.infer<typeof SocratesResult>

export const SteelmanResult = z.object({
  /** Fidelity 0-100 in steps of 5; null when grading fell back (never rewards nor punishes). */
  score: z.number().nullable(),
  note: z.string(),
  fallback: z.boolean(),
})
export type SteelmanResult = z.infer<typeof SteelmanResult>

// ---------------------------------------------------------------------------
// Price history / replay (plan §17.6, §17.8). Never carries a name or id.
// ---------------------------------------------------------------------------

export const HistoryPoint = z.object({
  t: z.string(),
  pct: z.number(),
  phase: PhaseSchema,
  /** The mover's cluster label or anonymous reasoning; null on anchor points. */
  note: z.string().nullable(),
})
export type HistoryPoint = z.infer<typeof HistoryPoint>

export const QuestionHistory = z.object({
  questionId: z.uuid(),
  index: z.number().int(),
  proposition: z.string(),
  mode: ModeSchema,
  phase: PhaseSchema,
  outcome: z.boolean().nullable(),
  cascade: z.boolean(),
  blindPricePct: z.number().nullable(),
  postPricePct: z.number().nullable(),
  phaseLog: z.array(PhaseLogEntry),
  points: z.array(HistoryPoint),
})
export type QuestionHistory = z.infer<typeof QuestionHistory>

/** Two anonymous arguments for a pairwise comparison: opaque submission ids and texts only. */
export const ArgumentPair = z.object({
  a: z.object({ id: z.uuid(), text: z.string() }),
  b: z.object({ id: z.uuid(), text: z.string() }),
})
export type ArgumentPair = z.infer<typeof ArgumentPair>

// ---------------------------------------------------------------------------
// View models (everything a screen needs; visibility enforced server-side)
// ---------------------------------------------------------------------------

export const LeaderboardRow = z.object({
  name: z.string(),
  calibration: z.number().nullable(),
  persuasion: z.number().nullable(),
  /** Mean steelman fidelity (plan §17.7); third ranking key. Optional so literals stay short. */
  steelman: z.number().nullable().optional(),
  /** Mean contrarian credit (plan §17.9a); added to calibration for ranking, shown separately. */
  contrarian: z.number().nullable().optional(),
})
export type LeaderboardRow = z.infer<typeof LeaderboardRow>

export const StudentStatus = z.enum(['lobby', 'in-question', 'waiting-next-question', 'ended'])
export type StudentStatus = z.infer<typeof StudentStatus>

/** Which blind-entry screen the phone should show; decided server-side so a refresh restores it. */
export const BlindStepSchema = z.enum(['first', 'opposite', 'done'])
export type BlindStep = z.infer<typeof BlindStepSchema>

export const StudentView = z.object({
  session: z.object({ code: z.string(), title: z.string() }),
  /** The session's feature flags; the server always emits the full object. */
  features: FeaturesSchema,
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
      /** The number the engine reads (blended when a second number exists). */
      pct: z.number().int().nullable(),
      /** True once a blind number has been submitted. */
      submitted: z.boolean(),
      /** Consider the opposite (plan §17.1). */
      firstPct: z.number().int().nullable().default(null),
      oppositePct: z.number().int().nullable().default(null),
      oppositeReasoning: z.string().nullable().default(null),
      blindStep: BlindStepSchema.default('first'),
      /** Predict the class (plan §17.2). */
      predictedTruePct: z.number().int().nullable().default(null),
      /** Steelman gate (plan §17.7); null when the gate is not open for this student. */
      steelmanSide: SteelmanSideSchema.nullable().default(null),
      steelman: z
        .object({ text: z.string(), score: z.number().nullable(), note: z.string().nullable() })
        .nullable()
        .default(null),
    })
    .nullable(),
  group: z
    .object({
      members: z.array(z.object({ name: z.string() })),
      /** Display names in speaking order (least sure first). */
      turnOrder: z.array(z.string()),
      turnSeconds: z.number().int(),
      /** Socrates agent (plan §17.4): one question per speaker, own group only. */
      socratesQuestions: z.array(z.string()).nullable().default(null),
    })
    .nullable(),
  /** Visible only when the phase allows it (open, resolved, after reveal, or a cascade blind). */
  pricePct: z.number().nullable(),
  result: z
    .object({
      outcome: z.boolean().nullable(),
      calibrationFinal: z.number().nullable(),
      calibrationBlind: z.number().nullable(),
      persuasion: z.number().nullable(),
      leaderboardTop: z.array(LeaderboardRow),
      /** Surprisingly popular (plan §17.2). */
      surprisinglyPopular: z
        .object({
          answer: z.boolean().nullable(),
          actualTruePct: z.number().nullable(),
          predictedTruePct: z.number().nullable(),
          insight: z.boolean().nullable(),
        })
        .nullable()
        .default(null),
      steelman: z.number().nullable().default(null),
      contrarianBonus: z.number().nullable().default(null),
      /** Argument Elo (plan §17.9b): pairs still to compare, texts only. */
      argumentPairs: z.array(ArgumentPair).default([]),
      argumentVotesCast: z.number().int().default(0),
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
  /** Cascade mode (plan §17.5): the consensus was visible during blind. */
  cascade: z.boolean().default(false),
  /** Surprisingly popular answer (plan §17.2), once computed. */
  spAnswer: z.boolean().nullable().default(null),
  /** Open questions (plan §17.3). */
  referenceAnswer: z.string().nullable().default(null),
  clusterCount: z.number().int().nullable().default(null),
  /** Index of the open question this one was sharpened from. */
  sourceIndex: z.number().int().nullable().default(null),
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
    features: FeaturesSchema,
  }),
  serverTime: z.string(),
  participants: z.array(z.object({ id: z.uuid(), name: z.string(), joinedAt: z.string() })),
  questions: z.array(TeacherQuestionRow),
  /** Cascade demo (plan §17.5): the same proposition run blind and with the consensus visible. */
  cascadeComparison: z
    .object({
      proposition: z.string(),
      blindQuestionId: z.uuid(),
      cascadeQuestionId: z.uuid(),
      blindPricePct: z.number(),
      cascadePricePct: z.number().nullable(),
      gapPct: z.number().nullable(),
      blindRevealed: z.boolean(),
      reading: z.string().nullable(),
    })
    .nullable()
    .default(null),
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
      cascade: z.boolean().default(false),
      phaseLog: z.array(PhaseLogEntry).default([]),
      referenceAnswer: z.string().nullable().default(null),
      submissionCount: z.number().int(),
      participantCount: z.number().int(),
      blindPricePct: z.number().nullable(),
      blindRevealed: z.boolean(),
      /** Live price; null during blind (except for a cascade question). */
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
          socratesQuestions: z.array(z.string()).nullable().default(null),
        }),
      ),
      priceHistory: z.array(z.object({ t: z.string(), pct: z.number(), phase: PhaseSchema })),
      narration: z.string().nullable(),
      /** Consider the opposite (plan §17.1): percent of blind submitters with a second number. */
      consideredOpposite: z
        .object({ pct: z.number(), meanShiftPts: z.number().nullable() })
        .nullable()
        .default(null),
      /** Surprisingly popular (plan §17.2); distribution numbers null during blind. */
      surprisinglyPopular: z
        .object({
          actualTruePct: z.number().nullable(),
          predictedTruePct: z.number().nullable(),
          answer: z.boolean().nullable(),
          predictorPct: z.number().nullable(),
          insightPct: z.number().nullable(),
        })
        .nullable()
        .default(null),
      socraticStatus: SocraticStatus.default('none'),
      /** Steelman gate (plan §17.7): aggregates only. */
      steelman: z
        .object({ count: z.number().int(), total: z.number().int(), meanFidelity: z.number().nullable() })
        .nullable()
        .default(null),
      /** Argument Elo (plan §17.9b): top arguments by pairwise strength, never by tally. */
      topArguments: z
        .array(
          z.object({
            text: z.string(),
            strength: z.number(),
            winPct: z.number(),
            side: z.enum(['TRUE', 'FALSE']).nullable(),
            comparisons: z.number().int(),
          }),
        )
        .default([]),
      /** Percent of participants who compared at least one pair. */
      argumentVotersPct: z.number().nullable().default(null),
    })
    .nullable(),
  leaderboard: z.array(LeaderboardRow),
  realtime: z.object({ tickVersion: z.number() }),
})
export type TeacherView = z.infer<typeof TeacherView>
