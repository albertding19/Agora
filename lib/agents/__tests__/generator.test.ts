import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BANNED_WORDS, findBannedWord } from '@/lib/language'
import type { Candidate } from '@/lib/types'
import { OTHER_LABEL } from '../clusterer'
import {
  CANNED_TOPIC_LIST,
  DEFAULT_MISCONCEPTION,
  FALLBACK_MISCONCEPTION,
  MAX_CLUSTER_CANDIDATES,
  MAX_TOPIC_CANDIDATES,
  MISCONCEPTION_MAX_CHARS,
  PROPOSITION_MAX_CHARS,
  generatorFallback,
  generatorSpec,
  isInterrogative,
  normalizeGenerator,
  type GeneratorInput,
} from '../generator'

const topicInput: GeneratorInput = { kind: 'topic', topic: 'Newtonian mechanics' }

const clusterInput: GeneratorInput = {
  kind: 'cluster',
  question: 'What causes the seasons?',
  referenceAnswer: 'The tilt of the axis.',
  clusters: [
    { label: 'Closer to the sun in summer', count: 12, samples: ['closer in summer'] },
    { label: 'The tilt of the axis', count: 7, samples: ['tilt'] },
    { label: "The moon's pull", count: 3, samples: ['moon'] },
    { label: OTHER_LABEL, count: 2, samples: ['not sure'] },
  ],
}

interface RawCandidate {
  text: string
  correctAnswer: 'TRUE' | 'FALSE'
  misconception: string
  sourceClusterIndex: number
}

function rawOf(text: string, extra: Partial<RawCandidate> = {}): RawCandidate {
  return { text, correctAnswer: 'FALSE', misconception: 'A slip.', sourceClusterIndex: -1, ...extra }
}

/** Re-encode a normalized candidate the way the model would emit it. */
function toRaw(c: Candidate): RawCandidate {
  return {
    text: c.text,
    correctAnswer: c.correctAnswer ? 'TRUE' : 'FALSE',
    misconception: c.misconception,
    sourceClusterIndex: c.sourceClusterIndex ?? -1,
  }
}

describe('isInterrogative', () => {
  it('flags texts ending in a question mark, even inside a closing quote', () => {
    expect(isInterrogative('Does the ball cost 10 cents?')).toBe(true)
    expect(isInterrogative('"The ball costs 10 cents?"')).toBe(true)
  })

  it('flags interrogative openers without a question mark', () => {
    for (const t of [
      'What causes the seasons',
      'Why do heavier objects fall faster',
      'To what extent is Hamlet mad',
      'Is 0.999 equal to 1.',
      'How does a plant gain mass.',
      '"Are the seasons caused by distance."',
    ]) {
      expect(isInterrogative(t), t).toBe(true)
    }
  })

  it('sees through curly quotes and a trailing "!" after the question mark', () => {
    for (const t of ['“Is the ball 10 cents.”', '‘Does it cost 10 cents?’', 'The ball costs 10 cents?!', '«Why is it 5 cents»']) {
      expect(isInterrogative(t), t).toBe(true)
    }
    expect(isInterrogative('“The ball costs 10 cents.”')).toBe(false)
  })

  it('accepts declarative claims, including ones that merely contain those words', () => {
    for (const t of [
      'The seasons are caused by the distance to the Sun.',
      'Whatever its mass, an object in a vacuum falls at the same rate.',
      'Isotopes of an element have the same number of protons.',
      'However fast it goes, a heavier object does not fall faster.',
      'When water freezes it expands.',
    ]) {
      expect(isInterrogative(t), t).toBe(false)
    }
  })
})

