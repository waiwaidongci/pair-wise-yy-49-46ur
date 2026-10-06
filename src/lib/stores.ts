import { writable } from 'svelte/store'
import { browser } from '$app/environment'
import type { Divergence, EvidenceRecord, GraphNode, Mapping, MergeRecord, OfflineDraft, ReviewItem, Role } from './seed'
import { offlineDrafts, seedState } from './seed'
import { pairKey } from './collab'

type CurriculumState = {
  nodes: GraphNode[]
  mappings: Mapping[]
  reviewItems: ReviewItem[]
  divergences: Divergence[]
  evidence: EvidenceRecord[]
  mergeRecords: MergeRecord[]
  revision: string
  locked: boolean
  draft: string
  role: Role
  drafts: OfflineDraft[]
}

const saved = browser ? localStorage.getItem('curriculum-map-draft-v1') : null
const initial: CurriculumState = saved
  ? JSON.parse(saved)
  : {
      ...structuredClone(seedState),
      divergences: [],
      evidence: [],
      mergeRecords: [],
      role: '课程负责人',
      drafts: structuredClone(offlineDrafts),
      draft: 'C-308 对 GR-06 的案例证据不足，需补充评分记录。',
    }

function createCurriculumStore() {
  const { subscribe, update, set } = writable<CurriculumState>(initial)
  return {
    subscribe,
    set,
    update,
    /** 网络恢复后与院系版本同步（服务端为院系版本事实来源）。 */
    syncDepartment(snapshot: Partial<CurriculumState>) {
      update((state) => ({
        ...state,
        nodes: snapshot.nodes ?? state.nodes,
        mappings: snapshot.mappings ?? state.mappings,
        reviewItems: snapshot.reviewItems ?? state.reviewItems,
        divergences: snapshot.divergences ?? state.divergences,
        evidence: snapshot.evidence ?? state.evidence,
        mergeRecords: snapshot.mergeRecords ?? state.mergeRecords,
        revision: snapshot.revision ?? state.revision,
        locked: snapshot.locked ?? state.locked,
      }))
    },
    setRole(role: Role) {
      update((state) => ({ ...state, role }))
    },
    moveNode(id: string, x: number, y: number) {
      update((state) => ({ ...state, nodes: state.nodes.map((node) => (node.id === id ? { ...node, x, y } : node)) }))
    },
    /** 离线连边：并入本地图谱，同时记入当前离线草稿的变更集，待网络恢复后合并。 */
    addMapping(source: string, target: string, relation: Mapping['relation'], weight: number) {
      update((state) => {
        const mapping: Mapping = { id: `M-${Date.now()}`, source, target, relation, weight }
        const drafts = state.drafts.map((draft) => {
          if (draft.status === '已合并') return draft
          if (draft.changes.some((change) => pairKey(change) === pairKey(mapping))) return draft
          return { ...draft, changes: [...draft.changes, mapping], status: '离线' as const, error: undefined }
        })
        return { ...state, mappings: [...state.mappings, mapping], drafts }
      })
    },
    saveDraft(draft: string) {
      update((state) => ({ ...state, draft }))
    },
    addDraft() {
      update((state) => ({
        ...state,
        drafts: [
          ...state.drafts,
          {
            id: `DRAFT-${Date.now().toString().slice(-4)}`,
            owner: state.role === '课程负责人' ? '顾明' : '离线草稿',
            courseGroup: '新建课程组',
            baseRevision: state.revision,
            changes: [],
            note: '离线整理中',
            status: '离线',
            idempotencyKey: `idem-${Date.now()}`,
            updatedAt: new Date().toISOString(),
          },
        ],
      }))
    },
    updateDraftStatus(id: string, status: OfflineDraft['status'], error?: string) {
      update((state) => ({
        ...state,
        drafts: state.drafts.map((draft) => (draft.id === id ? { ...draft, status, error } : draft)),
      }))
    },
  }
}

export const curriculumStore = createCurriculumStore()

if (browser) {
  curriculumStore.subscribe((state) => localStorage.setItem('curriculum-map-draft-v1', JSON.stringify(state)))
}

export function validateCurriculum(state: CurriculumState) {
  const issues: Array<{ id: string; severity: '错误' | '警告'; title: string; detail: string }> = []
  const outgoing = new Map<string, Mapping[]>()
  state.mappings.forEach((mapping) => outgoing.set(mapping.source, [...(outgoing.get(mapping.source) ?? []), mapping]))
  state.nodes.filter((node) => node.type === '毕业要求').forEach((node) => {
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
