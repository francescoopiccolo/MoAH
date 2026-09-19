import { Type } from "typebox";

export { Type };

export function StringEnum<T extends readonly string[]>(values: T): unknown {
  return Type.Union(values.map(value => Type.Literal(value)) as any);
}