describe('normalizeGenerator', () => {
  it('drops a question-form text and keeps the declarative one', () => {
    const out = normalizeGenerator(
      {
        candidates: [
          rawOf('Is the ball 10 cents?'),
          rawOf('What causes the seasons'),
          rawOf('The ball costs 10 cents.'),
        ],
      },
      topicInput,
    )!
    expect(out.candidates.map((c) => c.text)).toEqual(['The ball costs 10 cents.'])
  })

  it('appends a period and turns an exclamation mark into one', () => {
    const out = normalizeGenerator(
      { candidates: [rawOf('  The   ball costs 10 cents '), rawOf('Heavier objects fall faster!')] },
      topicInput,
    )!
    expect(out.candidates.map((c) => c.text)).toEqual(['The ball costs 10 cents.', 'Heavier objects fall faster.'])
  })

  it('moves a period sitting inside a closing quote to the end', () => {
    const out = normalizeGenerator({ candidates: [rawOf('The answer is "10 cents."')] }, topicInput)!
    expect(out.candidates[0].text).toBe('The answer is "10 cents".')
  })

  it('drops a text containing a banned word, and one whose misconception does', () => {
    const out = normalizeGenerator(
      {
        candidates: [
          rawOf(`Students would ${BANNED_WORDS[3]} on the ball costing 10 cents.`),
          rawOf('The ball costs 10 cents.', { misconception: `A ${BANNED_WORDS[3]} on subtraction.` }),
          rawOf('The ball costs 5 cents.'),
        ],
      },
      topicInput,
    )!
    expect(out.candidates.map((c) => c.text)).toEqual(['The ball costs 5 cents.'])
  })

  it('drops texts shorter than 10 or longer than 300 characters without cutting them', () => {
    const long = `The ball costs ${'very '.repeat(70)}little.`
    expect(long.length).toBeGreaterThan(PROPOSITION_MAX_CHARS)
    const out = normalizeGenerator(
      { candidates: [rawOf('Short.'), rawOf(long), rawOf('The ball costs 5 cents.')] },
      topicInput,
    )!
    expect(out.candidates.map((c) => c.text)).toEqual(['The ball costs 5 cents.'])
  })

  it('dedupes on lowercase text, first wins', () => {
    const out = normalizeGenerator(
      {
        candidates: [
          rawOf('The ball costs 10 cents.', { correctAnswer: 'FALSE' }),
          rawOf('the ball costs 10 CENTS', { correctAnswer: 'TRUE' }),
        ],
      },
      topicInput,
    )!
    expect(out.candidates).toHaveLength(1)
    expect(out.candidates[0].correctAnswer).toBe(false)
  })

  it('maps correctAnswer TRUE/FALSE to booleans', () => {
    const out = normalizeGenerator(
      {
        candidates: [
          rawOf('0.999 repeating is equal to 1.', { correctAnswer: 'TRUE' }),
          rawOf('The ball costs 10 cents.', { correctAnswer: 'FALSE' }),
        ],
      },
      topicInput,
    )!
    expect(out.candidates.map((c) => c.correctAnswer)).toEqual([true, false])
  })

  it('trims the misconception to 200 characters and defaults an empty one', () => {
    const out = normalizeGenerator(
      {
        candidates: [
          rawOf('The ball costs 10 cents.', { misconception: 'x'.repeat(400) }),
          rawOf('The ball costs 5 cents.', { misconception: '   ' }),
        ],
      },
      topicInput,
    )!
    expect(out.candidates[0].misconception.length).toBe(MISCONCEPTION_MAX_CHARS)
    expect(out.candidates[1].misconception).toBe(DEFAULT_MISCONCEPTION)
  })

  it('maps sourceClusterIndex -1 (or anything) to null for the topic kind', () => {
    const out = normalizeGenerator(
      {
        candidates: [
          rawOf('The ball costs 10 cents.', { sourceClusterIndex: -1 }),
          rawOf('The ball costs 5 cents.', { sourceClusterIndex: 2 }),
        ],
      },
      topicInput,
    )!
    expect(out.candidates.map((c) => c.sourceClusterIndex)).toEqual([null, null])
  })

  it('keeps a valid cluster index and nulls an unknown one for the cluster kind', () => {
    const out = normalizeGenerator(
      {
        candidates: [
          rawOf('The Earth is closer to the Sun in summer.', { sourceClusterIndex: 0 }),
          rawOf('The Moon causes the seasons.', { sourceClusterIndex: 9 }),
          rawOf('The seasons come from the tilt.', { sourceClusterIndex: 1.5 }),
        ],
      },
      clusterInput,
    )!
    expect(out.candidates.map((c) => c.sourceClusterIndex)).toEqual([0, null, null])
  })

  it('stable-sorts cluster candidates by source cluster count, unknown last', () => {
    const out = normalizeGenerator(
      {
        candidates: [
          rawOf('The Moon causes the seasons.', { sourceClusterIndex: 9 }),
          rawOf('The Moon pulls the seasons around.', { sourceClusterIndex: 2 }),
          rawOf('The Earth is closer to the Sun in summer.', { sourceClusterIndex: 0 }),
          rawOf('The Earth is nearer the Sun in July.', { sourceClusterIndex: 0 }),
        ],
      },
      clusterInput,
    )!
    expect(out.candidates.map((c) => c.sourceClusterIndex)).toEqual([0, 0, 2])
    expect(out.candidates[0].text).toBe('The Earth is closer to the Sun in summer.')
    expect(out.candidates[1].text).toBe('The Earth is nearer the Sun in July.')
  })

  it('puts stated misconceptions (FALSE) before correct-belief propositions, then larger clusters first', () => {
    const out = normalizeGenerator(
      {
        candidates: [
          rawOf('The tilt of the axis causes the seasons.', { sourceClusterIndex: 1, correctAnswer: 'TRUE' }),
          rawOf('The Moon pulls the seasons around.', { sourceClusterIndex: 2, correctAnswer: 'FALSE' }),
          rawOf('The Earth is closer to the Sun in summer.', { sourceClusterIndex: 0, correctAnswer: 'FALSE' }),
        ],
      },
      clusterInput,
    )!
    expect(out.candidates.map((c) => c.sourceClusterIndex)).toEqual([0, 2, 1])
    expect(out.candidates.map((c) => c.correctAnswer)).toEqual([false, false, true])
  })

  it('caps topic output at 5 and cluster output at 3', () => {
    const many = Array.from({ length: 8 }, (_, i) => rawOf(`Claim number ${i} about the topic.`, { sourceClusterIndex: 0 }))
    expect(normalizeGenerator({ candidates: many }, topicInput)!.candidates).toHaveLength(MAX_TOPIC_CANDIDATES)
    expect(normalizeGenerator({ candidates: many }, clusterInput)!.candidates).toHaveLength(MAX_CLUSTER_CANDIDATES)
  })

  it('drops only a trailing exclamation mark, keeping a mid-text one such as a factorial', () => {
    const out = normalizeGenerator(
      { candidates: [rawOf('The factorial 5! equals 120.'), rawOf('The ball costs 10 cents!”')] },
      topicInput,
    )!
    expect(out.candidates.map((c) => c.text)).toEqual(['The factorial 5! equals 120.', 'The ball costs 10 cents”.'])
  })

  it('handles curly quotes: moves the period outside and drops a quoted or "?!" question', () => {
    const out = normalizeGenerator(
      {
        candidates: [
          rawOf('The answer is “10 cents.”'),
          rawOf('“Is the ball 10 cents.”'),
          rawOf('The ball costs 10 cents?!'),
          rawOf('The answer is ‘10 cents.’'),
        ],
      },
      topicInput,
    )!
    expect(out.candidates.map((c) => c.text)).toEqual(['The answer is “10 cents”.', 'The answer is ‘10 cents’.'])
  })

  it('removes a dangling comma and a space before the final period', () => {
    const out = normalizeGenerator(
      {
        candidates: [
          rawOf('The ball costs 10 cents,'),
          rawOf('The ball costs 5 cents,.'),
          rawOf('The ball costs 4 cents ."'),
          rawOf('The ball costs 3 cents ;'),
        ],
      },
      topicInput,
    )!
    expect(out.candidates.map((c) => c.text)).toEqual([
      'The ball costs 10 cents.',
      'The ball costs 5 cents.',
      'The ball costs 4 cents".',
      'The ball costs 3 cents.',
    ])
  })

  it('trims and collapses unicode whitespace', () => {
    const out = normalizeGenerator(
      { candidates: [rawOf('\u00A0The\u2003ball\u00A0costs\u2009 10 cents\uFEFF')] },
      topicInput,
    )!
    expect(out.candidates[0].text).toBe('The ball costs 10 cents.')
  })

  it('keeps exactly 300 and exactly 10 characters, drops 301 and 9', () => {
    const at300 = `The ball costs ${'x'.repeat(284)}`
    expect(at300.length + 1).toBe(PROPOSITION_MAX_CHARS)
    const out = normalizeGenerator(
      { candidates: [rawOf(at300), rawOf('x'.repeat(300)), rawOf('Ball is 5'), rawOf('Ball is.')] },
      topicInput,
    )!
    expect(out.candidates.map((c) => c.text.length)).toEqual([PROPOSITION_MAX_CHARS, 10])
  })

  it('every kept text satisfies the eval checker invariants', () => {
    const bag = [
      'The factorial 5! equals 120.',
      'The answer is “10 cents.”',
      'The ball costs 10 cents,',
      'The ball costs 10 cents…',
      'The ball costs 10 cents ."',
      'The ball costs 10 cents..',
      '(The ball costs 10 cents.)',
      'Whichever way you look at it, the ball costs 5 cents.',
      'Isotopes of an element have the same number of protons.',
    ]
    for (const t of bag) {
      const out = normalizeGenerator({ candidates: [rawOf(t)] }, topicInput)
      expect(out, t).not.toBeNull()
      const c = out!.candidates[0]
      expect(c.text.endsWith('.'), c.text).toBe(true)
      expect(c.text.length).toBeLessThanOrEqual(PROPOSITION_MAX_CHARS)
      expect(isInterrogative(c.text), c.text).toBe(false)
      expect(findBannedWord(c.text)).toBeNull()
      expect(findBannedWord(c.misconception)).toBeNull()
    }
  })

  it('is deterministic and never mutates its input', () => {
    const raw = {
      candidates: [
        rawOf('The Moon causes the seasons.', { sourceClusterIndex: 2 }),
        rawOf('The Earth is closer to the Sun in summer.', { sourceClusterIndex: 0 }),
        rawOf('the earth is closer to the sun in summer', { sourceClusterIndex: 1 }),
      ],
    }
    const rawBefore = JSON.stringify(raw)
    const inputBefore = JSON.stringify(clusterInput)
    const a = normalizeGenerator(raw, clusterInput)
    const b = normalizeGenerator(raw, clusterInput)
    expect(a).toEqual(b)
    expect(a!.candidates.map((c) => c.sourceClusterIndex)).toEqual([0, 2])
    expect(JSON.stringify(raw)).toBe(rawBefore)
    expect(JSON.stringify(clusterInput)).toBe(inputBefore)
  })

  it('never throws on garbage shapes, returning null', () => {
    const garbage: unknown[] = [
      undefined,
      42,
      'candidates',
      {},
      [],
      { candidates: 'x' },
      { candidates: [null] },
      { candidates: [{}] },
      { candidates: [{ text: 1, correctAnswer: 'FALSE', misconception: '', sourceClusterIndex: 0 }] },
      { candidates: [{ text: 'The ball costs 10 cents.', correctAnswer: 'maybe', misconception: '', sourceClusterIndex: 0 }] },
      { candidates: [{ text: 'The ball costs 10 cents.', correctAnswer: 'TRUE', misconception: '', sourceClusterIndex: '0' }] },
    ]
    for (const g of garbage) {
      expect(() => normalizeGenerator(g, topicInput)).not.toThrow()
      expect(normalizeGenerator(g, topicInput)).toBeNull()
      expect(normalizeGenerator(g, clusterInput)).toBeNull()
    }
  })

  it('returns null on an unusable shape and on zero survivors', () => {
    expect(normalizeGenerator({ nope: true }, topicInput)).toBeNull()
    expect(normalizeGenerator(null, topicInput)).toBeNull()
    expect(normalizeGenerator({ candidates: [] }, topicInput)).toBeNull()
    expect(
      normalizeGenerator({ candidates: [rawOf('Is it 10 cents?'), rawOf('Why is it 5 cents')] }, topicInput),
    ).toBeNull()
  })
})

