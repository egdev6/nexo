import { createContext, createElement, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Language, StoredSettings } from '../model';

const LocaleContext = createContext<Language>('es');
export const localeFrom = (settings: StoredSettings | null | undefined): Language => settings?.language === 'en' ? 'en' : 'es';

export function LocaleProvider({ locale, children }: { locale: Language; children: ReactNode }) {
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return createElement(LocaleContext.Provider, { value: locale }, children);
}
export const useLocale = () => useContext(LocaleContext);
