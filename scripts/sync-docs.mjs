/**
 * Copy the workspace's working documents into this package, as a backup.
 *
 * WHY THIS EXISTS. The git repository is this package, not the workspace above
 * it — the workspace also holds the OpenMontage clone and the analysis output,
 * neither of which belongs in a plugin's history. That left CONVENTIONS.md,
 * DEVELOPMENT.md and CLAUDE.md under no version control at all, which is how a
 * scripted edit removed 114 lines of CONVENTIONS.md with nothing to restore
 * from. They were recovered from a session transcript; there is no second time.
 *
 * WHAT IT REFUSES TO COPY. Everything about OpenMontage: the clone, the four
 * analysis pages, the extracted tool/pipeline/style JSON. That material is
 * input to this project, not part of it, and it is 600 KB of upstream analysis
 * that a plugin's history should never carry. The guard below is not
 * decoration — it is what keeps a future edit to `SOURCES` from quietly
 * pulling the whole workspace in.
 *
 * The copies are SNAPSHOTS, verbatim. Paths inside them are relative to the
 * workspace root, so a link to `OpenMontage/` or `docs/om-02-anatomy.html`
 * will not resolve from inside this package. That is deliberate: rewriting
 * them would fork the document, and a fork drifts. The workspace copy stays
 * the one you edit.
 *
 *   node scripts/sync-docs.mjs          copy, report what changed
 *   node scripts/sync-docs.mjs --check  report only, exit 1 if stale
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(HERE, '..')
const WORKSPACE = resolve(PACKAGE, '..')
const TARGET = join(PACKAGE, 'docs', 'workspace')

/**
 * What gets backed up: the documents about developing THIS plugin.
 *
 * CLAUDE.md earns its place despite naming OpenMontage throughout — it
 * describes the working context, and "there is an upstream we ported from" is
 * context, not upstream content.
 */
const SOURCES = [
  'CLAUDE.md',
  'CONVENTIONS.md',
  'DEVELOPMENT.md',
  '页面记录.md',
]

/**
 * Anything matching these is upstream analysis and must never be copied.
 *
 * Checked against the source path rather than trusted to the list above, so
 * adding a file to SOURCES cannot bring OpenMontage material in by accident.
 */
const FORBIDDEN = [
  /(^|[\\/])OpenMontage([\\/]|$)/i,
  /(^|[\\/])om-\d/i,
  /(^|[\\/])docs[\\/]data[\\/]/i,
  /(^|[\\/])docs[\\/]diagrams[\\/]/i,
]

function forbidden(relative) {
  return FORBIDDEN.find((pattern) => pattern.test(relative))
}

async function main() {
  const check = process.argv.includes('--check')
  await mkdir(TARGET, { recursive: true })

  const changed = []
  const same = []
  for (const relative of SOURCES) {
    const blocked = forbidden(relative)
    if (blocked !== undefined) {
      console.error('REFUSED  ' + relative + '  — matches ' + blocked + ' (upstream analysis)')
      process.exitCode = 1
      continue
    }
    const from = join(WORKSPACE, relative)
    const to = join(TARGET, relative)
    let source
    try {
      source = await readFile(from, 'utf-8')
    } catch {
      console.error('MISSING  ' + relative + '  — not in the workspace')
      process.exitCode = 1
      continue
    }
    const existing = await readFile(to, 'utf-8').catch(() => undefined)
    if (existing === source) {
      same.push(relative)
      continue
    }
    changed.push(relative + '  (' + Math.round(source.length / 1024) + ' KB)')
    if (!check) await writeFile(to, source, 'utf-8')
  }

  for (const line of same) console.log('  =  ' + line)
  for (const line of changed) console.log((check ? '  ≠  ' : '  →  ') + line)
  if (changed.length === 0) {
    console.log('\n' + same.length + ' documents, all current.')
    return
  }
  if (check) {
    console.log('\n' + changed.length + ' stale. Run: node scripts/sync-docs.mjs')
    process.exitCode = 1
    return
  }
  console.log('\n' + changed.length + ' copied into docs/workspace/. Commit them to keep the backup.')
}

await main()
