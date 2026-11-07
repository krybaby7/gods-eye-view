import {
  MAX_SEARCH_QUESTION,
  askDisabledReason,
  elapsedTime,
  formatRunUsage,
  formatSearchDay,
  groupSearches,
  searchFindingSections,
} from './searchesPanelModel.js';
import { FINDING_BASIS } from '../layers/searches/records.js';
import { NEWS_VERIFICATION_LABELS } from '../layers/news/records.js';

const PANEL_ID = 'searches-panel';
const appearedDocuments = new WeakSet();
const kinds = {
  event: ['●', 'Event'],
  statement: ['■', 'Statement'],
  place: ['◆', 'Place'],
  area: ['◯', 'Area'],
};
const dateTime = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function formatTime(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return isoDay.test(value) ? formatSearchDay(value) : dateTime.format(time);
}

function sourceUrl(value) {
  try {
    const url = new URL(value);
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    // A malformed evidence URL is displayed as text.
  }
  return null;
}

export function createSearchesPanel(container, { layer, onOpenWarStory } = {}) {
  const document = container.ownerDocument;
  const panel = container.closest('#searches-panel');
  const count = panel?.querySelector('#searches-panel-count');
  const collapse = panel?.querySelector(
    '[data-collapse-target="searches-panel"]',
  );
  let snapshot = layer.getSnapshot();
  let destroyed = false;
  let timer;
  let asking = false;
  let error = '';
  let historyPending = false;
  let filter = '';
  const opened = new Set();
  const openedFindings = new Set();
  const openMenus = new Set();
  const showQuestions = new Set();
  const renames = new Map();
  const comparisons = new Map();
  const confirming = new Set();
  const pending = new Set();
  let activeSearch;

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    node.append(...children.flat().filter((child) => child != null));
    return node;
  }

  const keyed = (id, control) => JSON.stringify([id, control]);
  function button(label, onclick, attrs = {}) {
    return h('button', {
      type: 'button',
      class: 'panel-surface-control',
      text: label,
      onclick,
      ...attrs,
    });
  }
  function row(...children) {
    return h('div', { class: 'searches-controls' }, ...children);
  }
  function note(text, className = 'searches-note') {
    return h('p', { class: className, text });
  }
  function option(value, text) {
    return h('option', { value, text });
  }
  function toggle(set, key) {
    if (!set.delete(key)) set.add(key);
    renderList();
  }
  function isHistory() {
    return Boolean(snapshot.asOf || snapshot.selectedRun);
  }

  const question = h('textarea', {
    rows: 2,
    class: 'panel-surface-control searches-question',
    placeholder: 'Ask about news, people, or places',
    'aria-label': 'Search question',
    'aria-describedby': 'searches-ask-reason',
    oninput: renderAsk,
    onkeydown: (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      void ask();
    },
  });
  const agent = h(
    'select',
    { class: 'panel-surface-control', 'aria-label': 'Search agent' },
    option('claude', 'Claude'),
  );
  const submit = button('Ask', null, { type: 'submit' });
  const askReason = h('p', {
    id: 'searches-ask-reason',
    class: 'searches-note',
    role: 'status',
  });
  const usage = note('');
  const stage = h('span', { role: 'status' });
  const elapsed = h('span', { 'aria-hidden': 'true' });
  const cancelRun = button('Cancel', () => {
    if (!activeSearch) return;
    const { id } = activeSearch;
    void runAction(keyed(id, 'cancel'), () => layer.action('cancel', { id }));
  });
  const runningLine = row(h('span', {}, stage, elapsed), cancelRun);
  const form = h(
    'form',
    {
      class: 'searches-form',
      onsubmit: (event) => {
        event.preventDefault();
        void ask();
      },
    },
    question,
    row(agent, submit),
    askReason,
    runningLine,
    usage,
  );
  const day = h('select', {
    class: 'panel-surface-control',
    'aria-label': 'Search history day',
    onchange: () => void changeHistory(() => layer.setDay(day.value || null)),
  });
  const textFilter = h('input', {
    class: 'panel-surface-control',
    type: 'search',
    'aria-label': 'Filter searches',
    placeholder: 'Filter searches',
    oninput: () => {
      filter = textFilter.value;
      renderList();
    },
  });
  const historyBar = h('div', { class: 'searches-controls' });
  const placeBar = h('div', { class: 'searches-controls' });
  const message = h('p', { class: 'panel-surface-error', role: 'status' });
  const reload = button('Retry loading searches', () =>
    runAction('refresh', () => layer.refresh()),
  );
  const list = h('div', { class: 'searches-list' });
  const root = h(
    'div',
    { class: 'searches-panel-root' },
    form,
    row(day, textFilter),
    historyBar,
    placeBar,
    message,
    reload,
    list,
  );
  container.append(root);

  function renderAsk() {
    const reason = askDisabledReason(question.value, snapshot.agents?.claude, {
      pending: asking,
      history: isHistory(),
    });
    submit.disabled = Boolean(reason);
    askReason.hidden = !reason;
    if (askReason.textContent !== reason) askReason.textContent = reason;
    const overLimit = question.value.trim().length > MAX_SEARCH_QUESTION;
    question.setAttribute('aria-invalid', String(overLimit));
  }

  async function ask() {
    const text = question.value.trim();
    if (submit.disabled || asking || destroyed) return;
    asking = true;
    error = '';
    renderAsk();
    renderMessage();
    try {
      const result = await layer.ask(text, { agent: agent.value });
      if (destroyed) return;
      if (question.value.trim() === text) question.value = '';
      if (result?.id) {
        opened.add(result.id);
        if (filter) {
          filter = '';
          textFilter.value = '';
        }
      }
    } catch (failure) {
      error = failure.message || 'Could not start search.';
    } finally {
      asking = false;
      if (!destroyed) render();
    }
  }

  function renderMessage() {
    const text = error || snapshot.error?.message || snapshot.error || '';
    if (message.textContent !== text) message.textContent = text;
    message.hidden = !text;
    reload.hidden = !snapshot.error;
    reload.disabled = pending.has('refresh');
  }

  async function runAction(key, operation) {
    if (pending.has(key) || destroyed) return false;
    const priorFocus = document.activeElement?.dataset.searchFocus;
    pending.add(key);
    error = '';
    renderMessage();
    renderList();
    try {
      await operation();
      return true;
    } catch (failure) {
      error = failure.message || 'Search action failed.';
      return false;
    } finally {
      pending.delete(key);
      if (!destroyed) {
        renderMessage();
        renderList();
        if (priorFocus && document.activeElement === document.body)
          focusControl(priorFocus);
      }
    }
  }

  async function changeHistory(operation) {
    if (historyPending) return;
    historyPending = true;
    try {
      await runAction('history', operation);
    } finally {
      historyPending = false;
      if (!destroyed) render();
    }
  }

  function backToNow() {
    void changeHistory(() => layer.setDay(null));
  }

  function patch(search, fields, key = 'patch') {
    return runAction(keyed(search.id, key), () =>
      layer.action('patch', { id: search.id, ...fields }),
    );
  }

  function evidence(ids, sources, owner, compact = false) {
    const items = (ids || []).flatMap((id) => {
      const source = sources.get(id);
      if (!source) return [];
      const href = sourceUrl(source.url || source.canonicalUrl);
      const publisher = source.publisher || source.domain || 'Source';
      const checked = source.checkedBy === 'fetch';
      const description = [
        publisher,
        formatTime(source.date),
        source.title,
        checked ? 'Checked by fetch' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const label = compact ? publisher : description;
      return [
        href
          ? h('a', {
              class: 'searches-evidence',
              href,
              target: '_blank',
              rel: 'noopener noreferrer',
              title: description,
              'aria-label': description,
              text: label,
              'data-search-focus': keyed(owner, id),
            })
          : h('span', { class: 'searches-evidence', text: label }),
      ];
    });
    return items.length
      ? h('div', { class: 'searches-controls' }, items)
      : null;
  }

  function confirmation(label, key, action, focusKey) {
    return h(
      'div',
      { class: 'searches-confirm' },
      note(label),
      row(
        button('Delete', action, {
          disabled: pending.has(key),
          'data-search-focus': keyed(key, 'confirm'),
        }),
        button(
          'Keep',
          () => {
            toggle(confirming, key);
            focusControl(focusKey);
          },
          { 'data-search-focus': keyed(key, 'keep') },
        ),
      ),
    );
  }

  function findingRow(search, finding, sources, earlier) {
    const key = keyed(search.id, finding.id);
    const [icon, kind] = kinds[finding.kind] || ['•', 'Finding'];
    const isOpen = openedFindings.has(key);
    const selected =
      snapshot.selected?.searchId === search.id &&
      snapshot.selected?.findingId === finding.id;
    const onGlobe = Boolean(finding.location && search.visible && !earlier);
    const place =
      finding.location?.name || finding.place?.name || finding.hotspot?.label;
    const certainty = ['event', 'statement'].includes(finding.kind)
      ? NEWS_VERIFICATION_LABELS[finding.verification] ||
        NEWS_VERIFICATION_LABELS.reported
      : `${finding.sourceCount ?? finding.sourceIds?.length ?? 0} sources`;
    const details = [
      kind,
      place,
      formatTime(finding.eventAt),
      certainty,
      earlier && finding.lastSeenAt
        ? `Not seen since ${formatTime(finding.lastSeenAt)}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const titleKey = keyed(key, 'title');
    const title = button(finding.title, () => toggle(openedFindings, key), {
      class: 'panel-surface-control searches-finding-title',
      'aria-expanded': String(isOpen),
      'data-search-focus': titleKey,
    });
    title.prepend(h('span', { 'aria-hidden': 'true', text: `${icon} ` }));
    if (finding.fresh && !earlier)
      title.append(h('span', { class: 'searches-new', text: 'New' }));
    const deleteKey = keyed(key, 'delete');
    const basis = FINDING_BASIS[finding.place?.basis];
    return h(
      'li',
      {
        class: `searches-finding${selected ? ' searches-selected' : ''}${finding.location?.method === 'model' ? ' searches-model-placed' : ''}`,
      },
      title,
      note(details),
      finding.alsoIn?.length
        ? note(`Also in ${finding.alsoIn.map(({ label }) => label).join(', ')}`)
        : null,
      isOpen
        ? h(
            'div',
            { class: 'searches-finding-detail' },
            note(finding.summary || ''),
            note(
              basis ||
                (finding.location
                  ? 'Placement basis unavailable'
                  : 'No reliable placement'),
            ),
            evidence(finding.sourceIds, sources, key),
            (finding.warMonitor || []).map((story) =>
              onOpenWarStory
                ? button(
                    `Also in the War Monitor · ${story.title}`,
                    () =>
                      runAction(keyed(key, story.id), () =>
                        onOpenWarStory(story),
                      ),
                    {
                      disabled: pending.has(keyed(key, story.id)),
                      'data-search-focus': keyed(key, story.id),
                    },
                  )
                : note(`Also in the War Monitor · ${story.title}`),
            ),
            row(
              onGlobe
                ? button(
                    'Show on globe',
                    () =>
                      layer.selectFinding(search.id, finding.id, {
                        focus: true,
                      }),
                    {
                      'data-search-focus': keyed(key, 'map'),
                    },
                  )
                : null,
              !isHistory()
                ? button(
                    'Delete finding',
                    () => {
                      toggle(confirming, deleteKey);
                      if (confirming.has(deleteKey))
                        focusControl(keyed(deleteKey, 'keep'));
                    },
                    {
                      'aria-expanded': String(confirming.has(deleteKey)),
                      'data-search-focus': deleteKey,
                    },
                  )
                : null,
            ),
            confirming.has(deleteKey) && !isHistory()
              ? confirmation(
                  'Delete this finding from every run?',
                  deleteKey,
                  async () => {
                    const done = await runAction(deleteKey, () =>
                      layer.action('deleteFinding', {
                        id: search.id,
                        findingId: finding.id,
                      }),
                    );
                    if (done && !destroyed) {
                      confirming.delete(deleteKey);
                      openedFindings.delete(key);
                      renderList();
                      focusControl(keyed(search.id, 'title'));
                    }
                  },
                  deleteKey,
                )
              : null,
          )
        : null,
    );
  }

  function runLabel(run) {
    const verb =
      run.kind === 'update'
        ? 'Updated'
        : run.kind === 'retry'
          ? 'Retried'
          : 'Asked';
    return `${verb} ${formatTime(run.finishedAt || run.startedAt)}${run.status === 'ok' ? '' : ` · ${run.status}`}`;
  }

  function compareView(search, runs, comparison) {
    const id = search.id;
    const key = keyed(id, 'compare');
    const comparing = pending.has(key);
    const makePicker = (field, label) => {
      const picker = h(
        'select',
        {
          class: 'panel-surface-control',
          'aria-label': label,
          disabled: comparing,
          'data-search-focus': keyed(id, field),
          onchange: () => {
            comparison[field] = picker.value;
            comparison.result = null;
            renderList();
          },
        },
        runs.map((run) => option(run.id, runLabel(run))),
      );
      picker.value = comparison[field];
      return picker;
    };
    return h(
      'div',
      { class: 'searches-subsection' },
      h('h5', { text: 'Changes' }),
      h(
        'label',
        { class: 'searches-labeled' },
        'From',
        makePicker('from', 'Compare from run'),
      ),
      h(
        'label',
        { class: 'searches-labeled' },
        'To',
        makePicker('to', 'Compare to run'),
      ),
      button(
        comparing ? 'Comparing…' : 'Compare runs',
        () => {
          comparison.result = null;
          void runAction(key, async () => {
            comparison.result = await layer.getChanges(
              id,
              comparison.from,
              comparison.to,
            );
          });
        },
        {
          disabled:
            comparing ||
            !comparison.from ||
            !comparison.to ||
            comparison.from === comparison.to,
          'data-search-focus': key,
        },
      ),
      comparison.result
        ? [
            ['Added', comparison.result.added],
            ['Seen again', comparison.result.seenAgain],
            ['Not seen since', comparison.result.notSeenSince],
          ].map(([label, findings]) =>
            h(
              'div',
              {},
              h('h5', { text: `${label} · ${findings?.length || 0}` }),
              findings?.length
                ? h(
                    'ul',
                    {},
                    findings.map(({ title }) => h('li', { text: title })),
                  )
                : null,
            ),
          )
        : null,
    );
  }

  function openSearch(search) {
    const id = search.id;
    const sources = new Map(
      (search.sources || []).map((source) => [source.id, source]),
    );
    const answer = search.run?.answer;
    const runs = (search.runs || []).filter((run) => run.status === 'ok');
    const history = h(
      'select',
      {
        class: 'panel-surface-control',
        'aria-label': `Run history for ${search.label}`,
        'data-search-focus': keyed(id, 'run'),
        disabled: historyPending,
        onchange: () =>
          void changeHistory(() => layer.setRun(id, history.value || null)),
      },
      option('', 'Follow day picker'),
      [...runs].reverse().map((run) => option(run.id, runLabel(run))),
    );
    history.value =
      snapshot.selectedRun?.searchId === id ? snapshot.selectedRun.runId : '';
    const group = snapshot.groupFilters?.[id] || null;
    const groupButton = (groupId, label) =>
      button(label, () => layer.setGroup(id, groupId), {
        'aria-pressed': String(group === groupId),
        'data-search-focus': keyed(id, `group:${groupId}`),
      });
    const comparison = comparisons.get(id);
    const sections = searchFindingSections(search, group, snapshot.placeFilter);
    return h(
      'div',
      { class: 'searches-open' },
      ...(answer?.summary || []).map(({ text, sourceIds }, index) =>
        h(
          'div',
          { class: 'searches-summary' },
          note(text),
          evidence(sourceIds, sources, keyed(id, index), true),
        ),
      ),
      runs.length
        ? h('label', { class: 'searches-labeled' }, 'Runs', history)
        : null,
      (search.runs || []).length
        ? h(
            'ul',
            { class: 'searches-run-log' },
            [...search.runs].reverse().map((run) =>
              h('li', {
                text: [runLabel(run), formatRunUsage(run)]
                  .filter(Boolean)
                  .join(' · '),
              }),
            ),
          )
        : null,
      comparison && runs.length > 1
        ? compareView(search, runs, comparison)
        : null,
      answer?.groups?.length
        ? row(
            groupButton(null, 'All groups'),
            answer.groups.map(({ id, label }) => groupButton(id, label)),
          )
        : null,
      sections.length
        ? sections.map(({ label, findings, earlier }) =>
            h(
              'section',
              { class: 'searches-subsection' },
              h('h5', { text: label }),
              h(
                'ul',
                { class: 'searches-findings' },
                findings.map((finding) =>
                  findingRow(search, finding, sources, earlier),
                ),
              ),
            ),
          )
        : search.run
          ? note('No findings match this view.')
          : null,
    );
  }

  function menu(search, actionState) {
    const { id, label } = search;
    const { running, unavailable, mutable } = actionState;
    const update = keyed(id, 'update');
    const deleteKey = keyed(id, 'delete');
    const rename = renames.get(id);
    const renameKey = keyed(id, 'rename');
    const runs = (search.runs || []).filter((run) => run.status === 'ok');
    const form =
      rename !== undefined && mutable
        ? h(
            'form',
            {
              class: 'searches-controls',
              onsubmit: async (event) => {
                event.preventDefault();
                const value = renames.get(id)?.trim();
                if (
                  value &&
                  (await patch(search, { label: value }, 'rename')) &&
                  !destroyed
                ) {
                  renames.delete(id);
                  renderList();
                  focusControl(renameKey);
                }
              },
            },
            h('input', {
              class: 'panel-surface-control',
              'aria-label': 'New search name',
              maxlength: 40,
              value: rename,
              'data-search-focus': keyed(id, 'rename-input'),
              oninput: (event) => {
                renames.set(id, event.target.value);
                event.target.form.querySelector(
                  'button[type="submit"]',
                ).disabled = !event.target.value.trim();
              },
            }),
            button('Save name', null, {
              type: 'submit',
              disabled: pending.has(renameKey) || !rename.trim(),
              'data-search-focus': keyed(id, 'rename-save'),
            }),
            button(
              'Cancel rename',
              () => {
                renames.delete(id);
                renderList();
                focusControl(renameKey);
              },
              { 'data-search-focus': keyed(id, 'rename-cancel') },
            ),
          )
        : null;
    return h(
      'div',
      { class: 'searches-actions' },
      row(
        button(
          pending.has(update) ? 'Starting update…' : 'Update',
          () => runAction(update, () => layer.action('update', { id })),
          {
            disabled: Boolean(
              !mutable ||
              running ||
              unavailable ||
              !search.run ||
              pending.has(update),
            ),
            title: unavailable || null,
            'data-search-focus': update,
          },
        ),
        button(
          'Changes',
          () => {
            if (!comparisons.delete(id)) {
              comparisons.set(id, {
                from: runs.at(-2).id,
                to: runs.at(-1).id,
                result: null,
              });
              opened.add(id);
            }
            renderList();
          },
          {
            disabled: runs.length < 2,
            'aria-expanded': String(comparisons.has(id)),
            'data-search-focus': keyed(id, 'changes'),
          },
        ),
        button(
          'Rename',
          () => {
            renames.set(id, label);
            renderList();
            focusControl(keyed(id, 'rename-input'));
          },
          {
            disabled: !mutable || rename !== undefined,
            'data-search-focus': renameKey,
          },
        ),
        button('Show question', () => toggle(showQuestions, id), {
          'aria-expanded': String(showQuestions.has(id)),
          'data-search-focus': keyed(id, 'question'),
        }),
        button(
          'Delete',
          () => {
            toggle(confirming, deleteKey);
            if (confirming.has(deleteKey))
              focusControl(keyed(deleteKey, 'keep'));
          },
          {
            disabled: !mutable || Boolean(running),
            'aria-expanded': String(confirming.has(deleteKey)),
            'data-search-focus': deleteKey,
          },
        ),
      ),
      form,
      showQuestions.has(id) ? note(search.question) : null,
      confirming.has(deleteKey) && mutable && !running
        ? confirmation(
            `Delete “${label}” and all its runs?`,
            deleteKey,
            async () => {
              if (
                (await runAction(deleteKey, () =>
                  layer.action('delete', { id }),
                )) &&
                !destroyed
              ) {
                confirming.delete(deleteKey);
                opened.delete(id);
                openMenus.delete(id);
                renames.delete(id);
                comparisons.delete(id);
                showQuestions.delete(id);
                renderList();
                textFilter.focus();
              }
            },
            deleteKey,
          )
        : null,
    );
  }

  function searchRow(search) {
    const { id, label, running } = search;
    const open = opened.has(id);
    const mutable = !isHistory();
    const unavailable = askDisabledReason(
      search.question || 'Search',
      snapshot.agents?.[search.agent || 'claude'],
    );
    const visibleKey = keyed(id, 'visible');
    const pinKey = keyed(id, 'pinned');
    const retry = keyed(id, 'retry');
    const swatch = button(
      '',
      () => patch(search, { visible: !search.visible }, 'visible'),
      {
        class: 'panel-surface-control searches-swatch',
        'aria-label': `${search.visible ? 'Hide' : 'Show'} ${label} on the globe`,
        'aria-pressed': String(Boolean(search.visible)),
        disabled: !mutable || pending.has(visibleKey),
        'data-search-focus': visibleKey,
      },
    );
    if (search.color) swatch.style.setProperty('--search-color', search.color);
    const counts = [
      `${search.findings.filter(({ location }) => location).length} ${search.visible ? 'on the globe' : 'mapped'}`,
      `${search.findings.filter(({ location }) => !location).length} list-only`,
      `${search.findings.filter(({ alsoIn }) => alsoIn?.length).length} also in other searches`,
      search.earlierFindings?.length
        ? `${search.earlierFindings.length} earlier`
        : '',
      search.run?.droppedNoSource
        ? `${search.run.droppedNoSource} dropped without sources`
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const failed = !running && (search.status === 'failed' || search.error);
    const time = formatTime(search.run?.finishedAt || search.createdAt);
    return h(
      'article',
      { class: 'searches-search' },
      row(
        swatch,
        button(label, () => toggle(opened, id), {
          class: 'panel-surface-control searches-search-title',
          'aria-expanded': String(open),
          'data-search-focus': keyed(id, 'title'),
        }),
        button(
          search.pinned ? 'Unpin' : 'Pin',
          () => patch(search, { pinned: !search.pinned }, 'pinned'),
          {
            'aria-label': `${search.pinned ? 'Unpin' : 'Pin'} ${label}`,
            'aria-pressed': String(Boolean(search.pinned)),
            disabled: !mutable || pending.has(pinKey),
            'data-search-focus': pinKey,
          },
        ),
        button('Actions', () => toggle(openMenus, id), {
          'aria-label': `Actions for ${label}`,
          'aria-expanded': String(openMenus.has(id)),
          'data-search-focus': keyed(id, 'actions'),
        }),
      ),
      note([time ? `As of ${time}` : '', counts].filter(Boolean).join(' · ')),
      !search.visible && search.colorIndex === null
        ? note('Saved hidden: all 8 colours are in use')
        : null,
      running ? note('Running') : null,
      failed
        ? row(
            note(
              search.error?.message || search.error || 'Search failed.',
              'panel-surface-error',
            ),
            button(
              pending.has(retry) ? 'Retrying…' : 'Retry',
              () => runAction(retry, () => layer.action('retry', { id })),
              {
                disabled:
                  !mutable || Boolean(unavailable) || pending.has(retry),
                title: unavailable || null,
                'data-search-focus': retry,
              },
            ),
          )
        : null,
      openMenus.has(id)
        ? menu(search, { running, unavailable, mutable })
        : null,
      open ? openSearch(search) : null,
    );
  }

  function focusControl(key) {
    const control = [...list.querySelectorAll('[data-search-focus]')].find(
      (node) => node.dataset.searchFocus === key,
    );
    control?.focus({ preventScroll: true });
    return control;
  }

  function renderList() {
    if (destroyed) return;
    renderRunStatus();
    const active = document.activeElement;
    const activeKey = list.contains(active) ? active.dataset.searchFocus : null;
    const selection =
      activeKey && Number.isInteger(active.selectionStart)
        ? [
            active.selectionStart,
            active.selectionEnd,
            active.selectionDirection,
          ]
        : null;
    const scrollTop = container.scrollTop;
    const groups = groupSearches(snapshot.searches || [], filter);
    list.replaceChildren(
      ...(groups.length
        ? groups.map(({ label, searches }) =>
            h(
              'section',
              { class: 'searches-day-group' },
              h('h3', { text: label }),
              searches.map(searchRow),
            ),
          )
        : [
            note(
              snapshot.loading
                ? 'Loading searches…'
                : filter.trim()
                  ? 'No searches match this filter.'
                  : 'No searches yet.',
            ),
          ]),
    );
    if (activeKey) {
      const control = focusControl(activeKey);
      if (selection && control?.setSelectionRange)
        control.setSelectionRange(...selection);
    }
    container.scrollTop = scrollTop;
    tick();
    syncClock();
  }

  function tick() {
    const started = Date.parse(activeSearch?.running?.startedAt);
    const time = Number.isFinite(started)
      ? ` ${elapsedTime(Date.now() - started)}`
      : '';
    if (elapsed.textContent !== time) elapsed.textContent = time;
  }

  function renderRunStatus() {
    activeSearch = snapshot.searches?.find(({ running }) => running);
    runningLine.hidden = !activeSearch;
    if (!activeSearch) return;
    const text =
      activeSearch.running.stage === 'map'
        ? 'Placing findings…'
        : 'Searching the web…';
    if (stage.textContent !== text) stage.textContent = text;
    cancelRun.disabled = pending.has(keyed(activeSearch.id, 'cancel'));
    cancelRun.textContent = cancelRun.disabled ? 'Cancelling…' : 'Cancel';
  }

  function syncClock() {
    const active =
      !destroyed &&
      snapshot.enabled &&
      activeSearch &&
      !document.hidden &&
      !document.body.matches('.ui-clean-view, .recording-mode') &&
      !panel?.hidden &&
      !panel?.classList.contains('collapsed');
    if (active && timer === undefined) {
      tick();
      timer = setInterval(tick, 1000);
    }
    if (!active && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function renderHistory() {
    const days = snapshot.days || [];
    const dayKey = JSON.stringify(days);
    if (day.dataset.days !== dayKey) {
      day.replaceChildren(
        option('', 'Now'),
        ...days.map((value) => option(value, formatTime(value) || value)),
      );
      day.dataset.days = dayKey;
    }
    day.value = snapshot.asOf || '';
    day.disabled = historyPending;
    const historical = isHistory();
    const date = formatTime(snapshot.asOf);
    const label = historical ? `As of ${date || 'selected run'}` : '';
    historyBar.hidden = !historical;
    if (historical && historyBar.dataset.label !== label) {
      historyBar.replaceChildren(
        h('span', { text: label }),
        button('Back to now', backToNow),
      );
      historyBar.dataset.label = label;
    }
    if (historical)
      historyBar.querySelector('button').disabled = historyPending;
    const place = snapshot.placeFilter;
    placeBar.hidden = !place;
    if (place && placeBar.dataset.key !== place.key) {
      placeBar.replaceChildren(
        button(`Place · ${place.label} ×`, () => layer.setPlaceFilter(null), {
          'aria-label': `Clear place filter for ${place.label}`,
        }),
      );
      placeBar.dataset.key = place.key;
    }
  }

  function render() {
    if (destroyed) return;
    if (panel) panel.hidden = !snapshot.enabled;
    root.hidden = !snapshot.enabled;
    if (count)
      count.textContent = snapshot.enabled
        ? String(snapshot.searches?.length || 0)
        : '';
    if (!snapshot.enabled) {
      syncClock();
      return;
    }
    if (panel && !appearedDocuments.has(document)) {
      appearedDocuments.add(document);
      const preference = panel.dataset.collapsedPreference;
      if (
        panel.classList.contains('collapsed') &&
        (!preference || preference === 'default')
      )
        collapse?.click();
    }
    const latest = (snapshot.searches || [])
      .flatMap(({ runs, run }) => (runs?.length ? runs : run ? [run] : []))
      .filter((run) => run.finishedAt)
      .reduce(
        (current, run) =>
          !current ||
          Date.parse(run.finishedAt) > Date.parse(current.finishedAt)
            ? run
            : current,
        null,
      );
    usage.textContent = formatRunUsage(latest);
    usage.hidden = !usage.textContent;
    renderAsk();
    renderHistory();
    renderMessage();
    renderList();
  }

  const Observer = document.defaultView?.MutationObserver;
  const observer = panel && Observer ? new Observer(syncClock) : null;
  observer?.observe(panel, {
    attributes: true,
    attributeFilter: ['class', 'hidden'],
  });
  observer?.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
  document.addEventListener('visibilitychange', syncClock);
  const unsubscribe = layer.subscribe((next, reason) => {
    const selected = snapshot.selected;
    snapshot = next || layer.getSnapshot();
    const target = snapshot.selected;
    const reveal =
      target &&
      (reason === 'select' ||
        selected?.searchId !== target.searchId ||
        selected?.findingId !== target.findingId);
    if (reveal) {
      opened.add(target.searchId);
      openedFindings.add(keyed(target.searchId, target.findingId));
      filter = '';
      textFilter.value = '';
      if (snapshot.placeFilter) {
        const search = snapshot.searches.find(
          ({ id }) => id === target.searchId,
        );
        const finding = search?.findings.find(
          ({ id }) => id === target.findingId,
        );
        if (finding && finding.hotspot?.key !== snapshot.placeFilter.key)
          layer.setPlaceFilter(null);
      }
    }
    render();
    if (reveal && snapshot.enabled) {
      if (panel?.classList.contains('collapsed')) collapse?.click();
      const titleKey = keyed(keyed(target.searchId, target.findingId), 'title');
      const title = [...list.querySelectorAll('[data-search-focus]')].find(
        (node) => node.dataset.searchFocus === titleKey,
      );
      title?.scrollIntoView({ block: 'nearest' });
    }
  });
  if (snapshot.selected) {
    opened.add(snapshot.selected.searchId);
    openedFindings.add(
      keyed(snapshot.selected.searchId, snapshot.selected.findingId),
    );
  }
  render();
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', syncClock);
      syncClock();
      root.remove();
      if (panel) panel.hidden = true;
      if (count) count.textContent = '';
    },
  };
}
