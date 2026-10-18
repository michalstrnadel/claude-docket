import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Filter, Status } from '../types'
import {
  GLYPH,
  addItem,
  allItems,
  bar,
  clearDone,
  cycleItem,
  emptyBoard,
  mirrorTodos,
  parseBoard,
  planBoard,
  progress,
  removeItem,
  renderText,
  serialize,
  toggleList,
  updateItem,
} from './board'

export const FILE = '.claude/docket.json'
const PANE = 'docket'
const TOOL = 'mcp__docket__docket'
const POLL_MS = 1500

const board = atom({ plugin: 'docket', key: 'board' } as const, null)
const error = atom({ plugin: 'docket', key: 'error' } as const, null)
const filter = atom({ plugin: 'docket', key: 'filter' } as const, 'all')
const addTo = atom({ plugin: 'docket', key: 'addTo' } as const, '')
const compact = atom({ plugin: 'docket', key: 'compact' } as const, false)
const paneOpen = atom({ plugin: 'docket', key: 'paneOpen' } as const, false)
const BAND_ROWS = 6

const TONE: Record<Status, string> = { todo: 'subtle', doing: 'warning', done: 'success', blocked: 'error' }

// The file is the source of truth; the atom is a cache of its last good parse.
let lastSeen = ''
// Frozen per load so the system prompt stays byte-identical across turns (prompt cache).
let promptSnapshot: string | null = null

function now(): string {
  return new Date().toISOString()
}

async function load($: EngineInterface): Promise<void> {
  const stat = await $.fs.stat(FILE).catch(() => null)
  const stamp = stat ? `${stat.mtimeMs}:${stat.size}` : 'missing'
  if (stamp === lastSeen) return
  lastSeen = stamp
  if (!stat) {
    await update($, board, () => null)
    await update($, error, () => null)
    return
  }
  const text = await $.fs.read(FILE).catch(() => null)
  if (typeof text !== 'string') return
  try {
    const parsed = parseBoard(text)
    await update($, board, () => parsed)
    await update($, error, () => null)
  } catch (err) {
    // Keep showing the last good board; say why the new one did not load.
    await update($, error, () => `${FILE}: ${(err as Error).message}`)
  }
}

async function save($: EngineInterface, next: Board): Promise<void> {
  await $.fs.write(FILE, serialize(next))
  const stat = await $.fs.stat(FILE).catch(() => null)
  lastSeen = stat ? `${stat.mtimeMs}:${stat.size}` : ''
  await update($, board, () => next)
  await update($, error, () => null)
}

async function mutate($: EngineInterface, fn: (b: Board) => Board): Promise<Board> {
  await load($)
  const current = (await read($, board)) ?? emptyBoard()
  const next = fn(current)
  await save($, next)
  return next
}

async function openPane($: EngineInterface): Promise<void> {
  // Ask for room for the whole board (header, lists, items, footer); the person's own size still wins.
  const b = await read($, board)
  const rows = b ? 5 + b.lists.reduce((n, l) => n + 2 + (l.collapsed ? 0 : l.items.length), 0) : 6
  await $.ui.open({ id: PANE, title: 'Docket', focus: true, closeOnEscape: true, rows })
  await update($, paneOpen, () => true)
}

const TOOL_DESCRIPTION = `The project's task board (docket), shown to the user live above the prompt and in a board pane, stored in ${FILE} so it survives crashes and new sessions.
Use it for any work of more than two steps: plan it on the board first, set an item to "doing" when you start it and "done" when it is verified, and keep at most one or two items "doing". The user reads this board instead of your messages to know where things stand, so keep it true.
Actions:
- view: returns the board as text with item ids (#n).
- plan: {title, lists:[{name, items:[title | {title, status}]}]} builds a whole board. Refused when the board has open items unless replace:true — prefer add/update to extend an existing plan.
- add: {list, title, status?} adds an item (the list is created if missing).
- update: {id, status?, title?, note?, list?} changes an item; note is a one-line status note ("waiting on CI"), empty string clears it.
- remove: {id}. clear_done: drops done items and empty lists.
Statuses: todo, doing, done, blocked.`

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['view', 'plan', 'add', 'update', 'remove', 'clear_done'] },
    id: { type: 'integer' },
    list: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked'] },
    note: { type: 'string' },
    replace: { type: 'boolean' },
    lists: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          items: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: { title: { type: 'string' }, status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked'] } },
                  required: ['title'],
                },
              ],
            },
          },
        },
        required: ['name', 'items'],
      },
    },
  },
  required: ['action'],
}

