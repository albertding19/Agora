import { requireTeacher } from '@/lib/auth'
import { bumpTick, updateSession } from '@/lib/db/queries'
import { db } from '@/lib/db/server'
import { featuresOf } from '@/lib/features'
import { json, parseBody, withErrors } from '@/lib/http'
import { FeaturesPatchBody, type Features, type FeaturesResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** PATCH /api/sessions/:id/features — teacher switches feature flags; only the keys sent change. */
export const PATCH = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params
  const client = db()
  const session = await requireTeacher(client, id, request)
  const patch = await parseBody(FeaturesPatchBody, request)

  const merged: Features = { ...featuresOf(session.features) }
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === 'boolean') merged[key as keyof Features] = value
  }
  await updateSession(client, session.id, { features: merged })
  await bumpTick(client, session.id)
  const result: FeaturesResult = { ok: true, features: merged }
  return json(result)
})
