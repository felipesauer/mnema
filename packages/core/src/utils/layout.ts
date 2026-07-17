/**
 * The fixed `.mnema/` layout. The folder structure is mnema's EXCLUSIVE
 * control: it is not user-configurable, so every artefact lives at a
 * known relative path under the project root. Multi-project (when it
 * comes) multiplexes the PROJECT ROOT, never these sub-paths.
 *
 * Services keep taking `projectRoot` as a parameter and join it with
 * these constants.
 */
export const LAYOUT = {
  state: '.mnema/state',
  audit: '.mnema/audit',
  backlog: '.mnema/backlog',
  sprints: '.mnema/sprints',
  roadmap: '.mnema/roadmap',
  memory: '.mnema/memory',
  observations: '.mnema/observations',
  skills: '.mnema/skills',
  commands: '.mnema/commands',
  templates: '.mnema/templates',
  workflows: '.mnema/workflows',
} as const;

/** The relative sub-paths of the fixed layout. */
export type LayoutKey = keyof typeof LAYOUT;
