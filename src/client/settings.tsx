/**
 * The openreelbench Settings page (`settings.section`, id `openreel`).
 *
 * The shell mounts it as the content of the "OpenReel 创意台" sidebar entry and
 * passes `close` (unused here — a settings form never leaves settings); the
 * page's data comes through the bound `scope` for the `openreel` namespace.
 *
 * Edits are STAGED and written only on save. Each settings write is a durable,
 * revision-fenced document mutation, so a control that committed as it settled
 * would turn one keystroke into a write the user never asked for — and with
 * `workspaceRoot` that means a half-typed path becoming the project root.
 *
 * A field shows its effective value (user layer over composition layer over
 * schema default) and marks whether the user layer carries it. That mark comes
 * from PRESENCE in the user layer, not from comparing against the default: an
 * override that happens to equal the default is still an override, and a value
 * comparison could not see it.
 */
import { useMemo, useState } from 'react'

import type { Config } from '../config.ts'
import {
  type FieldPath,
  type FieldSpec,
  FIELD_GROUPS,
  buildWrites,
  fieldKey,
  getPath,
  isOverridden,
} from './fields.ts'
import { type SettingsScope, useScope } from './scope.ts'

interface Edit {
  path: FieldPath
  value: unknown
}

export interface SettingsSectionProps {
  /** Owner share from the settings shell (unused; kept for the slot contract). */
  close?: () => void
  scope: SettingsScope<Config>
}

/** Format a stored value for its control. */
function toText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value)
}

/** Parse a control's text back to the shape the schema expects. */
function fromText(spec: FieldSpec, text: string): { value: unknown } | { error: string } {
  if (spec.kind === 'number') {
    const trimmed = text.trim()
    if (trimmed === '') return { error: '不能为空' }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) return { error: '要填数字' }
    return { value: parsed }
  }
  return { value: text }
}

/** Read a `list`-kind field's current value as a string array, tolerating anything stale or absent. */
function toList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => (typeof entry === 'string' ? entry : String(entry)))
}

