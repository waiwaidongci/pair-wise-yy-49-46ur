import type {
  Actor,
  Divergence,
  GraphNode,
  LockedVersion,
  Mapping,
  MappingEdit,
  MergeLogEntry,
  OfflineDraft,
  ReviewItem,
} from './seed'

/** 领域逻辑涉及的状态切片 */
export type CurriculumSlice = {
  nodes: GraphNode[]
  mappings: Mapping[]
  reviewItems: ReviewItem[]
  divergences: Divergence[]
  offlineDraft: OfflineDraft | null
  mergeLog: MergeLogEntry[]
  lockedVersions: LockedVersion[]
  revision: string
  locked: boolean
  online: boolean
  actor: Actor
}

export type GuardResult = { ok: true } | { ok: false; message: string }

export const pairKey = (source: string, target: string) => `${source}->${target}`

export function nextRevision(revision: string) {
  const match = revision.match(/^([A-Za-z]*)(\d+)$/)
  if (!match) return `${revision}+1`
  return `${match[1]}${Number(match[2]) + 1}`
}

export function timestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 单条草稿修改的校验错误 */
export function changeErrors(nodes: GraphNode[], change: MappingEdit): string[] {
  const errors: string[] = []
  const ids = new Set(nodes.map((node) => node.id))
  if (!ids.has(change.source)) errors.push(`来源节点 ${change.source} 未注册`)
  if (!ids.has(change.target)) errors.push(`目标节点 ${change.target} 未注册`)
  if (change.source === change.target) errors.push('来源与目标不能相同')
  if (!(change.weight >= 0 && change.weight <= 1)) errors.push(`权重 ${change.weight} 超出 0–1 范围`)
  return errors
}

export function validateDraftChanges(nodes: GraphNode[], changes: MappingEdit[]): string[] {
  return changes.flatMap((change, index) =>
    changeErrors(nodes, change).map((error) => `第 ${index + 1} 条修改（${change.source} → ${change.target}）：${error}`),
  )
}

export type MergeOutcome = {
  ok: boolean
  message: string
  applied: Mapping[]
  newDivergences: Divergence[]
  /** 合并后需要写回的状态切片；失败时仅更新草稿状态，其余保持原样 */
  next: Pick<CurriculumSlice, 'mappings' | 'divergences' | 'revision' | 'offlineDraft'>
}

/**
 * 把离线草稿并入院系版本。
 * - 网络未恢复或草稿校验未通过：合并失败，原草稿与待处理项全部保留，可重试；
 * - 与已确认覆盖冲突的修改登记为待审阅分歧，不盖掉院系版本；
 * - 分歧与映射记录使用确定性 ID，失败重试或重复合并不会重复生成审阅记录。
 */
export function mergeDraftIntoState(state: CurriculumSlice, now: string): MergeOutcome {
  const draft = state.offlineDraft
  const keep = (): MergeOutcome['next'] => ({
    mappings: state.mappings,
    divergences: state.divergences,
    revision: state.revision,
    offlineDraft: draft,
  })
  const fail = (message: string): MergeOutcome => ({
    ok: false,
    message,
    applied: [],
    newDivergences: [],
    next: {
      ...keep(),
      offlineDraft: draft ? { ...draft, status: '合并失败', attempts: draft.attempts + 1, lastError: message, updatedAt: now } : draft,
    },
  })

  if (!draft) return fail('没有待合并的离线草稿。')
  if (draft.status === '已合并') return fail(`草稿 ${draft.id} 已合并过，不会重复生成审阅记录。`)
  if (!state.online) return fail('网络未恢复，无法连接院系版本库，原草稿与待处理项已保留，请稍后重试。')
  if (state.locked) return fail(`版本 ${state.revision} 已锁定，请先开启新一轮修订再合并。`)
  if (draft.changes.length === 0) return fail('草稿没有可合并的修改。')
  const errors = validateDraftChanges(state.nodes, draft.changes)
  if (errors.length > 0) return fail(`草稿校验未通过：${errors.join('；')}`)

  const confirmedByPair = new Map<string, Mapping[]>()
  state.mappings.forEach((mapping) => {
    const key = pairKey(mapping.source, mapping.target)
    confirmedByPair.set(key, [...(confirmedByPair.get(key) ?? []), mapping])
  })

  const applied: Mapping[] = []
  const newDivergences: Divergence[] = []
  let skipped = 0

  draft.changes.forEach((change, index) => {
    const key = pairKey(change.source, change.target)
    const confirmed = confirmedByPair.get(key) ?? []
    if (confirmed.some((mapping) => mapping.relation === change.relation && mapping.weight === change.weight)) {
      skipped += 1
      return
    }
    if (confirmed.length > 0) {
      const id = `DIV-${draft.id}-${key}`
      // 幂等：同一草稿同一对映射只生成一条分歧记录
      if (!state.divergences.some((item) => item.id === id) && !newDivergences.some((item) => item.id === id)) {
        newDivergences.push({
          id,
          pairKey: key,
          source: change.source,
          target: change.target,
          confirmed: confirmed[0],
          incoming: change,
          draftId: draft.id,
          group: draft.group,
          status: '待审阅',
          comment: '',
        })
      }
      return
    }
    const mapping: Mapping = { id: `M-${draft.id}-${index + 1}`, source: change.source, target: change.target, relation: change.relation, weight: change.weight }
    applied.push(mapping)
    confirmedByPair.set(key, [mapping])
  })

  const revision = applied.length > 0 ? nextRevision(state.revision) : state.revision
  const parts = [
    applied.length > 0 ? `并入 ${applied.length} 条映射` : '',
    newDivergences.length > 0 ? `${newDivergences.length} 条冲突登记为待审阅分歧（未覆盖已确认覆盖）` : '',
    skipped > 0 ? `${skipped} 条与院系版本一致，已跳过` : '',
  ].filter(Boolean)
  return {
    ok: true,
    message: `草稿 ${draft.id} 合并完成：${parts.join('，')}。${applied.length > 0 ? `版本升至 ${revision}。` : ''}`,
    applied,
    newDivergences,
    next: {
      mappings: [...state.mappings, ...applied],
      divergences: [...state.divergences, ...newDivergences],
      revision,
      offlineDraft: { ...draft, status: '已合并', attempts: draft.attempts + 1, lastError: '', updatedAt: now },
    },
  }
}

