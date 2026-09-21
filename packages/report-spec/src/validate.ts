/**
 * Spec validation.
 *
 * Two gates, both hard failures (FR-ANA-02 — "invalid is rejected, never
 * degraded and never guessed"):
 *
 *   1. Structural — does it match the JSON Schema.
 *   2. Semantic   — do the metric ids exist, does the period make sense, is
 *                   the requested metric shape right for the block it sits in.
 *
 * The error message is written for the model that produced the spec: it names
 * the offending path and what would have been acceptable, so a retry has
 * something to act on.
 */

import { isIsoDate } from '@kiwi/core';
import { defaultRegistry, type MetricRegistry } from '@kiwi/metrics';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import schema from './schema.json' with { type: 'json' };
import type { ReportSpec, SpecBlock } from './types.ts';

export interface SpecViolation {
  /** JSON pointer into the spec, e.g. /blocks/2/metric. */
  readonly path: string;
  readonly message: string;
}

export class SpecValidationError extends Error {
  constructor(readonly violations: readonly SpecViolation[]) {
    super(
      `Report spec is invalid and was rejected:\n` +
        violations.map((v) => `  ${v.path || '/'}: ${v.message}`).join('\n'),
    );
    this.name = 'SpecValidationError';
  }
}

// The spec is authored against draft 2020-12, so it needs ajv's 2020 build;
// the default export only understands draft-07 and would reject the $schema.
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const compiled: ValidateFunction = ajv.compile(schema);

function structuralViolations(errors: readonly ErrorObject[] | null | undefined): SpecViolation[] {
  if (!errors) return [];
  return errors.map((error) => ({
    path: error.instancePath,
    message:
      error.keyword === 'additionalProperties'
        ? `Unknown field "${String(error.params['additionalProperty'])}". The spec schema is closed; remove it.`
        : `${error.message ?? 'is invalid'}${
            error.keyword === 'enum'
              ? ` (allowed: ${(error.params['allowedValues'] as string[]).join(', ')})`
              : ''
          }`,
  }));
}

function blockMetricIds(block: SpecBlock): { path: string; id: string }[] {
  switch (block.type) {
    case 'metric_row':
      return block.metrics.map((id, index) => ({ path: `/metrics/${index}`, id }));
    case 'chart':
    case 'table':
      return [{ path: '/metric', id: block.metric }];
    case 'narrative':
      return [];
  }
}

function semanticViolations(spec: ReportSpec, registry: MetricRegistry): SpecViolation[] {
  const violations: SpecViolation[] = [];

  if (!isIsoDate(spec.period.from)) {
    violations.push({ path: '/period/from', message: `"${spec.period.from}" is not a real date.` });
  }
  if (!isIsoDate(spec.period.to)) {
    violations.push({ path: '/period/to', message: `"${spec.period.to}" is not a real date.` });
  }
  if (isIsoDate(spec.period.from) && isIsoDate(spec.period.to) && spec.period.from > spec.period.to) {
    violations.push({
      path: '/period',
      message: `Period starts (${spec.period.from}) after it ends (${spec.period.to}).`,
    });
  }

  const known = registry.ids();
  spec.blocks.forEach((block, index) => {
    for (const { path, id } of blockMetricIds(block)) {
      if (!registry.has(id)) {
        violations.push({
          path: `/blocks/${index}${path}`,
          message: `Unknown metric "${id}". Only registry metrics may be named: ${known.join(', ')}.`,
        });
        continue;
      }

      const definition = registry.get(id);
      if ((block.type === 'chart' || block.type === 'table') && definition.returns !== 'series') {
        violations.push({
          path: `/blocks/${index}${path}`,
          message:
            `Metric "${id}" returns a single figure, so it cannot fill a ${block.type} block. ` +
            `Put it in a metric_row, or choose a metric that returns a series.`,
        });
      }
      if (block.type === 'metric_row' && definition.returns !== 'scalar') {
        violations.push({
          path: `/blocks/${index}${path}`,
          message:
            `Metric "${id}" returns a series, so it cannot sit in a metric_row. ` +
            `Use a chart or table block for it.`,
        });
      }
    }
  });

  return violations;
}

/** Returns the violations rather than throwing. Empty means valid. */
export function validateSpec(
  input: unknown,
  registry: MetricRegistry = defaultRegistry,
): SpecViolation[] {
  const structural = structuralViolations(compiled(input) ? [] : compiled.errors);
  if (structural.length > 0) return structural;
  return semanticViolations(input as ReportSpec, registry);
}

/** Throws SpecValidationError on the first invalid spec. Never degrades. */
export function parseSpec(input: unknown, registry: MetricRegistry = defaultRegistry): ReportSpec {
  const violations = validateSpec(input, registry);
  if (violations.length > 0) throw new SpecValidationError(violations);
  return input as ReportSpec;
}

/** The schema itself, for publishing to a planner or over MCP. */
export const REPORT_SPEC_SCHEMA = schema;
