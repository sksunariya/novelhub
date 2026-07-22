import { useState } from 'react';
import { Star } from 'lucide-react';

const STARS = [1, 2, 3, 4, 5];

const StarRating = ({ value = 0, onChange, size = 'h-5 w-5' }) => {
  const [hover, setHover] = useState(0);
  const interactive = Boolean(onChange);
  const shown = hover || value;

  return (
    <div className="flex items-center gap-0.5" role={interactive ? 'radiogroup' : undefined} aria-label="Rating">
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={() => onChange && onChange(star)}
          onMouseEnter={() => interactive && setHover(star)}
          onMouseLeave={() => interactive && setHover(0)}
          className={interactive ? 'flex cursor-pointer items-center justify-center p-1.5' : 'flex items-center justify-center p-0.5'}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
        >
          <Star
            className={`${size} transition-colors duration-150 ${
              star <= shown ? 'fill-crimson text-crimson' : 'text-silver-muted'
            }`}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
};

export default StarRating;
