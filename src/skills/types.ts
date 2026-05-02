// What `loadSkills` returns: parsed but not yet wrapped as a ToolDefinition.
// Wave B turns these into ToolDefinitions whose handlers run an LLM call
// with the skill body as the system prompt.
export interface LoadedSkill {
  readonly name: string;        // from frontmatter; agentskills.io convention
  readonly description: string; // from frontmatter; shown to the LLM as the tool description
  readonly body: string;        // the markdown content after the closing `---`
  readonly path: string;        // absolute path to the SKILL.md file (for diagnostics)
}
