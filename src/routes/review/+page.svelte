<script lang="ts">
  import { enhance } from '$app/forms'
  import type { ActionData } from './$types'
  import { curriculumStore } from '$lib/stores'
  let { form }: { form: ActionData } = $props()
  let selectedIds = $state<string[]>([])
  let reviewComments = $state<Record<string, string>>({})
  let guardNotice = $state<{ ok: boolean; text: string } | null>(null)
  let archiveRevision = $state('')

  const pending = $derived($curriculumStore.reviewItems.filter((item) => item.status === '待审阅'))
  const courseNames = $derived($curriculumStore.nodes.filter((node) => node.type === '课程'))
  const requirements = $derived($curriculumStore.nodes.filter((node) => node.type === '毕业要求'))
  const isReviewer = $derived($curriculumStore.actor.role === '院系审阅人')
  const archive = $derived($curriculumStore.lockedVersions.find((version) => version.revision === archiveRevision) ?? $curriculumStore.lockedVersions[0])

  // 服务端提交的修订并入本地队列，按 ID 去重，不会重复生成审阅记录
  $effect(() => {
    if (form?.success && form.item) curriculumStore.addReviewItem(form.item)
  })

  const isStale = (item: (typeof $curriculumStore.reviewItems)[number]) => item.baseRevision !== $curriculumStore.revision

  function show(outcome: { ok: boolean; message: string }) {
    guardNotice = { ok: outcome.ok, text: outcome.message }
  }

  function review(item: (typeof $curriculumStore.reviewItems)[number], status: '已附议' | '已退回') {
    show(curriculumStore.actOnReview(item.id, status, reviewComments[item.id] || (status === '已附议' ? '证据充分，同意纳入修订。' : '请补充可验证的评分记录。')))
  }

  function bulkApprove() {
    let okCount = 0
    const rejected: string[] = []
    selectedIds.forEach((id) => {
      const outcome = curriculumStore.actOnReview(id, '已附议', '批量附议：证据链完整。')
      if (outcome.ok) okCount += 1
      else rejected.push(id)
    })
    selectedIds = []
    guardNotice = rejected.length > 0
      ? { ok: false, text: `批量附议完成：${okCount} 项成功；${rejected.join('、')} 被拒绝（越权或基于旧版本）。` }
      : { ok: true, text: `批量附议完成：${okCount} 项已附议。` }
  }
</script>

<svelte:head><title>课程改革审阅</title></svelte:head>

