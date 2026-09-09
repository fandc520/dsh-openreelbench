/**
 * What a registered skill is, as this plugin builds them.
 *
 * This file used to also HOLD the pipeline instructions — one 488-line document
 * covering every stage, so asking how to write a brief loaded how to mux a
 * film. That content now lives in three places with three different lifetimes:
 *
 *   - `pipeline-skill.ts`   per pipeline, rendered from `PIPELINES`: the map
 *   - `stage-skills.ts`     per stage: how to do one node
 *   - `skill-*.ts`          cross-pipeline craft: storytelling, cinematography,
 *                           sound design, review
 *
 * All that is left here is the shape they share.
 */

/**
 * A skill as `ctx.skills.register` takes it.
 *
 * `description` and `whenToUse` are the only parts a model sees before loading
 * — they are in the catalog, the body is not. So they carry the routing: what
 * this covers, and when it is the right thing to read. A description that
 * merely names the topic makes the skill invisible at the moment it is needed.
 */
export interface RuntimeSkill {
  name: string
  source: string
  description: string
  whenToUse: string
  content: string
}
