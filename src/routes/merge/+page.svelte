<script lang="ts">
  import { curriculumStore } from '$lib/stores'
  import { changeErrors } from '$lib/domain'
  import type { Mapping } from '$lib/seed'

  let notice = $state<{ ok: boolean; text: string } | null>(null)
  let source = $state('GR-01')
  let target = $state('C-205')
  let relation = $state<Mapping['relation']>('支撑')
  let weight = $state(0.8)
  let note = $state('')
  let resolutionComments = $state<Record<string, string>>({})

  const draft = $derived($curriculumStore.offlineDraft)
  const divergences = $derived($curriculumStore.divergences)
  const pendingCount = $derived(divergences.filter((item) => item.status === '待审阅').length)
  const isReviewer = $derived($curriculumStore.actor.role === '院系审阅人')

  function nodeLabel(id: string) {
    const node = $curriculumStore.nodes.find((item) => item.id === id)
    return node ? `${node.label.split('\n')[0]}（${id}）` : `${id}（未注册）`
  }

  function show(outcome: { ok: boolean; message: string }) {
    notice = { ok: outcome.ok, text: outcome.message }
  }

  function addChange() {
    curriculumStore.queueDraftChange({ source, target, relation, weight, note: note || '离线整理补充。' })
    note = ''
    notice = { ok: true, text: `已登记草稿修改 ${source} → ${target}，网络恢复后可并入院系版本。` }
  }

  function merge() {
    show(curriculumStore.mergeOfflineDraft())
  }
</script>

<svelte:head><title>离线草稿合并与分歧裁决</title></svelte:head>

