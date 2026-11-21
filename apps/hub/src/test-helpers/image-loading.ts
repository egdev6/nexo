import { vi } from 'vitest';

/** Replace only browser image transport; the UI still owns loading and fallback. */
export function mockImageLoading(failedSources = new Set<string>()) {
  const images: HTMLImageElement[] = [];
  vi.stubGlobal('Image', function mockImage() {
    const image = document.createElement('img');
    images.push(image);
    Object.defineProperties(image, {
      complete: { get: () => image.hasAttribute('src') },
      naturalWidth: { get: () => (failedSources.has(image.getAttribute('src') ?? '') ? 0 : 100) },
    });
    return image;
  });
  return images;
}
