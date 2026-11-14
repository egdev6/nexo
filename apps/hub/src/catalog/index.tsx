import type { CatalogViewProps } from '../model';

// Stub owned by the catalog worker (#13): replace with the visual catalog (artboard 04-catalogo).
export function CatalogView({ apps }: CatalogViewProps) {
  return <section aria-label="Catálogo">{apps.length} apps en el catálogo</section>;
}
