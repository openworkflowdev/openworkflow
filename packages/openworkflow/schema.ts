/**
 * Structural types for supported workflow input schemas. These mirror the
 * public shapes from common validation libraries so we can infer types without
 * depending on those packages directly.
 *
 * This file has been inspired by the `schemaTask` provided by trigger.dev.
 * See reference file: https://github.com/triggerdotdev/trigger.dev/blob/main/packages/core/src/v3/types/schemas.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */

export interface WorkflowSchemaZodLike<TInput, TParsed> {
  _input: TInput;
  _output: TParsed;
  parse?: (value: unknown) => TParsed;
  parseAsync?: (value: unknown) => Promise<TParsed>;
  safeParse?: (value: unknown) => { success: boolean; data?: TParsed };
}

export interface WorkflowSchemaValibotLike<TInput, TParsed> {
  schema: {
    _types?: {
      input: TInput;
      output: TParsed;
    };
  };
}

export interface WorkflowSchemaArkTypeLike<TInput, TParsed> {
  inferIn: TInput;
  infer: TParsed;
  assert?: (value: unknown) => asserts value is TParsed;
}

export type WorkflowSchemaPlainValidator<TInput> = (
  value: unknown,
) => Promise<TInput> | TInput;

export interface WorkflowSchemaSimpleParse<TInput> {
  parse: (value: unknown) => TInput;
}

export interface WorkflowSchemaSuperstructLike<TInput> {
  create: (value: unknown) => TInput;
}

export interface WorkflowSchemaYupLike<TInput> {
  validateSync: (value: unknown) => TInput;
}

export interface WorkflowSchemaScaleLike<TInput> {
  assert(value: unknown): asserts value is TInput;
}

export type WorkflowSchemaWithInOut<TInput, TParsed> =
  | WorkflowSchemaZodLike<TInput, TParsed>
  | WorkflowSchemaValibotLike<TInput, TParsed>
  | WorkflowSchemaArkTypeLike<TInput, TParsed>;

export type WorkflowSchemaWithoutIn<TInput> =
  | WorkflowSchemaPlainValidator<TInput>
  | WorkflowSchemaSimpleParse<TInput>
  | WorkflowSchemaSuperstructLike<TInput>
  | WorkflowSchemaYupLike<TInput>
  | WorkflowSchemaScaleLike<TInput>;

export type WorkflowInputSchema =
  | WorkflowSchemaWithInOut<any, any>
  | WorkflowSchemaWithoutIn<any>;

export type InferWorkflowSchema<TSchema extends WorkflowInputSchema> =
  TSchema extends WorkflowSchemaWithInOut<infer TIn, infer TOut>
    ? { in: TIn; out: TOut }
    : TSchema extends WorkflowSchemaWithoutIn<infer TBoth>
      ? { in: TBoth; out: TBoth }
      : never;

export type InferWorkflowSchemaIn<
  TSchema extends WorkflowInputSchema | undefined,
  TDefault = unknown,
> = TSchema extends WorkflowInputSchema
  ? InferWorkflowSchema<TSchema>["in"]
  : TDefault;

export type InferWorkflowSchemaOut<
  TSchema extends WorkflowInputSchema | undefined,
  TDefault = unknown,
> = TSchema extends WorkflowInputSchema
  ? InferWorkflowSchema<TSchema>["out"]
  : TDefault;

export type WorkflowSchemaParseFn<TParsed, TRaw = unknown> = (
  value: TRaw,
) => Promise<TParsed> | TParsed;

/**
 * Normalizes a schema input (function, validator object, etc.) into an async
 * parser function. Supports popular validation libraries and custom validators.
 */
export function getWorkflowSchemaParseFn<TSchema extends WorkflowInputSchema>(
  schema: TSchema,
): WorkflowSchemaParseFn<
  InferWorkflowSchemaOut<TSchema>,
  InferWorkflowSchemaIn<TSchema>
> {
  const parser = schema as any;

  if (typeof parser === "function" && typeof parser.assert === "function") {
    return parser.assert.bind(parser);
  }

  if (typeof parser === "function") {
    return parser;
  }

  if (typeof parser.parseAsync === "function") {
    return parser.parseAsync.bind(parser);
  }

  if (typeof parser.parse === "function") {
    return parser.parse.bind(parser);
  }

  if (typeof parser.validateSync === "function") {
    return parser.validateSync.bind(parser);
  }

  if (typeof parser.create === "function") {
    return parser.create.bind(parser);
  }

  if (typeof parser.assert === "function") {
    return (value) => {
      parser.assert(value);
      return value as InferWorkflowSchemaOut<TSchema>;
    };
  }

  throw new Error("Could not find a schema validator");
}
