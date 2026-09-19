import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';

// The site's mark: the uploaded logo when there is one, otherwise a gradient
// tile with a short monogram derived from the site name, so a fresh install
// still has a brand in the corner rather than a blank space.

/** "a2zNovel" -> "a2z", "NovelHub" -> "NH", "Apex NovelHub" -> "AN". */
const monogram = (name = '') => {
  const words = name.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) || [];
  if (!words.length) return 'N';
  if (words[0].length <= 3) return words[0];
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
};

const SIZES = {
  sm: 'h-8 w-8 rounded-[10px] text-[11px]',
  md: 'h-9 w-9 rounded-xl text-xs',
  lg: 'h-12 w-12 rounded-2xl text-sm',
};

export const BrandMark = ({ size = 'md', className = '' }) => {
  const { settings } = useSettings();
  const box = SIZES[size] || SIZES.md;

  if (settings?.logoUrl) {
    return (
      <img
        src={settings.logoUrl}
        alt=""
        aria-hidden="true"
        className={`${box} shrink-0 object-cover ring-1 ring-white/10 ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${box} grid shrink-0 place-items-center bg-gradient-to-br from-crimson to-crimson-alt font-display font-extrabold tracking-tight text-white shadow-glow ${className}`}
    >
      {monogram(settings?.siteName)}
    </span>
  );
};

const BrandLink = ({ size = 'md', className = '', nameClassName = '' }) => {
  const { settings } = useSettings();
  return (
    <Link to="/" className={`flex min-w-0 items-center gap-2.5 ${className}`} aria-label={`${settings?.siteName || 'Home'} home`}>
      <BrandMark size={size} />
      <span className={`truncate font-display text-lg font-extrabold text-silver ${nameClassName}`}>
        {settings?.siteName || ''}
      </span>
    </Link>
  );
};

export default BrandLink;
