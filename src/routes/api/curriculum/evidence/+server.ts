import { json } from '@sveltejs/kit'
import { evidenceFor } from '$lib/server/department'

export function GET({ url }) {
  const revision = url.searchParams.get('revision') ?? undefined
  return json({ revision: revision ?? '全部', evidence: evidenceFor(revision) })
}
