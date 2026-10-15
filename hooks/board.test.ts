import { expect, test } from 'claude-code/testing'

import {
  addItem, bar, clearDone, cycleItem, mirrorTodos, parseBoard, planBoard, progress, removeItem, renderText, serialize, toggleList, updateItem,
} from './board'

const NOW = '2026-10-15T12:00:00Z'

test('plan builds lists with sequential ids', () => {
  const b = planBoard({ title: 'Sprint', lists: [{ name: 'A', items: ['one', { title: 'two', status: 'doing' }] }, { name: 'B', items: ['three'] }] }, NOW)
  expect(b.lists.map(l => l.items.map(t => t.id))).toEqual([[1, 2], [3]])
  expect(b.lists[0]!.items[1]!.status).toBe('doing')
  expect(b.nextId).toBe(4)
})

test('round-trips through serialize/parse', () => {
  const b = planBoard({ lists: [{ name: 'A', items: ['x'] }] }, NOW)
  expect(parseBoard(serialize(b))).toEqual(b)
})

test('lenient parse repairs missing and duplicate ids and unknown status', () => {
  const b = parseBoard('{"lists":[{"name":"A","items":[{"id":3,"title":"a"},{"id":3,"title":"dup"},{"text":"legacy","status":"weird"}]}]}')
  const ids = b.lists[0]!.items.map(t => t.id)
  expect(new Set(ids).size).toBe(3)
  expect(b.lists[0]!.items[2]!).toMatchObject({ title: 'legacy', status: 'todo' })
  expect(b.nextId).toBeGreaterThan(Math.max(...ids))
})

test('parse rejects a file without lists', () => {
  expect(() => parseBoard('{"groups":[]}')).toThrow()
  expect(() => parseBoard('{nope')).toThrow()
})

test('add creates the list when missing and never reuses ids after removal', () => {
  let b = planBoard({ lists: [{ name: 'A', items: ['x'] }] })
  b = removeItem(b, 1)
  const r = addItem(b, 'New', 'y')
  expect(r.item.id).toBe(2)
  expect(r.board.lists.map(l => l.name)).toEqual(['A', 'New'])
})

test('mutations do not touch the input board', () => {
  const b = planBoard({ lists: [{ name: 'A', items: ['x'] }] })
  const before = serialize(b)
  updateItem(b, 1, { status: 'done' })
  cycleItem(b, 1)
  toggleList(b, 'A')
  clearDone(b)
  expect(serialize(b)).toBe(before)
})

test('update moves an item between lists and clears a note with empty string', () => {
  let b = planBoard({ lists: [{ name: 'A', items: ['x'] }, { name: 'B', items: [] }] })
  b = updateItem(b, 1, { note: 'waiting on CI', list: 'b' })
  expect(b.lists[1]!.items[0]!).toMatchObject({ id: 1, note: 'waiting on CI' })
  b = updateItem(b, 1, { note: '' })
  expect(b.lists[1]!.items[0]!.note).toBeUndefined()
  expect(() => updateItem(b, 99, { status: 'done' })).toThrow('no item #99')
})

test('cycle goes todo → doing → done → todo, blocked → todo', () => {
  let b = planBoard({ lists: [{ name: 'A', items: ['x', { title: 'y', status: 'blocked' }] }] })
  const seq = []
  for (let i = 0; i < 3; i++) {
    b = cycleItem(b, 1)
    seq.push(b.lists[0]!.items[0]!.status)
  }
  expect(seq).toEqual(['doing', 'done', 'todo'])
  expect(cycleItem(b, 2).lists[0]!.items[1]!.status).toBe('todo')
})

test('clear done drops done items and lists left empty', () => {
  let b = planBoard({ lists: [{ name: 'A', items: [{ title: 'x', status: 'done' }] }, { name: 'B', items: ['y'] }] })
  b = clearDone(b)
  expect(b.lists.map(l => l.name)).toEqual(['B'])
})

test('progress and bar handle an empty board', () => {
  expect(progress(planBoard({ lists: [] }))).toEqual({ done: 0, total: 0 })
  expect(bar(0, 0, 4)).toBe('────')
  expect(bar(1, 2, 4)).toBe('━━──')
})

test('mirror keeps ids stable by title and drops todos no longer listed', () => {
  let b = mirrorTodos(planBoard({ lists: [] }), 'Session', [{ content: 'a', status: 'pending' }, { content: 'b', status: 'in_progress' }])
  b = mirrorTodos(b, 'Session', [{ content: 'b', status: 'completed' }])
  expect(b.lists[0]!.items).toMatchObject([{ id: 2, title: 'b', status: 'done' }])
})

test('text view lists ids and notes', () => {
  const b = updateItem(planBoard({ title: 'T', lists: [{ name: 'A', items: ['x'] }] }), 1, { note: 'n' })
  expect(renderText(b)).toContain('#1 ○ todo    x  — n')
})