describe('generatorFallback', () => {
  it('topic fallback is the canned list, copied', () => {
    const fb = generatorFallback(topicInput)
    expect(fb.candidates).toEqual(CANNED_TOPIC_LIST)
    expect(fb.candidates[0]).not.toBe(CANNED_TOPIC_LIST[0])
    expect(fb.candidates).toHaveLength(5)
    expect(fb.candidates.filter((c) => c.correctAnswer)).toHaveLength(1)
    expect(fb.candidates.every((c) => c.sourceClusterIndex === null)).toBe(true)
  })

  it('cluster fallback gives one candidate per non-Other cluster in count order, at most 3', () => {
    const fb = generatorFallback(clusterInput)
    expect(fb.candidates.map((c) => c.sourceClusterIndex)).toEqual([0, 1, 2])
    expect(fb.candidates[0]).toEqual({
      text: 'Closer to the sun in summer.',
      correctAnswer: false,
      misconception: FALLBACK_MISCONCEPTION,
      sourceClusterIndex: 0,
    })
    const big: GeneratorInput = {
      kind: 'cluster',
      question: 'q',
      referenceAnswer: null,
      clusters: [
        { label: 'first small cluster', count: 1, samples: [] },
        { label: 'the largest cluster', count: 9, samples: [] },
        { label: OTHER_LABEL, count: 20, samples: [] },
        { label: 'a middle cluster', count: 5, samples: [] },
        { label: 'another middle one', count: 4, samples: [] },
      ],
    }
    const out = generatorFallback(big)
    expect(out.candidates.map((c) => c.sourceClusterIndex)).toEqual([1, 3, 4])
    expect(out.candidates[0].text).toBe('The largest cluster.')
  })

  it('fallback output for both kinds passes the normalizer unchanged', () => {
    for (const input of [topicInput, clusterInput]) {
      const fb = generatorFallback(input)
      const again = normalizeGenerator({ candidates: fb.candidates.map(toRaw) }, input)
      expect(again).toEqual(fb)
    }
  })

  it('cluster fallback with only an Other cluster is empty, never a throw', () => {
    const only: GeneratorInput = {
      kind: 'cluster',
      question: 'q',
      referenceAnswer: null,
      clusters: [{ label: OTHER_LABEL, count: 3, samples: [] }],
    }
    expect(generatorFallback(only)).toEqual({ candidates: [] })
  })
})

