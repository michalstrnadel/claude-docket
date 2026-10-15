// Pure board model: parse, mutate, render. No `$` in here, so every rule is testable.
import type { Board, Item, List, Status } from '../types'

export const STATUSES: readonly Status[] = ['todo', 'doing', 'done', 'blocked']
export const GLYPH: Record<Status, string> = { todo: '○', doing: '◐', done: '●', blocked: '⊘' }
const CYCLE: Record<Status, Status> = { todo: 'doing', doing: 'done', done: 'todo', blocked: 'todo' }

export function emptyBoard(title = 'Tasks'): Board {
  return { version: 1, title, nextId: 1, lists: [] }
}

function asStatus(v: unknown): Status {
  return STATUSES.includes(v as Status) ? (v as Status) : 'todo'
}

/** Lenient parse: a hand-edited file with missing fields still loads; ids are repaired. */
export function parseBoard(text: string): Board {
  const raw = JSON.parse(text)
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lists)) {
    throw new Error('expected an object with a "lists" array')
  }
  const seen = new Set<number>()
  let max = 0
  const lists: List[] = raw.lists.map((l: any) => ({
    name: String(l?.name ?? 'Untitled'),
    ...(l?.collapsed ? { collapsed: true } : {}),
    items: (Array.isArray(l?.items) ? l.items : []).map((t: any) => {
      const id = Number.isInteger(t?.id) && t.id > 0 && !seen.has(t.id) ? t.id : 0
      if (id) {
        seen.add(id)
        max = Math.max(max, id)
      }
      const item: Item = {
        id,
        title: String(t?.title ?? t?.text ?? ''),
        status: asStatus(t?.status),
        updated: typeof t?.updated === 'string' ? t.updated : '',
      }
      if (typeof t?.note === 'string' && t.note) item.note = t.note
      return item
    }),
  }))
  let next = Math.max(max + 1, Number.isInteger(raw.nextId) ? raw.nextId : 1)
  for (const l of lists) for (const t of l.items) if (!t.id) t.id = next++
  return { version: 1, title: String(raw.title ?? 'Tasks'), nextId: next, lists }
}

export function serialize(board: Board): string {
  return JSON.stringify(board, null, 2) + '\n'
}

export function allItems(board: Board): Item[] {
  return board.lists.flatMap(l => l.items)
}

export function progress(board: Board): { done: number; total: number } {
  const items = allItems(board)
  return { done: items.filter(t => t.status === 'done').length, total: items.length }
}

/** A bar of `width` cells; empty boards draw an empty bar, never NaN. */
export function bar(done: number, total: number, width = 10): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)
  return '━'.repeat(filled) + '─'.repeat(width - filled)
}

export function findItem(board: Board, id: number): { list: List; item: Item } | null {
  for (const list of board.lists) {
    const item = list.items.find(t => t.id === id)
    if (item) return { list, item }
  }
  return null
}

function findList(board: Board, name: string): List | undefined {
  const key = name.trim().toLowerCase()
  return board.lists.find(l => l.name.toLowerCase() === key)
}

// Every mutation returns a NEW board, so a failed write never leaves state half-changed.
function clone(board: Board): Board {
  return JSON.parse(JSON.stringify(board))
}

export function addItem(board: Board, listName: string, title: string, status: Status = 'todo', now = ''): { board: Board; item: Item } {
  const b = clone(board)
  const name = listName.trim() || 'Inbox'
  let list = findList(b, name)
  if (!list) {
    list = { name, items: [] }
    b.lists.push(list)
  }
  const item: Item = { id: b.nextId++, title: title.trim(), status, updated: now }
  list.items.push(item)
  return { board: b, item }
}

export type Patch = { title?: string; status?: Status; note?: string; list?: string }

