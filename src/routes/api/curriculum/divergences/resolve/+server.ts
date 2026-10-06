import { json } from '@sveltejs/kit'
import { resolveDivergenceSchema } from '$lib/schema'
import { resolveDivergence } from '$lib/server/department'

export async function POST({ request }) {
  const body = await request.json().catch(() => null)
  const parsed = resolveDivergenceSchema.safeParse(body)
  if (!parsed.success) {
    return json({ ok: false, error: '参数校验失败。', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 })
  }
  const result = resolveDivergence(parsed.data.divergenceId, parsed.data.keep, parsed.data.role)
  return json(result, { status: result.ok ? 200 : result.status })
}