export function SettingsSection({ scope }: SettingsSectionProps): JSX.Element | null {
  const snapshot = useScope(scope)
  const [edits, setEdits] = useState<Map<string, Edit>>(new Map())
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const section = snapshot.value as unknown as Record<string, unknown> | undefined

  // Needed at save time to know which staged values are lists (and so need
  // their blank rows filtered) — the edits map itself only carries values.
  const specByKey = useMemo(() => {
    const map = new Map<string, FieldSpec>()
    for (const group of FIELD_GROUPS) {
      for (const spec of group.fields) map.set(fieldKey(spec.path), spec)
    }
    return map
  }, [])

  // Validation is per-field and recomputed on every keystroke so Save can be
  // disabled before a bad value ever reaches the wire.
  const errors = useMemo(() => {
    const found = new Map<string, string>()
    for (const group of FIELD_GROUPS) {
      for (const spec of group.fields) {
        const edit = edits.get(fieldKey(spec.path))
        if (edit === undefined) continue
        if (spec.kind === 'number' && typeof edit.value !== 'number') {
          found.set(fieldKey(spec.path), typeof edit.value === 'string' ? edit.value : '无效')
        }
      }
    }
    return found
  }, [edits])

  // A namespace the host never registered should leave no trace in the UI,
  // rather than a dead card the user cannot act on.
  if (snapshot.status === 'unavailable') return null

  const loading = snapshot.status === 'loading'
  const readOnly = loading || !snapshot.writable || saving
  const dirty = edits.size > 0
  const blocked = errors.size > 0

  function stage(spec: FieldSpec, raw: string | boolean): void {
    setResult(null)
    const key = fieldKey(spec.path)
    setEdits((previous) => {
      const next = new Map(previous)
      if (typeof raw === 'boolean') {
        next.set(key, { path: spec.path, value: raw })
        return next
      }
      const parsed = fromText(spec, raw)
      next.set(key, { path: spec.path, value: 'value' in parsed ? parsed.value : raw })
      return next
    })
  }

  /** Stage a whole `list`-kind value (add/edit/remove all go through this). */
  function stageList(spec: FieldSpec, value: string[]): void {
    setResult(null)
    setEdits((previous) => {
      const next = new Map(previous)
      next.set(fieldKey(spec.path), { path: spec.path, value })
      return next
    })
  }

  function discard(): void {
    setEdits(new Map())
    setResult(null)
  }

  async function save(): Promise<void> {
    if (!dirty || blocked) return
    setSaving(true)
    setResult(null)
    try {
      // Blank rows are a `list` field's editing convenience, not something to
      // persist — filter them out only now, at the write boundary.
      const sanitized = new Map<string, Edit>()
      for (const [key, edit] of edits) {
        const spec = specByKey.get(key)
        if (spec?.kind === 'list' && Array.isArray(edit.value)) {
          const cleaned = (edit.value as string[]).map((entry) => entry.trim()).filter((entry) => entry !== '')
          sanitized.set(key, { path: edit.path, value: cleaned })
        } else {
          sanitized.set(key, edit)
        }
      }
      for (const [field, value] of buildWrites(section, sanitized)) {
        await scope.set(field, value)
      }
      setEdits(new Map())
      setResult({ kind: 'ok', text: '已保存。项目根目录、绑定和风格立即生效；正在进行的合成沿用旧值。' })
    } catch (error) {
      setResult({ kind: 'error', text: '保存失败：' + (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  function renderField(spec: FieldSpec): JSX.Element {
    const key = fieldKey(spec.path)
    const edit = edits.get(key)
    const stored = getPath(section, spec.path)
    const overridden = isOverridden(snapshot.user, spec.path)
    const error = errors.get(key)

    const head = (
      <div className="orb-field-head">
        <span className="orb-label">{spec.label}</span>
        {overridden ? <span className="orb-badge">已覆盖</span> : null}
      </div>
    )
    const hint = spec.hint === undefined
      ? null
      : <div className={error === undefined ? 'orb-hint' : 'orb-hint orb-note-error'}>{error ?? spec.hint}</div>

    if (spec.kind === 'boolean') {
      const checked = edit !== undefined ? edit.value === true : stored === true
      return (
        <div className="orb-field" key={key}>
          <label className="orb-check">
            <input
              type="checkbox"
              checked={checked}
              disabled={readOnly}
              onChange={(event) => stage(spec, event.target.checked)}
            />
            <span className="orb-label">{spec.label}</span>
            {overridden ? <span className="orb-badge">已覆盖</span> : null}
          </label>
          {hint}
        </div>
      )
    }

    if (spec.kind === 'select') {
      const current = toText(edit !== undefined ? edit.value : stored)
      const options = spec.options?.(section) ?? []
      // A value the picker does not offer (a playbook removed from config)
      // must still be visible, or saving would silently rewrite it.
      const known = options.some((option) => option.value === current)
      return (
        <div className="orb-field" key={key}>
          {head}
          <select
            className="orb-select"
            value={current}
            disabled={readOnly}
            onChange={(event) => stage(spec, event.target.value)}
          >
            {known ? null : <option value={current}>{current === '' ? '（未设置）' : current + '（未定义）'}</option>}
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {hint}
        </div>
      )
    }

    if (spec.kind === 'list') {
      const items = toList(edit !== undefined ? edit.value : stored)
      // An empty list still needs one row to type into, or the first entry
      // would require clicking "+" before it could be entered at all.
      const rows = items.length === 0 ? [''] : items
      return (
        <div className="orb-field" key={key}>
          {head}
          <div className="orb-list">
            {rows.map((value, index) => (
              <div className="orb-list-row" key={index}>
                {index === 0 ? <span className="orb-list-tag">默认</span> : null}
                <input
                  className="orb-input"
                  type="text"
                  value={value}
                  placeholder={index === 0 ? (spec.placeholder ?? '默认工作流') : '候选工作流'}
                  disabled={readOnly}
                  spellCheck={false}
                  onChange={(event) => {
                    const next = [...rows]
                    next[index] = event.target.value
                    stageList(spec, next)
                  }}
                />
                <button
                  type="button"
                  className="orb-list-remove"
                  disabled={readOnly || items.length === 0}
                  aria-label="删除这一条"
                  onClick={() => {
                    const next = items.filter((_, itemIndex) => itemIndex !== index)
                    stageList(spec, next)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="orb-btn orb-list-add"
            disabled={readOnly}
            onClick={() => stageList(spec, [...items, ''])}
          >
            + 添加工作流
          </button>
          {hint}
        </div>
      )
    }

    const text = edit !== undefined
      ? (typeof edit.value === 'string' ? edit.value : toText(edit.value))
      : toText(stored)
    return (
      <div className="orb-field" key={key}>
        {head}
        <input
          className={error === undefined ? 'orb-input' : 'orb-input orb-invalid'}
          type="text"
          inputMode={spec.kind === 'number' ? 'numeric' : undefined}
          value={text}
          placeholder={spec.placeholder ?? ''}
          disabled={readOnly}
          spellCheck={false}
          onChange={(event) => stage(spec, event.target.value)}
        />
        {hint}
      </div>
    )
  }

  /** Fields sharing a `row` sit side by side; everything else stacks. */
  function renderFields(fields: FieldSpec[]): JSX.Element[] {
    const out: JSX.Element[] = []
    let index = 0
    while (index < fields.length) {
      const spec = fields[index]!
      if (spec.row === undefined) {
        out.push(renderField(spec))
        index += 1
        continue
      }
      const run: FieldSpec[] = []
      while (index < fields.length && fields[index]!.row === spec.row) {
        run.push(fields[index]!)
        index += 1
      }
      out.push(<div className="orb-row" key={'row-' + spec.row}>{run.map(renderField)}</div>)
    }
    return out
  }

  return (
    <div className="orb-card">
      {FIELD_GROUPS.map((group) => (
        <div className="orb-group orb-group-boxed" key={group.title}>
          <div className="orb-group-title">{group.title}</div>
          {group.blurb === undefined ? null : <p className="orb-group-blurb">{group.blurb}</p>}
          {renderFields(group.fields)}
        </div>
      ))}

      <div className="orb-group">
        <div className="orb-hint">
          风格库本身（提示词模板、一致性锚点、质量红线）在 profile 的 <code>cordis.yml</code> 里编辑，
          这里只选用哪一套。
        </div>
      </div>

      <div className="orb-actions">
        {loading ? <span className="orb-note">读取中…</span> : null}
        {!loading && !snapshot.writable
          ? <span className="orb-note orb-note-warn">当前连接不接受写入，改动无法保存。</span>
          : null}
        {result !== null
          ? <span className={result.kind === 'ok' ? 'orb-note orb-note-ok' : 'orb-note orb-note-error'}>{result.text}</span>
          : null}
        <span className="orb-spacer" />
        <button className="orb-btn" type="button" disabled={!dirty || saving} onClick={discard}>撤销</button>
        <button
          className="orb-btn orb-btn-primary"
          type="button"
          disabled={!dirty || blocked || readOnly}
          onClick={() => { void save() }}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
