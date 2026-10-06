import { json } from '@sveltejs/kit'
import { decideReviewSchema } from '$lib/schema'
import { decideReview } from '$lib/server/department'

export async function POST({ request }) {
  const body = await request.json().catch(() => null)
  const parsed = decideReviewSchema.safeParse(body)
  if (!parsed.success) {
    return json({ ok: false, error: '参数校验失败。', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 })
  }
  const comment = parsed.data.comment || (parsed.data.status === '已附议' ? '证据充分，同意纳入修订。' : '请补充可验证的评分记录。')
  const result = decideReview(parsed.data.reviewId, parsed.data.status, comment, parsed.data.role)
  return json(result, { status: result.ok ? 200 : result.status })
}
