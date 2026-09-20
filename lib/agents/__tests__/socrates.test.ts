import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BANNED_WORDS, LANGUAGE_RULE, findBannedWord } from '@/lib/language'
import { PROMPT_TAIL } from '../run'
import {
  CONFIDENT_FALLBACK_QUESTION,
  FALLBACK_QUESTIONS,
  MAX_SENTENCES_PER_TURN,
  QUESTION_MAX_CHARS,
  mostConfidentIndex,
  normalizeSocrates,
  slotFallback,
  socratesSpec,
  splitSentences,
  type SocratesInput,
} from '../socrates'

function input(n = 3): SocratesInput {
  return {
    proposition: 'p',
    speakers: Array.from({ length: n }, (_, i) => ({ turn: i + 1, leanPct: 50 + 10 * i, reasoning: `reason ${i}` })),
  }
}

/** Three clean slots, so a test can perturb one and the response still survives. */
const CLEAN = ['Why do you say that?', 'What would change your mind?', 'Which step are you least sure of?']

describe('normalizeSocrates', () => {
  it('keeps only interrogative sentences', () => {
    const out = normalizeSocrates(
      { questions: ['You sound sure. Why is it obvious to you? I see.', CLEAN[1], CLEAN[2]] },
      input(),
    )!
    expect(out.questions[0]).toBe('Why is it obvious to you?')
  })

  it('caps a slot at two sentences', () => {
    const out = normalizeSocrates({ questions: ['A? B? C?', CLEAN[1], CLEAN[2]] }, input())!
    expect(out.questions[0]).toBe('A? B?')
    expect(splitSentences(out.questions[0])).toHaveLength(MAX_SENTENCES_PER_TURN)
  })

  it('strips a "Speaker 2:" prefix', () => {
    const out = normalizeSocrates({ questions: [CLEAN[0], 'Speaker 2: Why so sure?', CLEAN[2]] }, input())!
    expect(out.questions[1]).toBe('Why so sure?')
  })

  it('drops a sentence that contains a percentage', () => {
    const out = normalizeSocrates({ questions: ['You wrote 80%, why? What else could explain it?', CLEAN[1], CLEAN[2]] }, input())!
    expect(out.questions[0]).toBe('What else could explain it?')
    const alone = normalizeSocrates({ questions: ['Why 80 percent?', CLEAN[1], CLEAN[2]] }, input())!
    expect(alone.questions[0]).toBe(slotFallback(0, 3))
  })

  it('replaces a question that breaks the language rule with the slot fallback', () => {
    const out = normalizeSocrates({ questions: [`Would you ${BANNED_WORDS[0]} on it?`, CLEAN[1], CLEAN[2]] }, input())!
    expect(out.questions[0]).toBe(slotFallback(0, 3))
    expect(out.questions[1]).toBe(CLEAN[1])
  })

  it('keeps only the first sentence when two together exceed the length cap', () => {
    const first = `Why ${'x'.repeat(150)}?`
    const second = `How ${'y'.repeat(150)}?`
    const out = normalizeSocrates({ questions: [`${first} ${second}`, CLEAN[1], CLEAN[2]] }, input())!
    expect(out.questions[0]).toBe(first)
    expect(out.questions[0].length).toBeLessThanOrEqual(QUESTION_MAX_CHARS)
  })

  it('pads a short array to speakers.length with slot fallbacks', () => {
    const out = normalizeSocrates({ questions: ['Why?'] }, input(3))!
    expect(out.questions).toHaveLength(3)
    expect(out.questions[0]).toBe('Why?')
    expect(out.questions[1]).toBe(slotFallback(1, 3))
    expect(out.questions[2]).toBe(slotFallback(2, 3))
  })

  it('ignores extra slots beyond speakers.length', () => {
    const out = normalizeSocrates({ questions: [...CLEAN, 'Extra?'] }, input(3))!
    expect(out.questions).toHaveLength(3)
  })

  it('returns null when nothing survives or the shape is unusable', () => {
    expect(normalizeSocrates({ questions: ['A statement.', '', 'Another statement!'] }, input())).toBeNull()
    expect(normalizeSocrates({ questions: [] }, input())).toBeNull()
    expect(normalizeSocrates({ questions: 'Why?' }, input())).toBeNull()
    expect(normalizeSocrates(null, input())).toBeNull()
  })
})

