import { json } from '@sveltejs/kit'
import { lockRevision } from '$lib/server/department'

export async function POST() {
  const result = lockRevision()
  return json(result)
}
