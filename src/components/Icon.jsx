import { ICON_SVG, iconKeyFor } from './icons.generated';

// Hand-drawn icon. `e` is an emoji (as stored in category data or used in the
// UI) or an icon key; it is drawn in `color` (default: the text colour).
export default function Icon({ e, size = 20, color, className = '', title }) {
  const svg = ICON_SVG[iconKeyFor(e)].replace('<svg', '<svg width="100%" height="100%"');
  return (
    <span
      className={`icon ${className}`}
      style={{ width: size, height: size, color }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