export type ResolveOutcome = {
  ok: boolean
  message: string
  next?: Pick<CurriculumSlice, 'mappings' | 'divergences' | 'revision'>
}

/** 院系审阅人逐条确认分歧保留哪一版；映射一变版本即升，覆盖矩阵与缺口提示随之重算 */
export function resolveDivergenceInState(
  state: CurriculumSlice,
  id: string,
  choice: 'keep' | 'take',
  comment: string,
  actor: Actor,
): ResolveOutcome {
  if (actor.role !== '院系审阅人') {
    return { ok: false, message: `越权操作已拒绝：${actor.role}不能裁决分歧，需院系审阅人逐条确认。` }
  }
  const divergence = state.divergences.find((item) => item.id === id)
  if (!divergence) return { ok: false, message: `分歧 ${id} 不存在。` }
  if (divergence.status !== '待审阅') return { ok: false, message: `分歧 ${id} 已处理，不能重复裁决。` }

  const status: Divergence['status'] = choice === 'take' ? '已采用草稿版' : '已保留院系版'
  const divergences = state.divergences.map((item) => (item.id === id ? { ...item, status, comment } : item))
  if (choice === 'keep') {
    return { ok: true, message: `分歧 ${id} 已保留院系确认版本。`, next: { mappings: state.mappings, divergences, revision: state.revision } }
  }
  // 采用草稿版：以确认映射的 ID 原位替换，同一对映射只保留一条
  const replacement: Mapping = {
    id: divergence.confirmed.id,
    source: divergence.source,
    target: divergence.target,
    relation: divergence.incoming.relation,
    weight: divergence.incoming.weight,
  }
  const mappings = [
    ...state.mappings.filter((mapping) => pairKey(mapping.source, mapping.target) !== divergence.pairKey),
    replacement,
  ]
  const revision = nextRevision(state.revision)
  return { ok: true, message: `分歧 ${id} 已采用草稿版，映射更新，版本升至 ${revision}，覆盖矩阵与缺口提示已重算。`, next: { mappings, divergences, revision } }
}

/** 附议/退回守卫：课程负责人越权直接拒绝；映射变更后旧修订不能再附议 */
export function reviewGuard(item: ReviewItem, revision: string, actor: Actor, decision: '已附议' | '已退回'): GuardResult {
  if (actor.role !== '院系审阅人') {
    return { ok: false, message: `越权操作已拒绝：${actor.role}不能执行审阅（附议/退回），需院系审阅人处理。` }
  }
  if (item.status !== '待审阅') return { ok: false, message: `修订 ${item.id} 已完成审阅，不会重复生成审阅记录。` }
  if (decision === '已附议' && item.baseRevision !== revision) {
    return { ok: false, message: `修订 ${item.id} 基于旧版本 ${item.baseRevision}，当前版本 ${revision} 映射已变更，旧修订不能再附议，请退回或按当前版本重报。` }
  }
  return { ok: true }
}

