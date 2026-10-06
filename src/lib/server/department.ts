import { diffDraftAgainstDepartment, pairKey } from '$lib/collab'
import type { RevisionInput } from '$lib/schema'
import {
  divergences as seedDivergences,
  evidenceRecords as seedEvidence,
  mappings as seedMappings,
  mergeRecords as seedMergeRecords,
  nodes as seedNodes,
  reviewItems as seedReviewItems,
  seedState,
} from '$lib/seed'
import type {
  Divergence,
  EvidenceRecord,
  Mapping,
  MergeRecord,
  OfflineDraft,
  ReviewItem,
  Role,
} from '$lib/seed'

type DepartmentState = {
  nodes: typeof seedNodes
  mappings: Mapping[]
  reviewItems: ReviewItem[]
  divergences: Divergence[]
  evidence: EvidenceRecord[]
  mergeRecords: MergeRecord[]
  revision: string
  locked: boolean
}

function createDepartmentState(): DepartmentState {
  return {
    nodes: seedNodes,
    mappings: structuredClone(seedMappings),
    reviewItems: structuredClone(seedReviewItems),
    divergences: structuredClone(seedDivergences),
    evidence: structuredClone(seedEvidence),
    mergeRecords: structuredClone(seedMergeRecords),
    revision: seedState.revision,
    locked: seedState.locked,
  }
}

const state: DepartmentState = createDepartmentState()

export function snapshot() {
  return {
    nodes: state.nodes,
    mappings: state.mappings,
    reviewItems: state.reviewItems,
    divergences: state.divergences,
    evidence: state.evidence,
    mergeRecords: state.mergeRecords,
    revision: state.revision,
    locked: state.locked,
  }
}

/**
 * 合并离线草稿（网络恢复后调用）。
 * 幂等：同一 idempotencyKey 只生成一条审阅/合并记录，重试不重复生成。
 * 冲突：后到内容进入待审阅分歧，不覆盖已确认的毕业要求覆盖。
 */
export function mergeDraft(draft: OfflineDraft) {
  const duplicated = state.mergeRecords.find((record) => record.draftId === draft.id)
  if (duplicated) {
    return {
      ok: true as const,
      duplicated: true,
      record: duplicated,
      divergences: state.divergences.filter((item) => item.draftId === draft.id),
      mergedCount: duplicated.mergedCount,
    }
  }

  const { merged, divergences } = diffDraftAgainstDepartment(draft, state.mappings)
  for (const mapping of merged) {
    if (!state.mappings.some((item) => pairKey(item) === pairKey(mapping))) state.mappings.push(mapping)
  }
  state.divergences.push(...divergences)

  const record: MergeRecord = {
    id: `MR-${draft.id}`,
    draftId: draft.id,
    courseGroup: draft.courseGroup,
    baseRevision: draft.baseRevision,
    mergedCount: merged.length,
    divergenceIds: divergences.map((item) => item.id),
    status: divergences.length ? '待审阅分歧' : '已合并',
    createdAt: new Date().toISOString(),
  }
  state.mergeRecords.push(record)

  return { ok: true as const, duplicated: false, record, divergences, mergedCount: merged.length }
}

/** 院系审阅人逐条确认保留哪一版；确认后映射变更，覆盖矩阵与缺口提示随之重算。 */
export function resolveDivergence(divergenceId: string, keep: 'draft' | 'department', role: Role) {
  if (role !== '院系审阅人') {
    return { ok: false as const, status: 403 as const, error: '越权拒绝：仅院系审阅人可确认保留版本。' }
  }
  const divergence = state.divergences.find((item) => item.id === divergenceId)
  if (!divergence) {
    return { ok: false as const, status: 404 as const, error: '分歧不存在或已被移除。' }
  }
  if (divergence.status !== '待审阅') {
    return { ok: false as const, status: 409 as const, error: `该分歧已处理（${divergence.status}），不能重复确认。` }
  }
  if (keep === 'draft') {
    const index = state.mappings.findIndex((item) => pairKey(item) === pairKey(divergence.draftMapping))
    if (index >= 0) {
      state.mappings[index] = { ...divergence.draftMapping, id: state.mappings[index].id }
    } else {
      state.mappings.push(divergence.draftMapping)
    }
    divergence.status = '已保留草稿'
  } else {
    divergence.status = '已保留院系版'
  }
  divergence.decidedBy = role
  divergence.decidedAt = new Date().toISOString()
  return { ok: true as const, divergence }
}

/** 审阅人附议/退回：越权直接拒绝；旧修订（已处理或已锁定版本）不能再附议。 */
export function decideReview(reviewId: string, status: '已附议' | '已退回', comment: string, role: Role) {
  if (role !== '院系审阅人') {
    return { ok: false as const, status: 403 as const, error: '越权附议已拒绝：课程负责人无附议权限，请联系院系审阅人处理。' }
  }
  const item = state.reviewItems.find((entry) => entry.id === reviewId)
  if (!item) {
    return { ok: false as const, status: 404 as const, error: '审阅项不存在。' }
  }
  if (item.status !== '待审阅') {
    return { ok: false as const, status: 409 as const, error: `旧修订不能再附议：该修订已${item.status}。` }
  }
  if (item.revisionId && item.revisionId !== state.revision) {
    return { ok: false as const, status: 409 as const, error: `旧修订不能再附议：该修订属于已锁定版本 ${item.revisionId}，当前版本为 ${state.revision}。` }
  }
  item.status = status
  item.comment = comment
  return { ok: true as const, item }
}

/** 锁定当前版本：考核证据按版本留存，锁定后照旧可查；版本号递增。 */
export function lockRevision() {
  for (const item of state.reviewItems) {
    const exists = state.evidence.some(
      (record) => record.revision === state.revision && record.courseId === item.courseId && record.requirementId === item.requirementId,
    )
    if (!exists) {
      state.evidence.push({
        revision: state.revision,
        courseId: item.courseId,
        requirementId: item.requirementId,
        evidence: item.evidence,
        status: item.status,
        decidedAt: new Date().toISOString(),
      })
    }
  }
  const previous = state.revision
  const current = `R${Number(state.revision.slice(1)) + 1}`
  state.revision = current
  state.locked = true
  return { ok: true as const, previous, current }
}

export function evidenceFor(revision?: string): EvidenceRecord[] {
  return revision ? state.evidence.filter((record) => record.revision === revision) : state.evidence
}

/** 课程负责人提交修订，进入当前开放版本的审阅队列。 */
export function submitRevision(input: RevisionInput): ReviewItem {
  const item: ReviewItem = {
    id: `REV-${Date.now().toString().slice(-4)}`,
    courseId: input.courseId,
    requirementId: input.requirementId,
    evidence: `${input.evidence} 修订说明：${input.revisionNote}`,
    submitter: input.submitter,
    status: '待审阅',
    comment: '',
    revisionId: state.revision,
  }
  state.reviewItems.unshift(item)
  return item
}