describe('generatorSpec', () => {
  it('carries the language rule and the prompt tail', () => {
    expect(generatorSpec.name).toBe('generator')
    expect(generatorSpec.system).toContain('Never use any of these words')
    expect(generatorSpec.system).toContain('Begin your answer immediately')
    expect(findBannedWord(generatorSpec.system.replace(/Never use any of these words: [^.]+\./, ''))).toBeNull()
  })

  it('formats both request kinds and caps samples per cluster', () => {
    expect(generatorSpec.userMessage(topicInput)).toContain('Request: TOPIC')
    const withMany: GeneratorInput = {
      ...clusterInput,
      clusters: [{ label: 'a', count: 5, samples: ['s1', 's2', 's3', 's4', 's5'] }],
    }
    const msg = generatorSpec.userMessage(withMany)
    expect(msg).toContain('Request: CLUSTER')
    expect(msg).toContain('Reference answer: "The tilt of the axis."')
    expect(msg).toContain('0: "a" (5 answers)')
    expect(msg).toContain('- s3')
    expect(msg).not.toContain('- s4')
    expect(generatorSpec.userMessage({ ...clusterInput, referenceAnswer: null })).toContain('none given')
  })

  it('pluralises the per-cluster answer count', () => {
    const one: GeneratorInput = {
      ...clusterInput,
      clusters: [
        { label: 'a', count: 1, samples: [] },
        { label: 'b', count: 2, samples: [] },
      ],
    }
    const msg = generatorSpec.userMessage(one)
    expect(msg).toContain('0: "a" (1 answer)')
    expect(msg).toContain('1: "b" (2 answers)')
  })
})

