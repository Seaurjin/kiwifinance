/**
 * Packaging a report as an Agent Skill (FR-OPN-02, FR-OPN-03).
 *
 * A saved report is already a spec; a Skill is that spec plus the instructions
 * an agent needs to run it somewhere else. Exporting one is therefore a
 * transformation, not a second authoring step — which is the point of having
 * made reports data in the first place.
 *
 * The bundle follows the agentskills.io layout: a SKILL.md with YAML
 * frontmatter whose name and description are read first, and the rest loaded
 * only when the skill is actually used.
 */

import type { ReportSpec } from './types.ts';

export interface SkillBundle {
  /** Directory name for the skill. */
  readonly slug: string;
  /** Published path → file contents. */
  readonly files: Readonly<Record<string, string>>;
}

export interface SkillExportOptions {
  /** Where the agent should send kiwi_run_report, if it has the connector. */
  readonly mcpServerName?: string;
  /** Shown in the skill so a reader knows which ledger it was written for. */
  readonly ledgerName?: string;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length === 0 ? 'kiwi-report' : slug;
}

/** YAML needs quoting when a value could be read as something else. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function describeBlocks(spec: ReportSpec): string {
  return spec.blocks
    .map((block) => {
      switch (block.type) {
        case 'metric_row':
          return `- **${block.title ?? 'Figures'}** — ${block.metrics.join(', ')}`;
        case 'chart':
          return `- **${block.title ?? 'Chart'}** — ${block.metric}, drawn as a ${block.viz.replace('_', ' ')}`;
        case 'table':
          return `- **${block.title ?? 'Table'}** — ${block.metric}${
            block.limit === undefined ? '' : `, top ${block.limit}`
          }`;
        case 'narrative':
          return `- **Reading** — a written summary, focused on ${
            block.focus?.join(', ') ?? 'the whole report'
          }`;
      }
    })
    .join('\n');
}

export function exportReportAsSkill(
  name: string,
  spec: ReportSpec,
  options: SkillExportOptions = {},
): SkillBundle {
  const slug = slugify(name);
  const server = options.mcpServerName ?? 'kiwi-finance';

  const description =
    `Run the "${name}" report against the owner's Kiwi Finance ledger and read the result. ` +
    `Use when they ask about ${spec.blocks
      .flatMap((block) =>
        block.type === 'metric_row'
          ? block.metrics
          : block.type === 'chart' || block.type === 'table'
            ? [block.metric]
            : [],
      )
      .slice(0, 4)
      .join(', ')
      .replace(/_/g, ' ')}.`;

  const skillMd = `---
name: ${yamlString(slug)}
description: ${yamlString(description)}
---

# ${name}

${options.ledgerName === undefined ? '' : `Written for the **${options.ledgerName}** ledger.\n`}
## What this produces

${describeBlocks(spec)}

Figures are reported in ${spec.baseCurrency ?? 'the ledger base currency'} at the ${
    spec.fxMode === 'reporting' ? 'reporting rate' : 'rate actually paid'
  }.

## How to run it

Call the \`kiwi_run_report\` tool on the \`${server}\` connector, passing the spec in
\`spec.json\` and the period you want:

\`\`\`json
{ "spec": <contents of spec.json>, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
\`\`\`

If the connector is not available, ask the owner to add it from Kiwi's settings.
Without it there is no way to run this, and no figure should be produced from
memory or estimated.

## Reading the result

The tool returns a **fact set**: every figure with its unit, its currency, the
basis it was computed under, and \`sourceTxnIds\` — the transactions it came from.

Two rules when writing about it:

1. **Every number you write must appear in the fact set.** Do not add figures
   together, do not compute a percentage the fact set does not contain, and do
   not carry a number over from a previous run. Kiwi checks narratives against
   the fact set and rejects any number it did not compute.
2. **Say what basis a figure is on** when it matters — a converted amount at the
   rate paid is not the same measure as one at a common reporting rate.

If a figure comes back \`null\`, it carries an \`unavailableReason\`. Say that
reason; do not substitute an estimate.
`;

  return {
    slug,
    files: {
      'SKILL.md': skillMd,
      'spec.json': `${JSON.stringify(spec, null, 2)}\n`,
      'README.md': `# ${name}\n\nExported from Kiwi Finance.\n\nDrop this folder into your agent's\nskills directory. It needs the \`${server}\` MCP connector to reach the ledger;\nthe spec itself contains no financial data, only the description of what to\ncompute.\n`,
    },
  };
}
