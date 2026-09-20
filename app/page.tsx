'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createApi } from '@/lib/api'
import { normalizeCode } from '@/lib/ids'
import { setTeacherToken } from '@/lib/storage'

export default function Home() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const api = createApi()
      const result = await api.createSession({ title: title.trim() || 'Untitled session' })
      setTeacherToken(result.sessionId, result.teacherToken)
      router.push(`/t/${result.sessionId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setCreating(false)
    }
  }

  function join(e: React.FormEvent) {
    e.preventDefault()
    router.push(`/join?code=${encodeURIComponent(normalizeCode(code))}`)
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold tracking-tight">Agora</h1>
        <p className="text-lg text-muted-foreground">Classroom response tools count votes. We price beliefs.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create a session</CardTitle>
            <CardDescription>For teachers. You get a join code and the dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3" onSubmit={create}>
              <Input placeholder="Session title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Join</CardTitle>
            <CardDescription>For students. Enter the code on the screen.</CardDescription>
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
              <Button type="submit" variant="outline" disabled={code.trim().length !== 6}>
                Join
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </main>
  )
}
