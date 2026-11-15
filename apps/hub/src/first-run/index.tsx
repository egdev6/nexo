import { Button, RadioGroup } from '@egdev/ui';
import { useState } from 'react';
import type { FirstRunProps, Language } from '../model';
import { t } from '../i18n';
import './first-run.css';

export function FirstRun({ onChoose, onPreview }: FirstRunProps) {
  const [language, setLanguage] = useState<Language>('es');
  return <section className="first-run" aria-label={t('es', 'firstRun.label')}>
    <p className="first-run__eyebrow"><span lang="es">{t('es', 'firstRun.eyebrowEs')}</span> <span lang="en">{t('es', 'firstRun.eyebrowEn')}</span></p>
    <h1><span lang="es">{t('es', 'firstRun.titleEs')}</span> <span aria-hidden="true">-</span> <span lang="en">{t('es', 'firstRun.titleEn')}</span></h1>
    <p className="first-run__description"><span lang="es">{t('es', 'firstRun.hintEs')}</span> <span aria-hidden="true">-</span> <span lang="en">{t('es', 'firstRun.hintEn')}</span></p>
    <div className="first-run__legend"><span lang="es">{t('es', 'firstRun.languageEs')}</span> <span lang="en">{t('es', 'firstRun.languageEn')}</span></div>
    <RadioGroup className="first-run__choices" label={t('es', 'firstRun.label')} orientation="horizontal" value={language}
      options={[{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }]}
      onValueChange={value => { const next = value as Language; setLanguage(next); onPreview?.(next); }} />
    <Button className="first-run__continue" type="button" lang={language} onClick={() => onChoose(language)}>
      {t(language, 'firstRun.continue')}
    </Button>
    <p className="first-run__foot"><span lang="es">{t('es', 'firstRun.footEs')}</span> <span lang="en">{t('es', 'firstRun.footEn')}</span></p>
  </section>;
}
