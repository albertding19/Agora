/**
 * Per-session feature flags (plan §17). Pure: both the view builders and the
 * route handlers use it, and it must stay importable from client code.
 */
import { FeaturesSchema, type Features } from '@/lib/types'

/** Parse the raw `sessions.features` jsonb; anything malformed is all-false. */
export function featuresOf(raw: unknown): Features {
  const parsed = FeaturesSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : FeaturesSchema.parse({})
}
