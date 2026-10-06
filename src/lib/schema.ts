import { z } from 'zod'

export const roleSchema = z.enum(['课程负责人', '院系审阅人'])

export const revisionSchema = z.object({
  courseId: z.string().min(1, '请选择课程'),
  requirementId: z.string().min(1, '请选择毕业要求'),
  evidence: z.string().min(12, '证据说明至少需要 12 个字符'),
  revisionNote: z.string().min(8, '修订说明至少需要 8 个字符'),
  submitter: z.string().min(2, '请填写提交人'),
})

export const mappingSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  relation: z.enum(['支撑', '前置', '考核', '教学']),
  weight: z.number().min(0).max(1),
})

export const mergeDraftSchema = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  courseGroup: z.string().min(1),
  baseRevision: z.string().min(1),
  changes: z.array(mappingSchema).min(1, '草稿没有可合并的映射变更'),
  note: z.string().default(''),
  status: z.enum(['离线', '合并失败', '已合并']).default('离线'),
  idempotencyKey: z.string().min(1),
  error: z.string().optional(),
  updatedAt: z.string().default(''),
})

export const resolveDivergenceSchema = z.object({
  divergenceId: z.string().min(1),
  keep: z.enum(['draft', 'department']),
  role: roleSchema,
})

export const decideReviewSchema = z.object({
  reviewId: z.string().min(1),
  status: z.enum(['已附议', '已退回']),
  comment: z.string().default(''),
  role: roleSchema,
})

export const lockSchema = z.object({
  role: roleSchema.optional(),
})

export type RevisionInput = z.infer<typeof revisionSchema>
