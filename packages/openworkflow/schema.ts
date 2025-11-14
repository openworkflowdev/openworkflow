/**
 * Structural types for supported workflow input schemas. These mirror the
 * public shapes from common validation libraries so we can infer types without
 * depending on those packages directly.
 *
 * This file has been inspired by the `schemaTask` provided by trigger.dev.
 * See reference file: https://github.com/triggerdotdev/trigger.dev/blob/main/packages/core/src/v3/types/schemas.ts
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
  | WorkflowSchemaWithInOut<unknown, unknown>
  | WorkflowSchemaWithoutIn<unknown>;

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
  if (hasCallableProperty(schema, "assert")) {
    const schemaWithAssert: WorkflowSchemaArkTypeLike<
      InferWorkflowSchemaIn<TSchema>,
      InferWorkflowSchemaOut<TSchema>
    > &
      WorkflowSchemaScaleLike<InferWorkflowSchemaOut<TSchema>> & {
        assert: WorkflowSchemaScaleLike<
          InferWorkflowSchemaOut<TSchema>
        >["assert"];
      } =
      schema as WorkflowSchemaArkTypeLike<
        InferWorkflowSchemaIn<TSchema>,
        InferWorkflowSchemaOut<TSchema>
      > &
        WorkflowSchemaScaleLike<InferWorkflowSchemaOut<TSchema>> & {
          assert: WorkflowSchemaScaleLike<
            InferWorkflowSchemaOut<TSchema>
          >["assert"];
        };

    const assertFn: WorkflowSchemaScaleLike<
      InferWorkflowSchemaOut<TSchema>
    >["assert"] = schemaWithAssert.assert;

    return (value: InferWorkflowSchemaIn<TSchema>) => {
      assertFn(value);
      return value as InferWorkflowSchemaOut<TSchema>;
    };
  }

  if (typeof schema === "function") {
    return schema as WorkflowSchemaParseFn<
      InferWorkflowSchemaOut<TSchema>,
      InferWorkflowSchemaIn<TSchema>
    >;
  }

  if (hasCallableProperty(schema, "parseAsync")) {
    const schemaWithParseAsync =
      schema as WorkflowSchemaZodLike<
        InferWorkflowSchemaIn<TSchema>,
        InferWorkflowSchemaOut<TSchema>
      > & {
        parseAsync: (
          value: InferWorkflowSchemaIn<TSchema>,
        ) => Promise<InferWorkflowSchemaOut<TSchema>>;
      };

    return (value: InferWorkflowSchemaIn<TSchema>) =>
      schemaWithParseAsync.parseAsync(value);
  }

  if (hasCallableProperty(schema, "parse")) {
    const schemaWithParse =
      schema as WorkflowSchemaZodLike<
        InferWorkflowSchemaIn<TSchema>,
        InferWorkflowSchemaOut<TSchema>
      > &
        WorkflowSchemaSimpleParse<InferWorkflowSchemaOut<TSchema>> & {
          parse: (
            value: InferWorkflowSchemaIn<TSchema>,
          ) => InferWorkflowSchemaOut<TSchema>;
        };

    return (value: InferWorkflowSchemaIn<TSchema>) =>
      schemaWithParse.parse(value);
  }

  if (hasCallableProperty(schema, "validateSync")) {
    const schemaWithValidate =
      schema as WorkflowSchemaYupLike<InferWorkflowSchemaOut<TSchema>> & {
        validateSync: (
          value: InferWorkflowSchemaIn<TSchema>,
        ) => InferWorkflowSchemaOut<TSchema>;
      };

    return (value: InferWorkflowSchemaIn<TSchema>) =>
      schemaWithValidate.validateSync(value);
  }

  if (hasCallableProperty(schema, "create")) {
    const schemaWithCreate =
      schema as WorkflowSchemaSuperstructLike<
        InferWorkflowSchemaOut<TSchema>
      > & {
        create: (
          value: InferWorkflowSchemaIn<TSchema>,
        ) => InferWorkflowSchemaOut<TSchema>;
      };

    return (value: InferWorkflowSchemaIn<TSchema>) =>
      schemaWithCreate.create(value);
  }

  throw new Error("Could not find a schema validator");
}

type SchemaWithProperty<TKey extends string> = WorkflowInputSchema &
  Record<TKey, (...args: never[]) => unknown>;

function hasCallableProperty<TKey extends string>(
  schema: WorkflowInputSchema,
  property: TKey,
): schema is SchemaWithProperty<TKey> {
  if (typeof schema === "function") {
    const candidate = schema as unknown as Record<string, unknown>;
    return typeof candidate[property] === "function";
  }

  if (typeof schema === "object") {
    const candidate = schema as unknown as Record<string, unknown>;
    return typeof candidate[property] === "function";
  }

  return false;
}
