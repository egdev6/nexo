import type { SettingsViewProps } from '../model';

// Stub owned by the settings worker (#13): replace with the tabbed settings (artboard 06-ajustes).
export function SettingsView({ onClose }: SettingsViewProps) {
  return (
    <section aria-label="Ajustes">
      <button type="button" onClick={onClose}>Volver</button>
    </section>
  );
}
