import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { StudentView } from '@/lib/types'

/**
 * Open question (plan §17.3) after the answers close. An open question goes
 * snapshot → resolved with nothing for the phone to do; the output is what
 * the teacher sharpens out of the class's answers.
 */
export function OpenThanks({ view }: { view: StudentView }) {
  const wrote = view.my?.reasoning?.trim() ?? ''
  return (
    <Card>
      <CardHeader>
        <CardTitle>Thanks.</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground">{view.question?.proposition}</p>
        <p>
          {view.phase === 'resolved'
            ? 'The next question comes from what the class wrote.'
            : "The class's answers are being read."}
        </p>
        {wrote && (
          <p className="text-sm text-muted-foreground">
            You wrote: <span className="text-foreground">{wrote}</span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
