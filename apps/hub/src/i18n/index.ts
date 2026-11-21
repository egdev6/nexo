import messages from './messages.json';
import type { Language } from '../model';

type Paths<T> = T extends string ? [] : { [K in keyof T & string]: [K, ...Paths<T[K]>] }[keyof T & string];
type Join<T extends string[]> = T extends [infer F extends string, ...infer R extends string[]] ? (R['length'] extends 0 ? F : `${F}.${Join<R>}`) : never;
export type MessageKey = Join<Paths<typeof messages.es>>;
export type Params = Record<string, string | number>;

export function formatMessage(template: string, params?: Params): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (params && Object.hasOwn(params, key) ? String(params[key]) : match));
}

function lookup(tree: unknown, key: string): string | undefined {
  let value = tree;
  for (const part of key.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' && value.length ? value : undefined;
}

export function translate(es: unknown, en: unknown, locale: Language, key: string, params?: Params): string {
  return formatMessage(lookup(locale === 'en' ? en : es, key) ?? lookup(es, key) ?? key, params);
}
export function t(locale: Language, key: MessageKey, params?: Params): string {
  return translate(messages.es, messages.en, locale, key, params);
}
export const intlLocale = (locale: Language): 'es-ES' | 'en-US' => (locale === 'en' ? 'en-US' : 'es-ES');
export const formatNumber = (locale: Language, number: number) => new Intl.NumberFormat(intlLocale(locale)).format(number);
