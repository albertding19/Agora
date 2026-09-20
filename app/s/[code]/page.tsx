'use client'
import { useRouter } from 'next/navigation'
import { use, useCallback, useEffect, useMemo } from 'react'
import { BlindEntry } from '@/components/student/BlindEntry'
import { GroupAndTurns } from '@/components/student/GroupAndTurns'
import { Lobby } from '@/components/student/Lobby'
import { OpenAnswer } from '@/components/student/OpenAnswer'
import { OpenRevise } from '@/components/student/OpenRevise'
import { OpenThanks } from '@/components/student/OpenThanks'
import { Result } from '@/components/student/Result'
import { Steelman } from '@/components/student/Steelman'
import { Waiting } from '@/components/student/Waiting'
import { PhaseBadge } from '@/components/shared/PhaseBadge'
import { createApi } from '@/lib/api'
import { normalizeCode } from '@/lib/ids'
import { isOpenQuestion } from '@/lib/phases/machine'
import { useSessionView } from '@/lib/realtime/useSessionView'
import { useHydrated, useStudentIdentity } from '@/lib/storage'
import type { StudentView } from '@/lib/types'

export default function StudentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params)
  const code = normalizeCode(rawCode)
  const router = useRouter()
  const hydrated = useHydrated()
  const identity = useStudentIdentity(code)

  useEffect(() => {
    if (hydrated && !identity) router.replace(`/join?code=${encodeURIComponent(code)}`)
  }, [hydrated, identity, router, code])

  const api = useMemo(() => createApi(), [])
  const fetcher = useCallback((): Promise<StudentView> => {
    if (!identity) return Promise.reject(new Error('not joined'))
    return api.studentView(identity.sessionId, identity.participantId)
  }, [api, identity])

  const { view, error, status, expectTick } = useSessionView(fetcher, identity?.sessionId ?? null)

  if (!hydrated || !identity) return <Shell code={code}>Loading…</Shell>
  if (!view) {
    return (
      <Shell code={code}>
        <p className="text-muted-foreground">{error ? `Could not load the session: ${error}` : 'Connecting…'}</p>
      </Shell>
    )
  }

  let body: React.ReactNode
  if (view.status === 'lobby') {
    body = <Lobby title={view.session.title} name={view.me.name} />
  } else if (view.status === 'ended') {
    body = <Lobby title={view.session.title} name={view.me.name} message="This session has ended. Thanks for taking part." />
  } else if (view.status === 'waiting-next-question' || !view.question) {
    body = <Lobby title={view.session.title} name={view.me.name} message="Waiting for the next question…" />
  } else if (isOpenQuestion(view.question)) {
    // Open question (plan §17.3): free text during blind, then nothing to do.
    body =
      view.phase === 'blind' ? (
        <OpenAnswer key={view.question.id} view={view} api={api} participantId={identity.participantId} onMutated={expectTick} />
      ) : (
        <OpenThanks view={view} />
      )
  } else {
    // Steelman gate (plan §17.7): open from snapshot through structured when the flag is on.
    const steelman =
      view.features.steelman && view.my?.steelmanSide ? (
        <Steelman key={'sm-' + view.question.id} view={view} api={api} participantId={identity.participantId} />
      ) : null
    switch (view.phase) {
      case 'blind':
        body = <BlindEntry key={view.question.id} view={view} api={api} participantId={identity.participantId} onMutated={expectTick} />
        break
      case 'snapshot':
        body = (
          <>
            <Waiting view={view} />
            {steelman}
          </>
        )
        break
      case 'structured':
        body = (
          <>
            {steelman}
            <GroupAndTurns view={view} myName={view.me.name} />
          </>
        )
        break
      case 'open':
        body = <OpenRevise key={view.question.id} view={view} api={api} participantId={identity.participantId} onMutated={expectTick} />
        break
      case 'resolved':
        body = <Result view={view} api={api} participantId={identity.participantId} onMutated={expectTick} />
        break
      default:
        body = <Lobby title={view.session.title} name={view.me.name} />
    }
  }

  return (
    <Shell code={code} phase={view.phase} status={status}>
      {body}
    </Shell>
  )
}

function Shell({
  code,
  phase,
  status,
  children,
}: {
  code: string
  phase?: StudentView['phase']
  status?: string
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Agora · <span className="font-mono">{code}</span>
        </span>
        <span className="flex items-center gap-2">
          {phase && <PhaseBadge phase={phase} />}
          {status === 'degraded' && <span title="Live updates delayed; still polling">·</span>}
        </span>
      </header>
      {children}
    </main>
  )
}