describe('generator.cases.json', () => {
  interface Case {
    name: string
    input: GeneratorInput
    expect: {
      minCandidates: number
      maxCandidates: number
      anyTextMatches?: string
      mixedAnswers?: boolean
      first?: { sourceClusterIndex?: number; correctAnswer?: boolean; textMatches?: string }
    }
  }
  const text = readFileSync(fileURLToPath(new URL('./generator.cases.json', import.meta.url)), 'utf8')

  it('parses into 10 well-formed cases with no banned words', () => {
    const cases = JSON.parse(text) as Case[]
    expect(cases).toHaveLength(10)
    expect(findBannedWord(text)).toBeNull()
    expect(cases.filter((c) => c.input.kind === 'topic')).toHaveLength(5)
    expect(cases.filter((c) => c.input.kind === 'cluster')).toHaveLength(5)
    for (const c of cases) {
      expect(typeof c.name).toBe('string')
      expect(c.expect.minCandidates).toBeGreaterThanOrEqual(1)
      expect(c.expect.minCandidates).toBeLessThanOrEqual(c.expect.maxCandidates)
      if (c.input.kind === 'topic') {
        expect(c.input.topic.length).toBeGreaterThan(0)
        expect(c.expect.maxCandidates).toBeLessThanOrEqual(MAX_TOPIC_CANDIDATES)
      } else {
        expect(c.input.clusters.length).toBeGreaterThanOrEqual(2)
        expect(c.expect.maxCandidates).toBeLessThanOrEqual(MAX_CLUSTER_CANDIDATES)
        const idx = c.expect.first?.sourceClusterIndex
        if (idx !== undefined) {
          expect(c.input.clusters[idx]).toBeDefined()
          expect(c.input.clusters[idx].label).not.toBe(OTHER_LABEL)
        }
      }
    }
  })

  it('every regex compiles', () => {
    const cases = JSON.parse(text) as Case[]
    for (const c of cases) {
      if (c.expect.anyTextMatches) expect(() => new RegExp(c.expect.anyTextMatches!)).not.toThrow()
      if (c.expect.first?.textMatches) expect(() => new RegExp(c.expect.first!.textMatches!)).not.toThrow()
    }
  })
})