export type ReviewOutcome = { ok: boolean; message: string; next?: Pick<CurriculumSlice, 'reviewItems'> }

export function actOnReviewInState(
  state: CurriculumSlice,
  id: string,
  decision: '已附议' | '已退回',
  comment: string,
  actor: Actor,
): ReviewOutcome {
  const item = state.reviewItems.find((entry) => entry.id === id)
  if (!item) return { ok: false, message: `修订 ${id} 不存在。` }
  const guard = reviewGuard(item, state.revision, actor, decision)
  if (!guard.ok) return { ok: false, message: guard.message }
  return {
    ok: true,
    message: `修订 ${id} ${decision}。`,
    next: { reviewItems: state.reviewItems.map((entry) => (entry.id === id ? { ...entry, status: decision, comment } : entry)) },
  }
}

/** 课程负责人把过期修订重新基于当前版本提交 */
export function rebaseReviewInState(state: CurriculumSlice, id: string, actor: Actor): ReviewOutcome {
  if (actor.role !== '课程负责人') return { ok: false, message: '仅课程负责人可以按当前版本重报修订。' }
  const item = state.reviewItems.find((entry) => entry.id === id)
  if (!item) return { ok: false, message: `修订 ${id} 不存在。` }
  if (item.status !== '待审阅') return { ok: false, message: `修订 ${id} 已完成审阅，无需重报。` }
  if (item.baseRevision === state.revision) return { ok: false, message: `修订 ${item.id} 已基于当前版本 ${state.revision}。` }
  return {
    ok: true,
    message: `修订 ${id} 已重新基于 ${state.revision} 提交，可继续审阅。`,
    next: { reviewItems: state.reviewItems.map((entry) => (entry.id === id ? { ...entry, baseRevision: state.revision } : entry)) },
  }
}

/** 锁定当前版本：快照归档，考核证据照旧可查 */
export function lockVersionInState(state: CurriculumSlice, now: string): { ok: boolean; message: string; next?: Pick<CurriculumSlice, 'locked' | 'lockedVersions'> } {
  if (state.locked) return { ok: false, message: `版本 ${state.revision} 已锁定。` }
  const snapshot: LockedVersion = {
    revision: state.revision,
    lockedAt: now,
    mappings: structuredClone(state.mappings),
    reviewItems: structuredClone(state.reviewItems),
  }
  return {
    ok: true,
    message: `版本 ${state.revision} 已锁定归档，考核证据仍可查询。`,
    next: { locked: true, lockedVersions: [snapshot, ...state.lockedVersions] },
  }
}

export function unlockNextRevisionInState(state: CurriculumSlice): { ok: boolean; message: string; next?: Pick<CurriculumSlice, 'locked' | 'revision'> } {
  if (!state.locked) return { ok: false, message: '当前版本未锁定。' }
  const revision = nextRevision(state.revision)
  return { ok: true, message: `已开启新一轮修订 ${revision}。`, next: { locked: false, revision } }
}

export type Issue = { id: string; severity: '错误' | '警告'; title: string; detail: string }

/** 覆盖缺口与重复映射检查：映射一变即由派生状态重算 */
export function validateCurriculum(state: Pick<CurriculumSlice, 'nodes' | 'mappings'>): Issue[] {
  const issues: Issue[] = []
  const outgoing = new Map<string, Mapping[]>()
  state.mappings.forEach((mapping) => outgoing.set(mapping.source, [...(outgoing.get(mapping.source) ?? []), mapping]))
  state.nodes
    .filter((node) => node.type === '毕业要求')
    .forEach((node) => {
      if (!(outgoing.get(node.id) ?? []).some((mapping) => state.nodes.find((item) => item.id === mapping.target)?.type === '课程')) {
        issues.push({ id: `coverage-${node.id}`, severity: '错误', title: `${node.label.split('\n')[0]} 存在覆盖缺口`, detail: '未关联任何课程支撑证据。' })
      }
    })
  const seen = new Set<string>()
  state.mappings.forEach((mapping) => {
    const key = `${mapping.source}-${mapping.target}-${mapping.relation}`
    if (seen.has(key)) issues.push({ id: `dup-${mapping.id}`, severity: '警告', title: `${mapping.id} 为重复映射`, detail: '相同来源、目标和关系重复录入，可合并。' })
    seen.add(key)
  })
  return issues
}
