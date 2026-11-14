import { Button, RadioGroup } from '@egdev/ui';
import { useState } from 'react';
import type { FirstRunProps, Language } from '../model';
import './first-run.css';

export function FirstRun({ onChoose }: FirstRunProps) {
  const [language, setLanguage] = useState<Language>('es');
  return <section className="first-run" aria-label="Idioma / Language">
    <p className="first-run__eyebrow">Primer uso · <span lang="en">First launch</span></p>
    <h1>Elige tu idioma <span lang="en">Choose your language</span></h1>
    <p className="first-run__description">Puedes cambiarlo después en Ajustes.<br /><span lang="en">You can change it later in Settings.</span></p>
    <div className="first-run__legend">Idioma / <span lang="en">Language</span></div>
    <RadioGroup className="first-run__choices" label="Idioma / Language" orientation="horizontal" value={language}
      options={[{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }]}
      onValueChange={value => setLanguage(value as Language)} />
    <Button className="first-run__continue" type="button" lang={language} onClick={() => onChoose(language)}>
      {language === 'es' ? 'Continuar' : 'Continue'}
    </Button>
    <p className="first-run__foot">La elección se guarda en este equipo · <span lang="en">Saved on this device</span></p>
  </section>;
}
