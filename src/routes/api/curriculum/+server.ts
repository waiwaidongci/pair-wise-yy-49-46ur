import { json } from '@sveltejs/kit'
import { snapshot } from '$lib/server/department'

export function GET() {
  return json({ ...snapshot(), updatedAt: new Date().toISOString() })
}
