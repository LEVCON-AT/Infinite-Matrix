import type { z } from 'zod';

/**
 * Minimaler Zod → JSON-Schema-Konverter.
 * Deckt die für MATRIX_TOOLS nötigen Typen ab:
 * string, number, boolean, enum, array, object, optional.
 *
 * Für Produktions-Qualität könnte man zod-to-json-schema nutzen,
 * aber das spart eine Dependency bei den wenigen Schemas, die wir haben.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return convertNode(schema);
}

function convertNode(schema: z.ZodType): Record<string, unknown> {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const typeName = def.typeName as string;

  switch (typeName) {
    case 'ZodString':
      return withDescription(schema, { type: 'string' });

    case 'ZodNumber':
      return withDescription(schema, { type: 'number' });

    case 'ZodBoolean':
      return withDescription(schema, { type: 'boolean' });

    case 'ZodEnum': {
      const values = def.values as string[];
      return withDescription(schema, { type: 'string', enum: values });
    }

    case 'ZodOptional':
      return convertNode(def.innerType as z.ZodType);

    case 'ZodDefault':
      return {
        ...convertNode(def.innerType as z.ZodType),
        default: (def.defaultValue as () => unknown)(),
      };

    case 'ZodArray': {
      const itemSchema = convertNode(def.type as z.ZodType);
      return withDescription(schema, { type: 'array', items: itemSchema });
    }

    case 'ZodObject': {
      const shape = (def.shape as () => Record<string, z.ZodType>)();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, fieldSchema] of Object.entries(shape)) {
        properties[key] = convertNode(fieldSchema);
        if (!isOptional(fieldSchema)) {
          required.push(key);
        }
      }

      const result: Record<string, unknown> = {
        type: 'object',
        properties,
      };
      if (required.length > 0) result.required = required;
      return withDescription(schema, result);
    }

    case 'ZodRecord': {
      const valueSchema = convertNode(def.valueType as z.ZodType);
      return withDescription(schema, {
        type: 'object',
        additionalProperties: valueSchema,
      });
    }

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (def.options as z.ZodType[]).map(convertNode);
      return withDescription(schema, { oneOf: options });
    }

    case 'ZodLiteral':
      return withDescription(schema, { const: def.value });

    default:
      return {};
  }
}

function isOptional(schema: z.ZodType): boolean {
  const typeName = (schema as unknown as { _def: Record<string, unknown> })._def.typeName as string;
  if (typeName === 'ZodOptional') return true;
  if (typeName === 'ZodDefault') return true;
  return false;
}

function withDescription(
  schema: z.ZodType,
  result: Record<string, unknown>,
): Record<string, unknown> {
  const desc = schema.description;
  if (desc) result.description = desc;
  return result;
}