<section class="page">
  <div class="page-head">
    <div><p class="eyebrow">REFORM REVIEW / 改革审阅</p><h1>修订提交与逐项审阅</h1><p class="muted">仅院系审阅人可附议或退回；映射变更后，基于旧版本的修订不能再附议。</p></div>
    <div class="actions"><span class="role-chip" class:warn={!isReviewer}>{$curriculumStore.actor.role} · {$curriculumStore.actor.name}</span><button class="btn-secondary" disabled={selectedIds.length === 0} onclick={bulkApprove}>批量附议 {selectedIds.length ? `(${selectedIds.length})` : ''}</button><button class="btn-secondary" onclick={() => window.print()}>打印审阅单</button></div>
  </div>

  {#if !isReviewer}
    <div class="notice error">当前身份为课程负责人，附议/退回属于越权操作，将被直接拒绝。可在侧边栏切换为院系审阅人。</div>
  {/if}
  {#if guardNotice}
    <div class="notice" class:error={!guardNotice.ok}>{guardNotice.text}</div>
  {/if}
  {#if form?.success}
    <div class="notice success">修订 {form.item?.id} 已提交（基于 {$curriculumStore.revision}），进入院系审阅队列。</div>
  {:else if form?.errors}
    <div class="notice error">表单未通过校验：{Object.values(form.errors).flat().join('；')}</div>
  {/if}

  <div class="review-layout">
    <section class="panel">
      <div class="panel-head"><h3>审阅队列</h3><span class="muted">{pending.length} 项待处理 · 当前版本 {$curriculumStore.revision}</span></div>
      <div class="review-list">
        {#each $curriculumStore.reviewItems as item}
          <article class:selected={selectedIds.includes(item.id)}>
            <div class="select"><input type="checkbox" checked={selectedIds.includes(item.id)} onchange={(event) => selectedIds = event.currentTarget.checked ? [...selectedIds, item.id] : selectedIds.filter((id) => id !== item.id)} /></div>
            <div class="review-main">
              <div class="review-title">
                <strong>{item.id} · {courseNames.find((node) => node.id === item.courseId)?.label.split('\n')[0]}</strong>
                <span class:approved={item.status === '已附议'} class:returned={item.status === '已退回'}>{item.status}</span>
              </div>
              <p>{item.evidence}</p>
              <small>对应 {requirements.find((node) => node.id === item.requirementId)?.label.split('\n')[0]} · {item.submitter} 提交 · 基于版本 {item.baseRevision}</small>
              {#if item.status === '待审阅' && isStale(item)}
                <div class="stale">基于旧版本 {item.baseRevision}，当前版本 {$curriculumStore.revision} 映射已变更，旧修订不能再附议。<button class="link" onclick={() => show(curriculumStore.rebaseReview(item.id))}>按当前版本重报</button></div>
              {/if}
              {#if item.status === '待审阅'}
                <div class="review-actions">
                  <input bind:value={reviewComments[item.id]} placeholder="填写附议或退回意见" />
                  <button class="btn-primary" onclick={() => review(item, '已附议')}>附议</button>
                  <button class="btn-danger" onclick={() => review(item, '已退回')}>退回补充</button>
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
      <form method="POST" action="?/submitRevision" use:enhance>
        <input type="hidden" name="baseRevision" value={$curriculumStore.revision} />
        <label>课程<select name="courseId">{#each courseNames as course}<option value={course.id}>{course.id} · {course.label.split('\n')[0]}</option>{/each}</select></label>
        <label>毕业要求<select name="requirementId">{#each requirements as requirement}<option value={requirement.id}>{requirement.id} · {requirement.label.split('\n')[0]}</option>{/each}</select></label>
        <label>证据说明<textarea name="evidence" rows="4" placeholder="说明教学活动、考核记录与达成证据"></textarea></label>
        <label>修订说明<textarea name="revisionNote" rows="3" placeholder="说明本轮为什么调整映射或证据"></textarea></label>
        <label>提交人<input name="submitter" placeholder="课程负责人姓名" /></label>
        <button class="btn-primary" type="submit">提交院系审阅</button>
      </form>
      <div class="version-compare">
        <strong>{$curriculumStore.revision} 对比 R11</strong>
        <div><span>C-308 → GR-03</span><b>权重 0.85 → 1.00</b></div>
        <div><span>新增考核证据</span><b>需求追踪矩阵</b></div>
        <div><span>GR-06 覆盖</span><b class="returned">证据待补充</b></div>
      </div>
    </aside>
  </div>

  <section class="panel archive">
    <div class="panel-head">
      <h3>锁定版本档案 · 考核证据查询</h3>
      <select bind:value={archiveRevision}>
        {#each $curriculumStore.lockedVersions as version}<option value={version.revision}>{version.revision} · 锁定于 {version.lockedAt}</option>{/each}
      </select>
    </div>
    {#if archive}
      <div class="archive-grid">
        <div>
          <h4>映射快照（{archive.mappings.length} 条）</h4>
          <div class="archive-list">
            {#each archive.mappings as mapping}
              <div><span>{mapping.source} → {mapping.target}</span><b class:exam={mapping.relation === '考核'}>{mapping.relation}</b><small>权重 {Math.round(mapping.weight * 100)}%</small></div>
            {/each}
          </div>
        </div>
        <div>
          <h4>考核证据（{archive.reviewItems.length} 条）</h4>
          <div class="archive-list">
            {#each archive.reviewItems as item}
              <div class="evidence"><span>{item.id} · {item.courseId} → {item.requirementId} · {item.status}</span><p>{item.evidence}</p><small>{item.comment}</small></div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </section>
</section>

<style>
  .actions { display: flex; align-items: center; gap: 8px; }
  .role-chip { padding: 7px 11px; border-radius: 999px; color: #2e6b5e; background: #e7f4ec; font-size: 11px; font-weight: 700; }
  .role-chip.warn { color: #a04a30; background: #fdf0ea; }
  .notice { margin-bottom: 12px; padding: 12px 14px; border-left: 3px solid #3f8869; color: #27634d; background: #ebf6f0; }
  .notice.error { border-color: #bd4d35; color: #913c2b; background: #fff1ec; }
  .review-layout { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; align-items: start; }
  .review-list { padding: 8px 16px 16px; }
  .review-list article { display: grid; grid-template-columns: 28px minmax(0,1fr); gap: 9px; padding: 14px 0; border-bottom: 1px solid #e8eded; }
  .review-list article.selected { background: #f4f8f7; }
  .review-title { display: flex; justify-content: space-between; gap: 10px; }
  .review-title span { padding: 3px 6px; border-radius: 5px; color: #9b5a25; background: #fff0de; font-size: 10px; }
  .review-title span.approved { color: #2e7359; background: #e7f4ec; }
  .review-title span.returned { color: #a94331; background: #ffebe6; }
  .review-main p { margin: 7px 0; color: #5f6e74; font-size: 12px; line-height: 1.55; }
  .review-main small { color: #839096; }
  .stale { margin-top: 8px; padding: 8px 10px; border-left: 3px solid #c98a2d; color: #8a5a1d; background: #fff6e6; font-size: 11px; }
  .stale .link { margin-left: 6px; padding: 0; border: 0; color: #2f6f72; background: none; font-size: 11px; font-weight: 700; text-decoration: underline; cursor: pointer; }
  .review-actions { display: flex; gap: 7px; margin-top: 10px; }
  .review-actions input { flex: 1; }
  .decision { margin-top: 9px; padding: 8px; color: #2f6f58; background: #edf7f1; font-size: 11px; }
  .decision.returned { color: #a54431; background: #fff0ec; }
  form { display: grid; gap: 12px; padding: 16px; }
  form button { margin-top: 3px; }
  .version-compare { margin: 0 16px 16px; padding: 12px; border: 1px solid #dbe3e3; border-radius: 8px; background: #f6f8f7; }
  .version-compare strong { display: block; margin-bottom: 9px; font-size: 12px; }
  .version-compare div { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; color: #66757b; font-size: 10px; }
  .version-compare b { color: #2e7359; }
  .version-compare b.returned { color: #aa4933; }
  .archive { margin-top: 14px; }
  .archive .panel-head select { max-width: 260px; }
  .archive-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px; }
  .archive-grid h4 { margin: 0 0 10px; font-size: 12px; }
  .archive-list { display: grid; gap: 7px; }
  .archive-list > div { display: grid; grid-template-columns: 1fr 60px 80px; gap: 10px; align-items: center; padding: 9px 10px; border: 1px solid #e3e9e9; border-radius: 7px; font-size: 11px; }
  .archive-list b { color: #2d7375; }
  .archive-list b.exam { color: #946436; }
  .archive-list small { color: #79868c; text-align: right; }
  .archive-list .evidence { grid-template-columns: 1fr; gap: 4px; }
  .archive-list .evidence p { margin: 0; color: #5f6e74; }
  .archive-list .evidence small { text-align: left; color: #2e7359; }
  @media (max-width: 1050px) { .review-layout { grid-template-columns: 1fr; } .archive-grid { grid-template-columns: 1fr; } }
</style>
