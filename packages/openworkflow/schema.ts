/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */

export interface WorkflowSchemaZodLike<Input, Output> {
  _input: Input;
  _output: Output;
  parse?: (value: unknown) => Output;
  parseAsync?: (value: unknown) => Promise<Output>;
  safeParse?: (value: unknown) => { success: boolean; data?: Output };
}

export interface WorkflowSchemaValibotLike<Input, Output> {
  schema: {
    _types?: {
      input: Input;
      output: Output;
    };
  };
}

export interface WorkflowSchemaArkTypeLike<Input, Output> {
  inferIn: Input;
  infer: Output;
  assert?: (value: unknown) => asserts value is Output;
}

export type WorkflowSchemaPlainValidator<Input> = (
  value: unknown,
) => Promise<Input> | Input;

export interface WorkflowSchemaSimpleParse<Input> {
  parse: (value: unknown) => Input;
}

export interface WorkflowSchemaSuperstructLike<Input> {
  create: (value: unknown) => Input;
}

export interface WorkflowSchemaYupLike<Input> {
  validateSync: (value: unknown) => Input;
}

export interface WorkflowSchemaScaleLike<Input> {
  assert(value: unknown): asserts value is Input;
}

export type WorkflowSchemaWithInOut<Input, Output> =
  | WorkflowSchemaZodLike<Input, Output>
  | WorkflowSchemaValibotLike<Input, Output>
  | WorkflowSchemaArkTypeLike<Input, Output>;

export type WorkflowSchemaWithoutIn<Input> =
  | WorkflowSchemaPlainValidator<Input>
  | WorkflowSchemaSimpleParse<Input>
  | WorkflowSchemaSuperstructLike<Input>
  | WorkflowSchemaYupLike<Input>
  | WorkflowSchemaScaleLike<Input>;

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
