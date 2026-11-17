import { Button, RadioGroup, SectionHeader } from '@egdev/ui';
import { useState } from 'react';
import type { FirstRunProps, Language } from '../model';
import { t } from '../i18n';
import './first-run.css';

export function FirstRun({ onChoose, onPreview }: FirstRunProps) {
  const [language, setLanguage] = useState<Language>('es');
  return <section className="first-run" aria-label={t('es', 'firstRun.label')}>
    <SectionHeader className="first-run__intro" level={1}
      eyebrow={[[t('es', 'firstRun.eyebrowEs'), 'es'], [' '], [t('es', 'firstRun.eyebrowEn'), 'en']]}
      title={[[t('es', 'firstRun.titleEs'), 'es'], [' '], ['-', undefined, true], [' '], [t('es', 'firstRun.titleEn'), 'en']]}
      lede={[[t('es', 'firstRun.hintEs'), 'es'], [' '], ['-', undefined, true], [' '], [t('es', 'firstRun.hintEn'), 'en']]} />
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
