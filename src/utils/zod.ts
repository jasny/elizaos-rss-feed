import { z } from 'zod';
import { UUID } from '@elizaos/core';

export function getSchemaDescription(schema: z.ZodTypeAny, fieldName = ''): string {
    const { description } = schema._def;

    if (schema instanceof z.ZodObject) {
        const shape = schema.shape;
        const fields = Object.entries(shape)
            .map(([key, value]) => getSchemaDescription(value as any, key))
            .join('\n');
        return (description ? `${description}:\n` : '') + fields;
    }
    if (schema instanceof z.ZodUnion) {
        const types = schema.options
            .map((option) => option.constructor.name.replace('Zod', '').toLowerCase())
            .join(' | ');
        return `- **${fieldName}** (${types}): ${description || ''}`;
    }
    if (schema instanceof z.ZodString) {
        return `- **${fieldName}** (string): ${description || ''}`;
    }
    if (schema instanceof z.ZodArray) {
        const itemType = schema._def.type.constructor.name.replace('Zod', '').toLowerCase();
        return `- **${fieldName}** (${itemType}[]): ${description || ''}`;
    }
    if (schema instanceof z.ZodDefault) {
        const innerDescription = getSchemaDescription(schema._def.innerType, fieldName);
        return `${innerDescription} - defaults to "${schema._def.defaultValue()}"`;
    }
    if (schema instanceof z.ZodNumber) {
        return `- **${fieldName}** (number): ${description || ''}`;
    }
    if (schema instanceof z.ZodBoolean) {
        return `- **${fieldName}** (boolean): ${description || ''}`;
    }
    return `- **${fieldName}**: ${description || ''}`;
}

const uuidSchema = z.string().uuid() as z.ZodType<UUID>;

export function isValidUuid(value: string): value is UUID {
    return uuidSchema.safeParse(value).success;
}
