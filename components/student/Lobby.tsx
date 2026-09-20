import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function Lobby({ title, name, message }: { title: string; name: string; message?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>You are in as {name}.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{message ?? 'Waiting for the teacher…'}</p>
      </CardContent>
    </Card>
  )
}
