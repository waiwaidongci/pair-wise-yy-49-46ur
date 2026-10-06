import type { Divergence, Mapping, OfflineDraft, Role } from './seed'

/** 映射配对键：同一对「来源→目标·关系」视为同一条映射。 */
export const pairKey = (mapping: Pick<Mapping, 'source' | 'target' | 'relation'>): string =>
  `${mapping.source}|${mapping.target}|${mapping.relation}`

/** 附议/退回权限：仅院系审阅人。 */
export function canReview(role: Role | null | undefined): boolean {
  return role === '院系审阅人'
}

/** 旧修订判定：只有当前开放版本的待审阅项可以附议。 */
export function isCurrentRevision(revisionId: string | null | undefined, currentRevision: string): boolean {
  return !revisionId || revisionId === currentRevision
}

export type MergeOutcome = {
  /** 院系版本中不存在的新映射，直接并入。 */
  merged: Mapping[]
  /** 与已确认映射冲突的后到内容，进入待审阅分歧，不覆盖已确认覆盖。 */
  divergences: Divergence[]
}

/**
 * 离线草稿与院系版本逐对比对：
 * - 配对不存在 → 新映射，并入；
 * - 配对存在且权重一致 → 无变化；
 * - 配对存在但权重不同 → 后到内容作为待审阅分歧，院系版保持不动。
 */
export function diffDraftAgainstDepartment(draft: OfflineDraft, departmentMappings: Mapping[]): MergeOutcome {
  const merged: Mapping[] = []
  const divergences: Divergence[] = []
  for (const change of draft.changes) {
    const key = pairKey(change)
    const existing = departmentMappings.find((mapping) => pairKey(mapping) === key)
    if (!existing) {
      merged.push(change)
    } else if (existing.weight !== change.weight) {
      divergences.push({
        id: `DIV-${draft.id}-${key}`.replace(/[|]/g, '-'),
        pairKey: key,
        source: change.source,
        target: change.target,
        relation: change.relation,
        departmentMapping: existing,
        draftMapping: change,
        draftId: draft.id,
        status: '待审阅',
      })
    }
  }
  return { merged, divergences }
}

/** 合并失败时保留原草稿与待处理项，返回可重试的失败结果。 */
export function failedMerge(draft: OfflineDraft, error: string): { ok: false; error: string; draftId: string } {
  return { ok: false, error, draftId: draft.id }
}
