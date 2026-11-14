import type { NewsPopupProps } from '../model';

// Stub owned by the news worker (#13): replace with the in-panel popup (artboard 05-novedades).
export function NewsPopup({ open, onClose }: NewsPopupProps) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Novedades">
      <button type="button" onClick={onClose}>Cerrar</button>
    </div>
  );
}
