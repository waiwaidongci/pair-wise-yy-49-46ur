import { fail } from '@sveltejs/kit'
import { revisionSchema } from '$lib/schema'
import { submitRevision } from '$lib/server/department'

export const actions = {
  submitRevision: async ({ request }) => {
    const form = await request.formData()
    const parsed = revisionSchema.safeParse({
      courseId: form.get('courseId'),
      requirementId: form.get('requirementId'),
      evidence: form.get('evidence'),
      revisionNote: form.get('revisionNote'),
      submitter: form.get('submitter'),
    })
    if (!parsed.success) {
      return fail(400, { errors: parsed.error.flatten().fieldErrors, values: Object.fromEntries(form) })
    }
    const item = submitRevision(parsed.data)
    return { success: true, item }
  },
}
