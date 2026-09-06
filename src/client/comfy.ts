/**
 * Talking to dsh-comfyui from the browser.
 *
 * The project rule is that studio's HOST never touches ComfyUI — no second
 * client, no duplicated workflow library. That rule is intact here: these are
 * same-origin calls from the page to dsh-comfyui's own routes, so the two
 * plugins stay coupled by a URL rather than by code, and studio's server knows
 * nothing about ComfyUI.
 *
 * What that buys is directness. Generating a take through the model costs a
 * whole conversational turn; a person auditioning a voice will not wait for
 * that. Once the media exists, `POST /studio/import` pulls it into the project
 * and `studio_stage` records it — so the model still learns what happened, it
 * just does not have to be the one doing it.
 *
 * The coupling is deliberately narrow: four routes, all of which dsh-comfyui
 * already exposes for its own panel.
 */

export interface ComfyMedia {
  url: string
  kind: 'image' | 'video' | 'audio' | 'other'
  filename?: string
}

export type JobStatus = 'running' | 'completed' | 'failed' | 'unknown'

export interface JobResult {
  status: JobStatus
  media: ComfyMedia[]
  error?: string
}

export class ComfyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComfyError'
  }
}

/** One parameter as the workflow's own saved snapshot records it. */
export interface WorkflowParameterSummary {
  name: string
  options?: Array<string | number>
}

export interface WorkflowSummary {
  id: string
  name: string
  description?: string
  /** The parameter snapshot taken when the workflow was last saved. */
  parameters?: WorkflowParameterSummary[]
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ComfyError('连不上 dsh-comfyui。它没装或没启用时，这一页的生成功能都不可用。')
  }
  const payload = await response.json().catch(() => undefined) as { error?: string } | undefined
  if (!response.ok) throw new ComfyError(payload?.error ?? ('dsh-comfyui 返回 HTTP ' + response.status))
  return payload as T
}

export const comfy = {
  /** Whether dsh-comfyui is present at all; every other call assumes it is. */
  available: async (): Promise<boolean> => {
    try {
      const response = await fetch('/comfyui/ping')
      return response.ok
    } catch {
      return false
    }
  },

  /**
   * The options of one node input — how the voice library is read.
   * `CharacterVoicesNode.voice_name` is the library, straight from
   * ComfyUI's `/object_info`, so it is never a stale copy.
   */
  inputOptions: async (classType: string, inputKey: string): Promise<Array<string | number>> => {
    const result = await post<{ options?: Array<string | number> }>(
      '/comfyui/workflows/input-options', { classType, inputKey })
    return result.options ?? []
  },

  /** The saved workflow library, so a name in config can be resolved to an id. */
  workflows: async (): Promise<WorkflowSummary[]> => {
    const response = await fetch('/comfyui/workflows')
    if (!response.ok) throw new ComfyError('读不到工作流库（HTTP ' + response.status + '）')
    const payload = await response.json() as { workflows?: WorkflowSummary[] }
    return payload.workflows ?? []
  },

  /** Queue a saved workflow. Returns immediately with a prompt id. */
  /**
   * Re-derive a workflow's saved parameter snapshot from ComfyUI's live
   * `object_info`.
   *
   * dsh-comfyui validates a run against the options it captured when the
   * workflow was last saved, not against what ComfyUI knows now — so a voice
   * added to the library after that is rejected even though the dropdown, which
   * reads live options, offers it. Refreshing closes that gap at its source.
   * @returns the parameter names whose stored definition actually changed.
   */
  /**
   * Put a file into ComfyUI's input directory and return the name it landed
   * under. References have to live there, not in the project: the workflow's
   * own loader is what reads them.
   *
   * Audio goes through this too, and the form field stays `image`. That is not
   * an oversight — ComfyUI's `/upload/image` is the only upload endpoint, it
   * writes the bytes to the input directory without looking at them, and its
   * own frontend uploads audio for `LoadAudio` the same way. Renaming the
   * field to match the media would 400.
   */
  uploadAsset: async (file: File): Promise<string> => {
    const form = new FormData()
    form.append('image', file, file.name)
    const response = await fetch('/comfyui/upload', { method: 'POST', body: form })
    const body = await response.json().catch(() => undefined) as
      { ok?: boolean; name?: string; error?: string } | undefined
    if (!response.ok || body?.name === undefined) {
      throw new ComfyError(body?.error ?? ('上传失败：HTTP ' + response.status))
    }
    return body.name
  },

  refreshParams: async (id: string): Promise<string[]> => {
    const body = await post<{ ok?: boolean; changed?: unknown; error?: string }>(
      '/comfyui/workflows/refresh-params', { id })
    return Array.isArray(body.changed) ? body.changed.map(String) : []
  },

  run: async (id: string, parameters: Record<string, unknown>): Promise<string> => {
    const result = await post<{ promptId?: string }>('/comfyui/workflows/run', { id, parameters })
    if (typeof result.promptId !== 'string') throw new ComfyError('ComfyUI 没有返回 promptId')
    return result.promptId
  },

  job: async (promptId: string): Promise<JobResult> => {
    const response = await fetch('/comfyui/jobs/media?promptId=' + encodeURIComponent(promptId))
    if (!response.ok) throw new ComfyError('查不到任务状态（HTTP ' + response.status + '）')
    const payload = await response.json() as { status?: JobStatus; media?: ComfyMedia[]; error?: string }
    return {
      status: payload.status ?? 'unknown',
      media: payload.media ?? [],
      ...(payload.error === undefined ? {} : { error: payload.error }),
    }
  },
}

/**
 * Resolve a workflow NAME from config to the id the run route needs.
 *
 * Bindings store names because ids are `randomUUID()` and change whenever a
 * canvas is re-extracted. A name that no longer matches is reported rather than
 * guessed around — silently running a different workflow is worse than failing.
 */
export async function resolveWorkflowId(name: string): Promise<string> {
  const trimmed = name.trim()
  if (trimmed === '') throw new ComfyError('还没有绑定工作流，去设置页填一个。')
  const all = await comfy.workflows()
  const byName = all.find((workflow) => workflow.name === trimmed)
  if (byName !== undefined) return byName.id
  const byId = all.find((workflow) => workflow.id === trimmed)
  if (byId !== undefined) return byId.id
  throw new ComfyError(
    '工作流库里没有「' + trimmed + '」。可能是改了名或删了——'
    + '去 ComfyUI 面板确认一下，再改设置页里的绑定。',
  )
}


/**
 * Run a workflow and wait for its media.
 *
 * Polling rather than a socket because dsh-comfyui's job route is a plain GET
 * and generation here takes seconds, not milliseconds.
 */
export async function runAndWait(options: {
  workflowId: string
  parameters: Record<string, unknown>
  timeoutMs?: number
  onProgress?: (seconds: number) => void
  signal?: AbortSignal
}): Promise<ComfyMedia[]> {
  const promptId = await comfy.run(options.workflowId, options.parameters)
  const timeout = options.timeoutMs ?? 300_000
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (options.signal?.aborted === true) throw new ComfyError('已取消')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const job = await comfy.job(promptId)
    if (job.status === 'completed') {
      if (job.media.length === 0) throw new ComfyError('工作流跑完了但没有产出媒体，检查它有没有输出节点。')
      return job.media
    }
    if (job.status === 'failed') throw new ComfyError(job.error ?? 'ComfyUI 报错了')
    options.onProgress?.(Math.round((Date.now() - started) / 1000))
  }
  throw new ComfyError('等了 ' + Math.round(timeout / 1000) + ' 秒还没结果，去 ComfyUI 面板看看队列。')
}
