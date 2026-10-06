import { json } from '@sveltejs/kit'
import { mergeDraftSchema } from '$lib/schema'
import { mergeDraft } from '$lib/server/department'

export async function POST({ request }) {
  const body = await request.json().catch(() => null)
  const parsed = mergeDraftSchema.safeParse(body)
  if (!parsed.success) {
    return json({ ok: false, error: '草稿校验失败，请检查映射变更后重试。', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 })
  }
  const result = mergeDraft(parsed.data)
  return json(result)
}
