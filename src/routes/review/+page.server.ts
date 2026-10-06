import { fail } from '@sveltejs/kit'
import { revisionSchema } from '$lib/schema'

export const actions = {
  submitRevision: async ({ request }) => {
    const form = await request.formData()
    const parsed = revisionSchema.safeParse({
      courseId: form.get('courseId'),
      requirementId: form.get('requirementId'),
      evidence: form.get('evidence'),
      revisionNote: form.get('revisionNote'),
      submitter: form.get('submitter'),
      baseRevision: form.get('baseRevision'),
    })
    if (!parsed.success) {
      return fail(400, { errors: parsed.error.flatten().fieldErrors, values: Object.fromEntries(form) })
    }
    const item = {
      id: `REV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      courseId: parsed.data.courseId,
      requirementId: parsed.data.requirementId,
      evidence: `${parsed.data.evidence} 修订说明：${parsed.data.revisionNote}`,
      submitter: parsed.data.submitter,
      status: '待审阅' as const,
      comment: '',
      baseRevision: parsed.data.baseRevision,
    }
    return { success: true, item }
  },
}