describe('slotFallback', () => {
  it('uses the confident question for the last slot and the generic list elsewhere', () => {
    expect(slotFallback(2, 3)).toBe(CONFIDENT_FALLBACK_QUESTION)
    expect(slotFallback(0, 3)).toBe(FALLBACK_QUESTIONS[0])
    expect(slotFallback(1, 3)).toBe(FALLBACK_QUESTIONS[1])
    expect(slotFallback(5, 7)).toBe(FALLBACK_QUESTIONS[0])
    expect(slotFallback(0, 1)).toBe(CONFIDENT_FALLBACK_QUESTION)
  })

  it('the spec fallback is one slot fallback per speaker and ends with the confident question', () => {
    const fb = socratesSpec.fallback(input(4))
    expect(fb.questions).toHaveLength(4)
    expect(fb.questions[3]).toBe(CONFIDENT_FALLBACK_QUESTION)
    expect(fb.questions.slice(0, 3)).toEqual(FALLBACK_QUESTIONS.slice(0, 3))
    for (const q of fb.questions) {
      expect(q.endsWith('?')).toBe(true)
      expect(findBannedWord(q)).toBeNull()
    }
  })
})

describe('splitSentences', () => {
  it('splits on terminal punctuation followed by whitespace', () => {
    expect(splitSentences('A? B. C?')).toHaveLength(3)
    expect(splitSentences('A? B. C?')).toEqual(['A?', 'B.', 'C?'])
  })

  it('does not split on a decimal point', () => {
    expect(splitSentences('Does 1.10 minus 1.00 leave the bat a dollar more?')).toHaveLength(1)
  })
})

describe('mostConfidentIndex', () => {
  it('picks the lean farthest from 50, later turn on ties, never a null lean', () => {
    const s = (leans: (number | null)[]) => leans.map((leanPct, i) => ({ turn: i + 1, leanPct, reasoning: null }))
    expect(mostConfidentIndex(s([45, 70, 20]))).toBe(2)
    expect(mostConfidentIndex(s([55, 15, null]))).toBe(1)
    expect(mostConfidentIndex(s([50, 20, 80]))).toBe(2)
    expect(mostConfidentIndex(s([null, null]))).toBeNull()
  })
})

describe('socratesSpec', () => {
  it('carries the language rule and the prompt tail', () => {
    expect(socratesSpec.system).toContain(LANGUAGE_RULE)
    expect(socratesSpec.system).toContain(PROMPT_TAIL)
    expect(socratesSpec.name).toBe('socrates')
  })

  it('names the most confident speaker in the user message without any percentage', () => {
    const msg = socratesSpec.userMessage({
      proposition: 'p',
      speakers: [
        { turn: 1, leanPct: 40, reasoning: 'Not sure.' },
        { turn: 2, leanPct: 95, reasoning: 'Obviously.' },
      ],
    })
    expect(msg).toContain('Most confident speaker: turn 2')
    expect(msg).not.toMatch(/\d+\s*%/)
    expect(msg).toContain('"Obviously."')
  })
})

describe('socrates.cases.json', () => {
  interface Case {
    name: string
    input: SocratesInput
    expect: { targets?: { index: number; regex: string }[]; noAnswerLeak?: string }
  }
  const text = readFileSync(new URL('./socrates.cases.json', import.meta.url), 'utf8')
  const cases = JSON.parse(text) as Case[]

  it('parses into ten well-formed cases', () => {
    expect(cases).toHaveLength(10)
    for (const c of cases) {
      expect(typeof c.name).toBe('string')
      expect(typeof c.input.proposition).toBe('string')
      expect(c.input.speakers.length).toBeGreaterThanOrEqual(3)
      for (const s of c.input.speakers) {
        expect(Number.isInteger(s.turn)).toBe(true)
        expect(s.leanPct === null || (s.leanPct >= 0 && s.leanPct <= 100)).toBe(true)
        expect(s.reasoning === null || typeof s.reasoning === 'string').toBe(true)
      }
    }
  })

  it('contains no banned words', () => {
    expect(findBannedWord(text)).toBeNull()
  })

  it('every target compiles and points at the most confident speaker', () => {
    for (const c of cases) {
      for (const t of c.expect.targets ?? []) {
        expect(() => new RegExp(t.regex)).not.toThrow()
        expect(t.index).toBeGreaterThanOrEqual(0)
        expect(t.index).toBeLessThan(c.input.speakers.length)
        expect(t.index).toBe(mostConfidentIndex(c.input.speakers))
      }
      if (c.expect.noAnswerLeak) expect(() => new RegExp(c.expect.noAnswerLeak!)).not.toThrow()
    }
  })
})