export async function runAction($: EngineInterface, input: Record<string, any>): Promise<string> {
  const action = String(input.action ?? 'view')
  const stamp = now()
  if (action === 'view') {
    await load($)
    const b = await read($, board)
    return b ? renderText(b) : `The board is empty (${FILE} does not exist yet). Use action "plan" or "add".`
  }
  if (action === 'plan') {
    await load($)
    const current = await read($, board)
    const open = current ? allItems(current).filter(t => t.status !== 'done').length : 0
    if (open > 0 && !input.replace) {
      return `Refused: the board has ${open} open items. Extend it with add/update, or pass replace:true to start over.\n\n${renderText(current as Board)}`
    }
    const next = planBoard({ title: input.title, lists: input.lists ?? [] }, stamp)
    await save($, next)
    return renderText(next)
  }
  if (action === 'add') {
    if (!input.title) return 'Refused: add needs a title.'
    let added = 0
    const next = await mutate($, b => {
      const r = addItem(b, String(input.list ?? 'Inbox'), String(input.title), (input.status as Status) ?? 'todo', stamp)
      added = r.item.id
      return r.board
    })
    return `Added #${added}.\n\n${renderText(next)}`
  }
  if (action === 'update') {
    const id = Number(input.id)
    const next = await mutate($, b =>
      updateItem(b, id, { title: input.title, status: input.status, note: input.note, list: input.list }, stamp),
    )
    return `Updated #${id}.\n\n${renderText(next)}`
  }
  if (action === 'remove') {
    const id = Number(input.id)
    const next = await mutate($, b => removeItem(b, id))
    return `Removed #${id}.\n\n${renderText(next)}`
  }
  if (action === 'clear_done') {
    const next = await mutate($, clearDone)
    return renderText(next)
  }
  return `Unknown action "${action}".`
}

