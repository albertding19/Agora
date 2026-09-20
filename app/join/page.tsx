'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createApi } from '@/lib/api'
import { isValidCode, normalizeCode } from '@/lib/ids'
import { setStudentIdentity } from '@/lib/storage'

function JoinForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [code, setCode] = useState(() => normalizeCode(params.get('code') ?? ''))
  const [name, setName] = useState('')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const normalized = normalizeCode(code)
  const valid = isValidCode(normalized) && name.trim().length > 0

  async function join(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setJoining(true)
    setError(null)
    try {
      const result = await createApi().join({ code: normalized, displayName: name.trim() })
      setStudentIdentity(normalized, result)
      router.push(`/s/${normalized}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setJoining(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join a session</CardTitle>
        <CardDescription>Enter the code on the screen and a name your classmates will recognise.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={join}>
          <Input
            placeholder="Join code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            autoCapitalize="characters"
            autoCorrect="off"
            className="font-mono text-lg tracking-widest"
          />
          <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <Button type="submit" size="lg" disabled={!valid || joining}>
            {joining ? 'Joining…' : 'Join'}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  )
}

export default function JoinPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">Agora</h1>
      <Suspense fallback={null}>
        <JoinForm />
      </Suspense>
    </main>
  )
}
