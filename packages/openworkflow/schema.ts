/**
 * Structural types for supported workflow input schemas. These mirror the
 * public shapes from common validation libraries so we can infer types without
 * depending on those packages directly.
 */
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
    // arktype-style schema functions expose both a callable validator and an assert helper
    return parser.assert.bind(parser);
  }

  if (typeof parser === "function") {
    // valibot >= v0.31 or any custom validator function
    return parser;
  }

  if (typeof parser.parseAsync === "function") {
    // zod schemas prefer parseAsync when available
    return parser.parseAsync.bind(parser);
  }

  if (typeof parser.parse === "function") {
    // zod schemas (legacy sync) or valibot < v0.13
    return parser.parse.bind(parser);
  }

  if (typeof parser.validateSync === "function") {
    // yup schemas
    return parser.validateSync.bind(parser);
  }

  if (typeof parser.create === "function") {
    // superstruct schemas
    return parser.create.bind(parser);
  }

  if (typeof parser.assert === "function") {
    // scale and similar assertion-based validators
    return (value) => {
      parser.assert(value);
      return value as InferWorkflowSchemaOut<TSchema>;
    };
  }

  throw new Error("Could not find a schema validator");
}
