import type { FirstRunProps } from '../model';

// Stub owned by the settings worker (#13): replace with the language choice (artboard 07-primer-uso).
export function FirstRun({ onChoose }: FirstRunProps) {
  return (
    <section aria-label="Idioma">
      <button type="button" onClick={() => onChoose('es')}>Español</button>
      <button type="button" onClick={() => onChoose('en')}>English</button>
    </section>
  );
}
