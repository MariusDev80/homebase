import * as v from 'valibot';

export const helloConfigSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(40)),
});
export type HelloConfig = v.InferOutput<typeof helloConfigSchema>;
export const HELLO_CONFIG_VERSION = 1;
export const helloDefaults = (): HelloConfig => ({ name: 'monde' });
