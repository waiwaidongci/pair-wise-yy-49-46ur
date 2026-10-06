<script lang="ts">
  import { enhance } from '$app/forms'
  import { createQuery, useQueryClient } from '@tanstack/svelte-query'
  import { browser } from '$app/environment'
  import { curriculumStore } from '$lib/stores'
  import { canReview } from '$lib/collab'
  import type { Divergence, EvidenceRecord, GraphNode, Mapping, MergeRecord, OfflineDraft, ReviewItem } from '$lib/seed'

  type CurriculumResponse = {
    nodes: GraphNode[]
    mappings: Mapping[]
    reviewItems: ReviewItem[]
    divergences: Divergence[]
    evidence: EvidenceRecord[]
    mergeRecords: MergeRecord[]
    revision: string
    locked: boolean
    updatedAt: string
  }

  const queryClient = useQueryClient()
  const query = createQuery<CurriculumResponse>(() => ({
    queryKey: ['curriculum'],
    enabled: browser,
    queryFn: async () => (await fetch('/api/curriculum')).json(),
  }))

  let reviewComments = $state<Record<string, string>>({})
  let notice = $state<{ type: 'success' | 'error'; text: string } | null>(null)
  let expandedRevision = $state<string | null>(null)

  const role = $derived($curriculumStore.role)
  const reviewer = $derived(canReview(role))
  const nodes = $derived($curriculumStore.nodes)
  const courseNames = $derived(nodes.filter((node) => node.type === '课程'))
  const requirements = $derived(nodes.filter((node) => node.type === '毕业要求'))

  const reviewItems = $derived(query.data?.reviewItems ?? $curriculumStore.reviewItems)
  const divergences = $derived(query.data?.divergences ?? $curriculumStore.divergences)
  const evidence = $derived(query.data?.evidence ?? $curriculumStore.evidence)
  const mergeRecords = $derived(query.data?.mergeRecords ?? $curriculumStore.mergeRecords)
  const revision = $derived(query.data?.revision ?? $curriculumStore.revision)
  const locked = $derived(query.data?.locked ?? $curriculumStore.locked)

  const pendingDrafts = $derived($curriculumStore.drafts.filter((draft) => draft.status !== '已合并'))
  const pendingDivergences = $derived(divergences.filter((item) => item.status === '待审阅'))
  const decidedDivergences = $derived(divergences.filter((item) => item.status !== '待审阅'))
  const pendingReviews = $derived(reviewItems.filter((item) => item.status === '待审阅'))

  const evidenceByRevision = $derived(
    evidence.reduce<Record<string, EvidenceRecord[]>>((groups, record) => {
      ;(groups[record.revision] ??= []).push(record)
      return groups
    }, {}),
  )

  function nodeName(id: string): string {
    return nodes.find((node) => node.id === id)?.label.split('\n')[0] ?? id
  }

  async function mergeDraft(draft: OfflineDraft) {
    notice = null
    const response = await fetch('/api/curriculum/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    const result = await response.json()
    if (result.ok) {
      curriculumStore.updateDraftStatus(draft.id, '已合并')
      await queryClient.invalidateQueries({ queryKey: ['curriculum'] })
      notice = result.duplicated
        ? { type: 'success', text: `草稿 ${draft.id} 已合并过（幂等），未重复生成审阅记录；当前 ${result.divergences.length} 项分歧待审阅。` }
        : { type: 'success', text: `草稿 ${draft.id} 合并完成：并入 ${result.mergedCount} 条新映射，生成 ${result.divergences.length} 项待审阅分歧。` }
    } else {
      curriculumStore.updateDraftStatus(draft.id, '合并失败', result.error)
      notice = { type: 'error', text: `草稿 ${draft.id} 合并失败：${result.error}。原草稿与待处理项已保留，可重试。` }
    }
  }

  async function resolveDivergence(divergenceId: string, keep: 'draft' | 'department') {
    notice = null
    const response = await fetch('/api/curriculum/divergences/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ divergenceId, keep, role }),
    })
    const result = await response.json()
    if (result.ok) {
      await queryClient.invalidateQueries({ queryKey: ['curriculum'] })
      notice = { type: 'success', text: `分歧 ${divergenceId} 已确认保留${keep === 'draft' ? '草稿版' : '院系版'}，覆盖矩阵与缺口提示已重算。` }
    } else {
      notice = { type: 'error', text: result.error }
    }
  }

  async function decideReview(item: ReviewItem, status: '已附议' | '已退回') {
    notice = null
    const response = await fetch('/api/curriculum/review/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: item.id, status, comment: reviewComments[item.id] ?? '', role }),
    })
    const result = await response.json()
    if (result.ok) {
      await queryClient.invalidateQueries({ queryKey: ['curriculum'] })
      notice = { type: 'success', text: `修订 ${item.id} 已${status}。` }
    } else {
      notice = { type: 'error', text: result.error }
    }
  }

  function approveTitle(item: ReviewItem): string {
    if (!reviewer) return '越权拒绝：仅院系审阅人可附议'
    if (item.status !== '待审阅') return '旧修订不能再附议'
    if (item.revisionId !== revision) return `旧修订不能再附议：该修订属于已锁定版本 ${item.revisionId}`
    return '附议该修订'
  }