export const register: Register = on => {
  lastSeen = ''
  promptSnapshot = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'docket', description: 'Open the task board' })
    await $.command.register({ name: 'dk', description: 'Fold or unfold the task list above the prompt' })
    await $.tool.register({ name: 'docket', description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA, isDeferred: false })
    await load($)
    $.clock.every(POLL_MS, () => void load($).catch(() => {}))

    return next(e)
  })

  on('command.run', { command: 'docket' }, async $ => {
    await openPane($)

    return { text: 'board opened · esc closes' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, paneOpen, () => false)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'dk' }, async $ => {
    await update($, compact, v => !v)

    return { text: (await read($, compact)) ? 'task list folded' : 'task list unfolded' }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    try {
      return { result: await runAction($, e as Record<string, any>) }
    } catch (err) {
      return { result: `Error: ${(err as Error).message}`, isError: true }
    }
  }).catch(() => ({ result: 'Error: the docket tool failed; the board file is unchanged.', isError: true }))

  // Where the engine's own todo list runs, mirror it so it lands on the board too.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    const todos = (e as { todos?: { content: string; status: string }[] }).todos
    if (Array.isArray(todos)) await mutate($, b => mirrorTodos(b, 'Session', todos, now())).catch(() => {})

    return ran
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (promptSnapshot === null) {
      await load($)
      const b = await read($, board)
      const open = b ? allItems(b).filter(t => t.status !== 'done').length : 0
      promptSnapshot = [
        `A task board ("docket") is shown to the user above the prompt. Keep it current with the mcp__docket__docket tool for any multi-step work: plan first, mark items doing/done as you go.`,
        b && open > 0
          ? `The board had ${open} open items when this session started — the plan from earlier work. Call docket view before resuming:\n${renderText(b)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    }

    return { ...composed, sections: [...composed.sections, { id: 'docket:board', text: promptSnapshot, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, board)
    if (e.props.hasSurvey || b === null || allItems(b).length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const { done, total } = progress(b)
    // While the board pane is open the band shrinks to its summary row: one list on screen, not two.
    const isPaneOpen = await read($, paneOpen)
    const isCompact = isPaneOpen || (await read($, compact))
    // Open work in the order it matters: what runs now, what is stuck, then what is next.
    const rank: Record<Status, number> = { doing: 0, blocked: 1, todo: 2, done: 3 }
    const open = allItems(b)
      .filter(t => t.status !== 'done')
      .map((t, i) => ({ t, i }))
      .sort((x, y) => rank[x.t.status] - rank[y.t.status] || x.i - y.i)
      .map(x => x.t)
    const shown = isPaneOpen ? [] : isCompact ? open.filter(t => t.status === 'doing').slice(0, 1) : open.slice(0, BAND_ROWS)
    // Folded, the summary already says how many are open.
    const more = isCompact ? 0 : open.length - shown.length

    // Other mods draw in this band too: draw ours on top of whatever they draw, never instead of it.
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            {/* The whole summary is one control: a click, or Enter with the band focused, folds the list. */}
            <Button
              key="compact"
              plain
              onPress={() => void update($, compact, v => !v)}
            >
              <Text color="claude">◆</Text> <Text color="success">{bar(done, total, 8)}</Text>{' '}
              <Text dimColor>{done}/{total}</Text>{' '}
              {open.length === 0 ? <Text color="success">all done </Text> : null}
              <Text dimColor>{isCompact ? `▸ ${open.length} open` : '▾'}</Text>
            </Button>
            <Button key="open" label="board" dimColor onPress={() => void openPane($)} />
          </Box>
          {shown.map(t => (
            <Box key={`band:${t.id}`} flexDirection="row" gap={1} paddingLeft={2}>
              {/* The id never shrinks: under a long title, flex squeezed "#10" into "#1"/"0".
                  flexShrink alone was not enough ("#27" still split into "#2"/"7" once the
                  row overflowed), so the box gets an explicit width: glyph + gap + "#id". */}
              <Box flexShrink={0} gap={1} width={2 + String(t.id).length + 1} minWidth={2 + String(t.id).length + 1}>
                <Text color={TONE[t.status]}>{GLYPH[t.status]}</Text>
                <Text dimColor tabular wrap="truncate">#{t.id}</Text>
              </Box>
              <Text color={t.status === 'doing' ? 'warning' : undefined} wrap="truncate-end">{t.title}</Text>
              {t.note ? <Text dimColor italic wrap="truncate-end">{t.note}</Text> : null}
            </Box>
          ))}
          {more > 0 ? <Text dimColor>{'    '}+{more} more · /docket</Text> : null}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // The mobile surface has no fields; the board stays readable and pressable there.
    const Input = 'Input' in ui ? ui.Input : null
    const Select = 'Select' in ui ? ui.Select : null
    const b = await read($, board)
    const err = await read($, error)
    const mode: Filter = await read($, filter)
    const target = (await read($, addTo)) || b?.lists[0]?.name || 'Inbox'

    const counts = { todo: 0, doing: 0, done: 0, blocked: 0 }
    for (const t of b ? allItems(b) : []) counts[t.status] += 1
    const { done, total } = b ? progress(b) : { done: 0, total: 0 }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Text color="claude">◆</Text>
          <Text bold>{b?.title ?? 'Docket'}</Text>
          <Text color="success">{bar(done, total, 16)}</Text>
          <Text dimColor tabular>{done}/{total}</Text>
        </Box>
        <Box flexDirection="row" gap={2} marginBottom={1}>
          <Text dimColor>
            <Text color="warning">◐ {counts.doing}</Text> doing · <Text color="error">⊘ {counts.blocked}</Text> blocked · ○ {counts.todo} todo · <Text color="success">● {counts.done}</Text> done
          </Text>
          {Select ? (<Select
            key="filter"
            value={mode}
            options={[
              { value: 'all', label: 'all' },
              { value: 'open', label: 'open' },
            ]}
            onSelect={(v: string) => void update($, filter, () => v as Filter)}
          />) : null}
        </Box>

        {err ? <Text color="error">{err}</Text> : null}
        {!b || b.lists.length === 0 ? (
          <Text dimColor>No tasks yet. Ask Claude to plan the work, or add one below.</Text>
        ) : null}

        {(b?.lists ?? []).map(list => {
          const shown = mode === 'open' ? list.items.filter(t => t.status !== 'done') : list.items
          const listDone = list.items.filter(t => t.status === 'done').length
          if (mode === 'open' && shown.length === 0) return null

          return (
            <Box key={`list:${list.name}`} flexDirection="column" marginBottom={1}>
              <Button key={`toggle:${list.name}`} plain onPress={() => void mutate($, x => toggleList(x, list.name))}>
                <Text dimColor>{list.collapsed ? '▸' : '▾'}</Text> <Text bold>{list.name}</Text>{' '}
                <Text dimColor tabular>{listDone}/{list.items.length}</Text>
              </Button>
              {list.collapsed
                ? null
                : shown.map(t => (
                    <Box key={`row:${t.id}`} flexDirection="row" paddingLeft={2}>
                      <Button key={`item:${t.id}`} plain onPress={() => void mutate($, x => cycleItem(x, t.id, now()))}>
                        <Text color={TONE[t.status]}>{GLYPH[t.status]}</Text>{' '}
                        <Text dimColor tabular>#{t.id}</Text>{' '}
                        <Text dimColor={t.status === 'done'} strikethrough={t.status === 'done'}>{t.title}</Text>
                        {t.note ? <Text dimColor italic>  {t.note}</Text> : null}
                      </Button>
                    </Box>
                  ))}
            </Box>
          )
        })}

        <Box flexDirection="row" gap={1}>
          {Select && b && b.lists.length > 1 ? (
            <Select
              key="addTo"
              value={target}
              options={b.lists.map(l => ({ value: l.name, label: l.name }))}
              onSelect={(v: string) => void update($, addTo, () => v)}
            />
          ) : null}
          {Input ? (<Input
            key="add"
            placeholder="add a task…"
            submitLabel="add"
            onSubmit={(v: string) => {
              if (v.trim()) void mutate($, x => addItem(x, target, v, 'todo', now()).board)
            }}
          />) : null}
          {counts.done > 0 ? <Button key="clear" label="clear done" dimColor onPress={() => void mutate($, clearDone)} /> : null}
        </Box>
        <Text dimColor>enter cycles ○ → ◐ → ● · esc closes · {FILE}</Text>
      </Box>
    )
  })
}
