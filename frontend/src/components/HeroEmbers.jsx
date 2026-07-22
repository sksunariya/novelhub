import { useMemo } from 'react';
import { motion } from 'framer-motion';

const EMBER_COUNT = 10;

const randomBetween = (min, max) => min + Math.random() * (max - min);

const HeroEmbers = () => {
  const embers = useMemo(
    () =>
      Array.from({ length: EMBER_COUNT }, (_, index) => ({
        id: index,
        left: randomBetween(4, 96),
        size: randomBetween(2, 5),
        duration: randomBetween(7, 13),
        delay: randomBetween(0, 6),
        drift: randomBetween(-24, 24),
      })),
    []
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {embers.map((ember) => (
        <motion.span
          key={ember.id}
          className="absolute rounded-full bg-crimson"
          style={{
            left: `${ember.left}%`,
            bottom: '-10%',
            width: ember.size,
            height: ember.size,
            boxShadow: '0 0 6px 1px rgba(220,38,38,0.8)',
          }}
          initial={{ opacity: 0, y: 0, x: 0 }}
          animate={{ opacity: [0, 0.8, 0], y: -260, x: ember.drift }}
          transition={{
            duration: ember.duration,
            delay: ember.delay,
            repeat: Infinity,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  );
};

export default HeroEmbers;