</script>

<svelte:head><title>课程改革审阅</title></svelte:head>

<section class="page">
  <div class="page-head">
    <div><p class="eyebrow">REFORM REVIEW / 改革审阅</p><h1>离线草稿合并与分歧审阅</h1><p class="muted">课程负责人离线整理后合并草稿；两个课程组修改同一对映射时，后到内容先作为待审阅分歧，不盖已确认覆盖。</p></div>
    <div class="role-chip">当前身份：<strong>{role}</strong>{#if locked}<span class="lock-badge">版本已锁定</span>{/if}</div>
  </div>

  {#if notice}
    <div class="notice {notice.type}">{notice.text}</div>
  {/if}

  {#if !reviewer}
    <div class="notice error">当前为课程负责人身份：可合并离线草稿、提交修订；附议与分歧确认需切换为「院系审阅人」，越权附议将被直接拒绝。</div>
  {/if}

  <div class="panel">
    <div class="panel-head"><h3>离线草稿（网络恢复后合并）</h3><span class="muted">{pendingDrafts.length} 份待合并 · 合并失败可重试，不重复生成审阅记录</span></div>
    <div class="draft-list">
      {#each pendingDrafts as draft}
        <article class:draft-failed={draft.status === '合并失败'}>
          <div class="draft-head">
            <strong>{draft.courseGroup} · {draft.id}</strong>
            <span class="draft-status status-{draft.status}">{draft.status}</span>
          </div>
          <p class="draft-note">{draft.note}</p>
          <div class="draft-changes">
            {#each draft.changes as change}
              <div><span>{nodeName(change.source)} → {nodeName(change.target)}</span><b>{change.relation}</b><small>权重 {Math.round(change.weight * 100)}%</small></div>
            {/each}
          </div>
          {#if draft.error}<div class="draft-error">上次合并失败：{draft.error}</div>{/if}
          <div class="draft-actions">
            <button class="btn-primary" onclick={() => mergeDraft(draft)}>{draft.status === '合并失败' ? '重试合并' : '网络恢复 · 合并草稿'}</button>
            <span class="muted">基于 {draft.baseRevision} · {draft.owner} 整理</span>
          </div>
        </article>
      {/each}
      {#if pendingDrafts.length === 0}<div class="empty">没有待合并的离线草稿。</div>{/if}
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h3>待审阅分歧（后到内容）</h3><span class="muted">{pendingDivergences.length} 项待逐条确认保留哪一版</span></div>
    <div class="draft-list">
      {#each pendingDivergences as divergence}
        <article class="divergence">
          <div class="draft-head">
            <strong>{nodeName(divergence.source)} → {nodeName(divergence.target)} <span class="muted">({divergence.relation})</span></strong>
            <span class="draft-status status-待审阅">待审阅分歧</span>
          </div>
          <div class="divergence-grid">
            <div class="divergence-col">
              <h4>院系版本（已确认覆盖）</h4>
              <div class="mapping-row dept"><span>权重 {Math.round(divergence.departmentMapping.weight * 100)}%</span><small>{divergence.departmentMapping.id}</small></div>
            </div>
            <div class="divergence-col">
              <h4>草稿后到内容（{divergence.draftId}）</h4>
              <div class="mapping-row draft"><span>权重 {Math.round(divergence.draftMapping.weight * 100)}%</span><small>{divergence.draftMapping.id}</small></div>
            </div>
          </div>
          <div class="draft-actions">
            <button class="btn-secondary" disabled={!reviewer} title={reviewer ? '保留草稿版，覆盖矩阵与缺口提示重算' : '越权拒绝：仅院系审阅人可确认'} onclick={() => resolveDivergence(divergence.id, 'draft')}>保留草稿版</button>
            <button class="btn-primary" disabled={!reviewer} title={reviewer ? '保留院系版，不覆盖已确认覆盖' : '越权拒绝：仅院系审阅人可确认'} onclick={() => resolveDivergence(divergence.id, 'department')}>保留院系版</button>
            {#if !reviewer}<span class="muted">仅院系审阅人可确认保留版本</span>{/if}
          </div>
        </article>
      {/each}
      {#if pendingDivergences.length === 0}<div class="empty">没有待审阅分歧。两个课程组修改同一对映射时，后到内容会先进入这里。</div>{/if}
    </div>
  </div>

  <div class="review-layout">
    <section class="panel">
      <div class="panel-head"><h3>审阅队列</h3><span class="muted">{pendingReviews.length} 项待处理 · 旧修订不可再附议</span></div>
      <div class="review-list">
        {#each reviewItems as item}
          <article class:selected={item.status === '待审阅'}>
            <div class="review-main">
              <div class="review-title">
                <strong>{item.id} · {nodeName(item.courseId)}</strong>
                <span class:approved={item.status === '已附议'} class:returned={item.status === '已退回'}>{item.status}</span>
              </div>
              <p>{item.evidence}</p>
              <small>对应 {nodeName(item.requirementId)} · {item.submitter} 提交 · 修订 {item.revisionId}</small>
              {#if item.status === '待审阅'}
                <div class="review-actions">
                  <input bind:value={reviewComments[item.id]} placeholder="填写附议或退回意见" />
                  <button class="btn-primary" disabled={!reviewer || item.revisionId !== revision} title={approveTitle(item)} onclick={() => decideReview(item, '已附议')}>附议</button>
                  <button class="btn-danger" disabled={!reviewer || item.revisionId !== revision} title={!reviewer ? '越权拒绝：仅院系审阅人可退回' : item.revisionId !== revision ? '旧修订不能再附议' : '退回补充' } onclick={() => decideReview(item, '已退回')}>退回补充</button>
                </div>
              {:else}
                <div class:returned={item.status === '已退回'} class="decision">审阅意见：{item.comment}</div>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    </section>

    <aside class="panel">
      <div class="panel-head"><h3>提交课程修订</h3><span class="muted">服务端校验</span></div>
      <form method="POST" action="?/submitRevision" use:enhance={() => async ({ update, result }) => {
        await update()
        await queryClient.invalidateQueries({ queryKey: ['curriculum'] })
        const data = (result?.type === 'success' || result?.type === 'failure' ? result.data : {}) as { success?: boolean; item?: { id: string }; errors?: Record<string, string[]> }
        if (data.success) notice = { type: 'success', text: `修订 ${data.item?.id} 已提交，进入院系审阅队列。` }
        else if (data.errors) notice = { type: 'error', text: '表单未通过校验：' + Object.values(data.errors).flat().join('；') }
      }}>
        <label>课程<select name="courseId">{#each courseNames as course}<option value={course.id}>{course.id} · {course.label.split('\n')[0]}</option>{/each}</select></label>
        <label>毕业要求<select name="requirementId">{#each requirements as requirement}<option value={requirement.id}>{requirement.id} · {requirement.label.split('\n')[0]}</option>{/each}</select></label>
        <label>证据说明<textarea name="evidence" rows="4" placeholder="说明教学活动、考核记录与达成证据"></textarea></label>
        <label>修订说明<textarea name="revisionNote" rows="3" placeholder="说明本轮为什么调整映射或证据"></textarea></label>
        <label>提交人<input name="submitter" placeholder="课程负责人姓名" /></label>
        <button class="btn-primary" type="submit">提交院系审阅</button>
      </form>
      <div class="version-compare">
        <strong>当前版本 {revision}{#if locked} · 已锁定{/if}</strong>
        <div><span>待审阅分歧</span><b>{pendingDivergences.length} 项</b></div>
        <div><span>待审阅修订</span><b>{pendingReviews.length} 项</b></div>
      </div>
    </aside>
  </div>

  <div class="panel">
    <div class="panel-head"><h3>已锁定版本考核证据</h3><span class="muted">版本锁定后证据照旧可查</span></div>
    <div class="evidence-list">
      {#each Object.entries(evidenceByRevision) as [revisionKey, records]}
        <article>
          <button class="evidence-toggle" onclick={() => (expandedRevision = expandedRevision === revisionKey ? null : revisionKey)}>
            <strong>{revisionKey}</strong><span class="muted">{records.length} 条证据 · {expandedRevision === revisionKey ? '收起' : '展开'}</span>
          </button>
          {#if expandedRevision === revisionKey}
            <div class="evidence-rows">
              {#each records as record}
                <div>
                  <span>{nodeName(record.courseId)} → {nodeName(record.requirementId)}</span>
                  <p>{record.evidence}</p>
                  <small>{record.status}{record.decidedAt ? ` · ${record.decidedAt.slice(0, 10)}` : ''}</small>
                </div>
              {/each}
            </div>
          {/if}
        </article>
      {/each}
      {#if Object.keys(evidenceByRevision).length === 0}<div class="empty">暂无已锁定版本证据。</div>{/if}
    </div>
  </div>

  {#if decidedDivergences.length > 0}
    <div class="panel">
      <div class="panel-head"><h3>已处理分歧</h3><span class="muted">{decidedDivergences.length} 项</span></div>
      <div class="review-list">
        {#each decidedDivergences as divergence}
          <article>
            <div class="review-main">
              <div class="review-title">
                <strong>{divergence.id} · {nodeName(divergence.source)} → {nodeName(divergence.target)}</strong>
                <span class:approved={divergence.status === '已保留草稿'} class:returned={divergence.status === '已保留院系版'}>{divergence.status}</span>
              </div>
              <small>裁决人 {divergence.decidedBy} · {divergence.decidedAt?.slice(0, 16)}</small>
            </div>
          </article>
        {/each}
      </div>
    </div>
  {/if}

  {#if mergeRecords.length > 0}
    <div class="panel">
      <div class="panel-head"><h3>合并记录</h3><span class="muted">幂等：同一草稿只生成一条记录</span></div>
      <div class="review-list">
        {#each mergeRecords as record}
          <article>
            <div class="review-main">
              <div class="review-title">
                <strong>{record.id} · {record.courseGroup}</strong>
                <span class:approved={record.status === '已合并'} class:returned={record.status === '待审阅分歧'}>{record.status}</span>
              </div>
              <small>基于 {record.baseRevision} · 并入 {record.mergedCount} 条新映射 · {record.createdAt.slice(0, 16)}</small>
            </div>
          </article>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .role-chip { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid #d5e0df; border-radius: 8px; background: #f6faf9; font-size: 12px; color: #5c6d72; }
  .role-chip strong { color: #2f6f72; }
  .lock-badge { padding: 3px 7px; border-radius: 5px; color: #8a5a25; background: #fff0de; font-size: 10px; }
  .notice { margin-bottom: 12px; padding: 12px 14px; border-left: 3px solid #3f8869; color: #27634d; background: #ebf6f0; }
  .notice.error { border-color: #bd4d35; color: #913c2b; background: #fff1ec; }
  .panel { margin-bottom: 14px; }
  .draft-list { padding: 8px 16px 16px; display: grid; gap: 12px; }
  .draft-list article { padding: 14px; border: 1px solid #e2e9e8; border-radius: 8px; background: #fbfcfc; }
  .draft-list article.draft-failed { border-color: #d9a394; background: #fdf6f3; }
  .draft-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .draft-head strong { font-size: 13px; }
  .draft-status { padding: 3px 7px; border-radius: 5px; font-size: 10px; background: #eef1f1; color: #6b7a7f; }
  .status-离线 { background: #e7f0f2; color: #3d6b75; }
  .status-合并失败 { background: #ffe9e2; color: #a54431; }
  .status-已合并 { background: #e7f4ec; color: #2e7359; }
  .status-待审阅 { background: #fff0de; color: #9b5a25; }
  .draft-note { margin: 8px 0; color: #66757b; font-size: 12px; line-height: 1.55; }
  .draft-changes { display: grid; gap: 6px; }
  .draft-changes > div { display: grid; grid-template-columns: 1fr 70px 90px; gap: 8px; padding: 8px 10px; border: 1px solid #e0e6e6; border-radius: 6px; background: white; font-size: 12px; }
  .draft-changes b { color: #2d7375; }
  .draft-changes small { color: #79868c; }
  .draft-error { margin-top: 8px; padding: 8px 10px; border-left: 3px solid #bd4d35; color: #913c2b; background: #fff1ec; font-size: 11px; }
  .draft-actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .draft-actions .muted { font-size: 11px; }
  .empty { padding: 22px 0; color: #3d7b63; font-size: 12px; }
  .divergence { border-left: 3px solid #cd813a !important; }
  .divergence-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
  .divergence-col h4 { margin: 0 0 6px; font-size: 11px; color: #7c6a55; }
  .mapping-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: 6px; font-size: 12px; }
  .mapping-row.dept { background: #eef4f3; color: #2f6f72; }
  .mapping-row.draft { background: #fff4e6; color: #9b6a2f; }
  .mapping-row small { color: #8a979c; font-size: 10px; }
  .review-layout { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; align-items: start; }
  .review-list { padding: 8px 16px 16px; }
  .review-list article { display: grid; grid-template-columns: minmax(0,1fr); gap: 9px; padding: 14px 0; border-bottom: 1px solid #e8eded; }
  .review-title { display: flex; justify-content: space-between; gap: 10px; }
  .review-title span { padding: 3px 6px; border-radius: 5px; color: #9b5a25; background: #fff0de; font-size: 10px; }
  .review-title span.approved { color: #2e7359; background: #e7f4ec; }
  .review-title span.returned { color: #a94331; background: #ffebe6; }
  .review-main p { margin: 7px 0; color: #5f6e74; font-size: 12px; line-height: 1.55; }
  .review-main small { color: #839096; }
  .review-actions { display: flex; gap: 7px; margin-top: 10px; }
  .review-actions input { flex: 1; }
  .review-actions button:disabled { opacity: .5; cursor: not-allowed; }
  .decision { margin-top: 9px; padding: 8px; color: #2f6f58; background: #edf7f1; font-size: 11px; }
  .decision.returned { color: #a54431; background: #fff0ec; }
  form { display: grid; gap: 12px; padding: 16px; }
  form button { margin-top: 3px; }
  .version-compare { margin: 0 16px 16px; padding: 12px; border: 1px solid #dbe3e3; border-radius: 8px; background: #f6f8f7; }
  .version-compare strong { display: block; margin-bottom: 9px; font-size: 12px; }
  .version-compare div { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; color: #66757b; font-size: 10px; }
  .version-compare b { color: #2e7359; }
  .evidence-list { padding: 8px 16px 16px; display: grid; gap: 8px; }
  .evidence-list article { border: 1px solid #e2e9e8; border-radius: 8px; background: #fbfcfc; overflow: hidden; }
  .evidence-toggle { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: 12px 14px; border: 0; background: transparent; cursor: pointer; font: inherit; }
  .evidence-toggle strong { font-size: 13px; color: #2f6f72; }
  .evidence-rows { display: grid; gap: 8px; padding: 0 14px 12px; }
  .evidence-rows > div { padding: 10px; border-left: 3px solid #377d7a; background: #f6f8f7; }
  .evidence-rows span { font-size: 12px; font-weight: 700; color: #2d5d61; }
  .evidence-rows p { margin: 5px 0; color: #66757b; font-size: 11px; line-height: 1.55; }
  .evidence-rows small { color: #946436; font-size: 10px; }
  @media (max-width: 1050px) { .review-layout { grid-template-columns: 1fr; } .divergence-grid { grid-template-columns: 1fr; } }
</style>