describe('normalizeSocrates review regressions', () => {
  const one = (slot: string) => normalizeSocrates({ questions: [slot, CLEAN[1], CLEAN[2]] }, input())!.questions[0]

  it('strips a "Speaker N" label whatever follows it (comma, plain space, quotes after the label)', () => {
    expect(one('Speaker 2, why so sure?')).toBe('why so sure?')
    expect(one('Speaker 2 why so sure?')).toBe('why so sure?')
    expect(one('Speaker 2: "Why so sure?"')).toBe('Why so sure?')
    expect(one('"Speaker 2: Why so sure?"')).toBe('Why so sure?')
    expect(one('Speaker 2:')).toBe(slotFallback(0, 3))
    for (const q of [one('Speaker 2, why so sure?'), one('Speaker 2 why so sure?')]) expect(q).not.toMatch(/^speaker\s*\d/i)
  })

  it('does not split after a lowercase abbreviation or a title, but does after a bare capital', () => {
    expect(splitSentences('A? B. C?')).toEqual(['A?', 'B.', 'C?'])
    expect(splitSentences('What about e.g. the feather?')).toEqual(['What about e.g. the feather?'])
    expect(splitSentences('What would Mr. Newton say?')).toEqual(['What would Mr. Newton say?'])
    expect(splitSentences('Feathers, stones, etc. What then?')).toEqual(['Feathers, stones, etc. What then?'])
    expect(splitSentences('Think of atoms. What then?')).toEqual(['Think of atoms.', 'What then?'])
    expect(one('What about e.g. the feather?')).toBe('What about e.g. the feather?')
  })

  it('splits a question mark glued to the next capitalised sentence', () => {
    expect(splitSentences('Why?What?')).toEqual(['Why?', 'What?'])
    expect(one('Why?What?')).toBe('Why? What?')
  })

  it('moves a question mark tucked inside a closing quote or bracket outside it', () => {
    expect(one('Why "obviously?"')).toBe('Why "obviously"?')
    expect(one('Why “obviously?” What else?')).toBe('Why “obviously”? What else?')
    expect(one('Is it so (really?) What then?')).toBe('Is it so (really)? What then?')
  })

  it('unwraps quoted sentences without leaving a dangling quote', () => {
    expect(one('"Why?" "What?"')).toBe('Why? What?')
    expect(one('"Why? What?"')).toBe('Why? What?')
    expect(one('Why do you say "obviously" here? What is "left"?')).toBe('Why do you say "obviously" here? What is "left"?')
  })

  it('treats "per cent" like a percentage', () => {
    expect(one('Is 80 per cent right? What else?')).toBe('What else?')
    expect(one('Is 80 percent right?')).toBe(slotFallback(0, 3))
  })

  it('re-normalizing its own output is a no-op and the fallback passes its own rules', () => {
    const a = normalizeSocrates({ questions: ['Why "x?" What?', 'Speaker 2, ok?', 'e.g. why?'] }, input())!
    expect(normalizeSocrates(a, input())).toEqual(a)
    const fb = socratesSpec.fallback(input(5))
    expect(normalizeSocrates(fb, input(5))).toEqual(fb)
  })

  it('slotFallback never returns undefined for a bad index or size', () => {
    expect(slotFallback(NaN, 3)).toBe(FALLBACK_QUESTIONS[0])
    expect(slotFallback(-1, 3)).toBe(FALLBACK_QUESTIONS[0])
    expect(slotFallback(0, NaN)).toBe(FALLBACK_QUESTIONS[0])
    expect(slotFallback(4, 0)).toBe(FALLBACK_QUESTIONS[4])
    expect(slotFallback(7, 8)).toBe(CONFIDENT_FALLBACK_QUESTION)
  })

  it('returns null, never throws, on garbage raw output', () => {
    for (const raw of [undefined, 42, [], { candidates: 'x' }, { questions: [null] }, { questions: [42, 'Why?'] }, { questions: {} }]) {
      expect(normalizeSocrates(raw, input())).toBeNull()
    }
  })

  it('the prompt bans numbers and percentages but not asking what makes someone sure', () => {
    expect(socratesSpec.system).not.toContain('Never mention how sure anyone is')
    expect(socratesSpec.system).toContain('never write a percentage')
    expect(socratesSpec.system).toContain('treat them as material to question')
  })
})

describe('socrates.cases.json leak regexes', () => {
  interface Case {
    name: string
    input: SocratesInput
    expect: { noAnswerLeak?: string }
  }
  const cases = JSON.parse(readFileSync(new URL('./socrates.cases.json', import.meta.url), 'utf8')) as Case[]

  it('no speaker reason or proposition trips its own case\'s leak regex, so quoting a reason is safe', () => {
    for (const c of cases) {
      if (!c.expect.noAnswerLeak) continue
      const re = new RegExp(c.expect.noAnswerLeak, 'i')
      expect(re.test(c.input.proposition)).toBe(false)
      for (const s of c.input.speakers) if (s.reasoning) expect(re.test(s.reasoning)).toBe(false)
    }
  })

  it('the bat-and-ball leak regex catches the answer but not a nearby wrong number', () => {
    const re = new RegExp(cases[0].expect.noAnswerLeak!, 'i')
    for (const leak of ['What if it were 5 cents?', 'Is the bat $1.05?', 'Is it $0.05?', 'Five cents?']) expect(re.test(leak)).toBe(true)
    for (const ok of ['Could the ball be 15 cents?', 'Why 1.10 minus 1.00?', 'Is it 10.05?']) expect(re.test(ok)).toBe(false)
  })
})