<section class="page">
  <div class="page-head">
    <div>
      <p class="eyebrow">OFFLINE MERGE / 离线合并</p>
      <h1>离线草稿合并与分歧裁决</h1>
      <p class="muted">网络恢复后把离线草稿并入院系版本；冲突修改先登记为待审阅分歧，不盖掉已确认的毕业要求覆盖。</p>
    </div>
    <div class="actions">
      <span class="chip" class:offline={!$curriculumStore.online}>{$curriculumStore.online ? '网络在线' : '离线中'}</span>
      <span class="chip">{$curriculumStore.actor.role} · {$curriculumStore.actor.name}</span>
      <button class="btn-secondary" onclick={() => curriculumStore.setOnline(!$curriculumStore.online)}>{$curriculumStore.online ? '模拟断网' : '恢复网络'}</button>
    </div>
  </div>

  {#if notice}
    <div class="notice" class:error={!notice.ok}>{notice.text}</div>
  {/if}

  <div class="merge-layout">
    <div class="left-col">
      <section class="panel">
        <div class="panel-head">
          <h3>离线草稿 {#if draft}<span class="muted">{draft.id} · {draft.group}</span>{/if}</h3>
          {#if draft}<span class="status status-{draft.status}">{draft.status}</span>{/if}
        </div>
        {#if draft}
          <div class="draft-meta">
            <span>基于版本 <b>{draft.baseRevision}</b></span>
            <span>院系当前版本 <b>{$curriculumStore.revision}</b></span>
            <span>更新于 {draft.updatedAt}</span>
            <span>合并尝试 {draft.attempts} 次</span>
          </div>
          {#if draft.status === '合并失败'}
            <div class="notice error inline">合并失败：{draft.lastError} 原草稿与待处理项已保留，可修正后重试。</div>
          {/if}
          {#if draft.status === '已合并'}
            <div class="notice inline">草稿已并入院系版本，不会重复生成审阅记录。</div>
          {/if}
          <table>
            <thead><tr><th>映射修改</th><th>关系</th><th>权重</th><th>说明</th><th></th></tr></thead>
            <tbody>
              {#each draft.changes as change, index}
                {@const errors = changeErrors($curriculumStore.nodes, change)}
                <tr class:invalid={errors.length > 0}>
                  <td>
                    <strong>{change.source} → {change.target}</strong>
                    {#if errors.length > 0}<small class="error-text">{errors.join('；')}</small>{/if}
                  </td>
                  <td>{change.relation}</td>
                  <td>{Math.round(change.weight * 100)}%</td>
                  <td><small>{change.note}</small></td>
                  <td><button class="btn-danger" onclick={() => curriculumStore.removeDraftChange(index)}>删除</button></td>
                </tr>
              {/each}
              {#if draft.changes.length === 0}
                <tr><td colspan="5" class="empty">草稿暂无修改，可在下方登记离线整理结果。</td></tr>
              {/if}
            </tbody>
          </table>
          <div class="add-change">
            <select bind:value={source}>{#each $curriculumStore.nodes as node}<option value={node.id}>{node.id} · {node.label.split('\n')[0]}</option>{/each}</select>
            <span>→</span>
            <select bind:value={target}>{#each $curriculumStore.nodes as node}<option value={node.id}>{node.id} · {node.label.split('\n')[0]}</option>{/each}</select>
            <select bind:value={relation}><option>支撑</option><option>前置</option><option>教学</option><option>考核</option></select>
            <input bind:value={weight} type="number" min="0" max="1" step="0.05" />
            <input bind:value={note} placeholder="修改说明" />
            <button class="btn-secondary" onclick={addChange}>登记修改</button>
          </div>
          <div class="merge-bar">
            <button class="btn-primary" disabled={draft.changes.length === 0 || draft.status === '已合并'} onclick={merge}>
              {draft.status === '合并失败' ? '重试合并' : '合并到院系版本'}
            </button>
            <span class="muted">合并失败不会丢失草稿；重复合并按草稿 ID 去重。</span>
          </div>
        {:else}
          <div class="empty">暂无离线草稿。</div>
        {/if}
      </section>

      <section class="panel">
        <div class="panel-head"><h3>合并记录</h3><span class="muted">{$curriculumStore.mergeLog.length} 条</span></div>
        <div class="log-list">
          {#each $curriculumStore.mergeLog as entry}
            <article class:fail={!entry.ok}>
              <strong>{entry.ok ? '合并成功' : '合并失败'} · {entry.draftId}</strong>
              <p>{entry.message}</p>
              <small>{entry.at}</small>
            </article>
          {/each}
          {#if $curriculumStore.mergeLog.length === 0}<div class="empty">尚无合并记录。</div>{/if}
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h3>待审阅分歧</h3><span class="muted">{pendingCount} 条待裁决 · 院系审阅人逐条确认</span></div>
      {#if !isReviewer}
        <div class="notice error inline">当前身份为{$curriculumStore.actor.role}，裁决分歧属于越权操作，将被直接拒绝。</div>
      {/if}
      <div class="divergence-list">
        {#each divergences as divergence}
          <article class:resolved={divergence.status !== '待审阅'}>
            <div class="div-title">
              <strong>{nodeLabel(divergence.source)} → {nodeLabel(divergence.target)}</strong>
              <span class="status status-{divergence.status}">{divergence.status}</span>
            </div>
            <small class="muted">{divergence.id} · {divergence.group} 草稿 {divergence.draftId} 后到修改</small>
            <div class="version-compare">
              <div class="version confirmed">
                <b>院系已确认版</b>
                <span>{divergence.confirmed.relation} · 权重 {Math.round(divergence.confirmed.weight * 100)}%</span>
                <small>映射 {divergence.confirmed.id} · 覆盖受保护</small>
              </div>
              <div class="version incoming">
                <b>草稿后到版</b>
                <span>{divergence.incoming.relation} · 权重 {Math.round(divergence.incoming.weight * 100)}%</span>
                <small>{divergence.incoming.note}</small>
              </div>
            </div>
            {#if divergence.status === '待审阅'}
              <div class="div-actions">
                <input bind:value={resolutionComments[divergence.id]} placeholder="裁决意见（可选）" />
                <button class="btn-secondary" onclick={() => show(curriculumStore.resolveDivergence(divergence.id, 'keep', resolutionComments[divergence.id] ?? '保留院系已确认覆盖。'))}>保留院系版</button>
                <button class="btn-primary" onclick={() => show(curriculumStore.resolveDivergence(divergence.id, 'take', resolutionComments[divergence.id] ?? '证据充分，采用草稿版。'))}>采用草稿版</button>
              </div>
            {:else}
              <div class="decision">裁决意见:{divergence.comment || '—'}</div>
            {/if}
          </article>
        {/each}
        {#if divergences.length === 0}
          <div class="empty">暂无分歧。两个课程组修改同一对映射时，后到的修改会在这里等待裁决。</div>
        {/if}
      </div>
    </section>
  </div>
</section>

<style>
  .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .chip { padding: 6px 10px; border: 1px solid #c4d2d2; border-radius: 999px; color: #2f6f72; background: #eef6f5; font-size: 11px; font-weight: 700; }
  .chip.offline { border-color: #d9b8ac; color: #a04a30; background: #fdf0ea; }
  .notice { margin-bottom: 12px; padding: 12px 14px; border-left: 3px solid #3f8869; color: #27634d; background: #ebf6f0; }
  .notice.error { border-color: #bd4d35; color: #913c2b; background: #fff1ec; }
  .notice.inline { margin: 10px 16px 0; font-size: 12px; }
  .merge-layout { display: grid; grid-template-columns: minmax(0,1.2fr) minmax(0,1fr); gap: 14px; align-items: start; }
  .left-col { display: grid; gap: 14px; }
  .draft-meta { display: flex; flex-wrap: wrap; gap: 14px; padding: 12px 16px 0; color: #6a787e; font-size: 11px; }
  .draft-meta b { color: #2c4a52; }
  table { width: 100%; margin-top: 12px; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 9px 12px; border-top: 1px solid #e9eeee; text-align: left; vertical-align: top; }
  th { color: #7a878d; font-size: 11px; }
  tr.invalid td { background: #fff6f2; }
  td strong { display: block; }
  td small { color: #7c888e; }
  .error-text { display: block; margin-top: 3px; color: #b04a32; }
  .add-change { display: flex; align-items: center; gap: 7px; padding: 12px 16px; border-top: 1px solid #e9eeee; }
  .add-change select { max-width: 170px; }
  .add-change input[type='number'] { max-width: 74px; }
  .merge-bar { display: flex; align-items: center; gap: 12px; padding: 0 16px 16px; }
  .merge-bar .muted { font-size: 11px; }
  .status { padding: 3px 8px; border-radius: 5px; font-size: 10px; font-weight: 700; }
  .status-待合并, .status-编辑中, .status-待审阅 { color: #9b5a25; background: #fff0de; }
  .status-合并失败 { color: #a94331; background: #ffebe6; }
  .status-已合并, .status-已采用草稿版 { color: #2e7359; background: #e7f4ec; }
  .status-已保留院系版 { color: #4a6a7d; background: #e9f1f5; }
  .log-list { padding: 8px 16px 16px; }
  .log-list article { padding: 10px 0; border-bottom: 1px solid #edf1f1; }
  .log-list strong { color: #2e6b5e; font-size: 12px; }
  .log-list article.fail strong { color: #a9442f; }
  .log-list p { margin: 4px 0; color: #64727a; font-size: 11px; line-height: 1.5; }
  .log-list small { color: #8b979c; font-size: 10px; }
  .divergence-list { padding: 8px 16px 16px; }
  .divergence-list article { padding: 14px 0; border-bottom: 1px solid #e8eded; }
  .divergence-list article.resolved { opacity: .75; }
  .div-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .div-title strong { font-size: 13px; }
  .version-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
  .version { padding: 10px; border: 1px solid #e0e7e7; border-radius: 7px; background: #f7f9f9; }
  .version.confirmed { border-left: 3px solid #4a7a8c; }
  .version.incoming { border-left: 3px solid #cd813a; background: #fffaf3; }
  .version b, .version span, .version small { display: block; }
  .version b { font-size: 11px; }
  .version span { margin: 4px 0; font-size: 12px; font-weight: 700; }
  .version small { color: #7c888e; font-size: 10px; }
  .div-actions { display: flex; gap: 7px; margin-top: 10px; }
  .div-actions input { flex: 1; }
  .decision { margin-top: 9px; padding: 8px; color: #2f6f58; background: #edf7f1; font-size: 11px; }
  .empty { padding: 18px 16px; color: #7c888e; font-size: 12px; }
  button:disabled { cursor: not-allowed; opacity: .5; }
  @media (max-width: 1050px) { .merge-layout { grid-template-columns: 1fr; } }
</style>