export function updateItem(board: Board, id: number, patch: Patch, now = ''): Board {
  const b = clone(board)
  const hit = findItem(b, id)
  if (!hit) throw new Error(`no item #${id}`)
  const { item } = hit
  if (patch.title !== undefined) item.title = patch.title.trim()
  if (patch.status !== undefined) item.status = asStatus(patch.status)
  if (patch.note !== undefined) {
    if (patch.note) item.note = patch.note
    else delete item.note
  }
  if (patch.list !== undefined && patch.list.trim().toLowerCase() !== hit.list.name.toLowerCase()) {
    hit.list.items = hit.list.items.filter(t => t.id !== id)
    let target = findList(b, patch.list)
    if (!target) {
      target = { name: patch.list.trim(), items: [] }
      b.lists.push(target)
    }
    target.items.push(item)
  }
  item.updated = now
  return b
}

export function cycleItem(board: Board, id: number, now = ''): Board {
  const hit = findItem(board, id)
  if (!hit) return board
  return updateItem(board, id, { status: CYCLE[hit.item.status] }, now)
}

export function removeItem(board: Board, id: number): Board {
  const b = clone(board)
  if (!findItem(b, id)) throw new Error(`no item #${id}`)
  for (const l of b.lists) l.items = l.items.filter(t => t.id !== id)
  return b
}

export function toggleList(board: Board, name: string): Board {
  const b = clone(board)
  const list = findList(b, name)
  if (list) list.collapsed = !list.collapsed
  if (list && !list.collapsed) delete list.collapsed
  return b
}

/** Drops done items and then lists left empty. */
export function clearDone(board: Board): Board {
  const b = clone(board)
  for (const l of b.lists) l.items = l.items.filter(t => t.status !== 'done')
  b.lists = b.lists.filter(l => l.items.length > 0)
  return b
}

export type PlanInput = { title?: string; lists: { name: string; items: (string | { title: string; status?: Status })[] }[] }

/** Builds a whole board in one call. Replacing a board that has open work is the caller's decision. */
export function planBoard(input: PlanInput, now = ''): Board {
  let b = emptyBoard(input.title?.trim() || 'Tasks')
  for (const l of input.lists ?? []) {
    if (!l.items?.length) b.lists.push({ name: l.name, items: [] })
    for (const raw of l.items ?? []) {
      const t = typeof raw === 'string' ? { title: raw } : raw
      b = addItem(b, l.name, t.title, asStatus(t.status), now).board
    }
  }
  return b
}

/** Compact text the model reads: one line per item, ids first so it can address them. */
export function renderText(board: Board): string {
  const { done, total } = progress(board)
  const lines = [`${board.title} — ${done}/${total} done`]
  for (const l of board.lists) {
    const d = l.items.filter(t => t.status === 'done').length
    lines.push('', `## ${l.name} (${d}/${l.items.length})`)
    for (const t of l.items) {
      lines.push(`#${t.id} ${GLYPH[t.status]} ${t.status.padEnd(7)} ${t.title}${t.note ? `  — ${t.note}` : ''}`)
    }
  }
  return lines.join('\n')
}

/** Mirror of the engine's TodoWrite list into one list, matched by title so ids stay stable. */
export function mirrorTodos(board: Board, listName: string, todos: { content: string; status: string }[], now = ''): Board {
  const map: Record<string, Status> = { pending: 'todo', in_progress: 'doing', completed: 'done' }
  let b = clone(board)
  const existing = findList(b, listName)
  const byTitle = new Map((existing?.items ?? []).map(t => [t.title, t]))
  const keep = new Set<number>()
  for (const todo of todos) {
    const status = map[todo.status] ?? 'todo'
    const hit = byTitle.get(todo.content.trim())
    if (hit) {
      keep.add(hit.id)
      if (hit.status !== status) b = updateItem(b, hit.id, { status }, now)
    } else {
      const r = addItem(b, listName, todo.content, status, now)
      b = r.board
      keep.add(r.item.id)
    }
  }
  const list = findList(b, listName)
  if (list) list.items = list.items.filter(t => keep.has(t.id))
  return b
}
