import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';

const TILT_RANGE = 10;

const HeroLogo = ({ src, alt, variants }) => {
  const ref = useRef(null);
  const shouldReduceMotion = useReducedMotion();
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 150, damping: 18 });
  const springY = useSpring(pointerY, { stiffness: 150, damping: 18 });
  const rotateX = useTransform(springY, [-0.5, 0.5], [TILT_RANGE, -TILT_RANGE]);
  const rotateY = useTransform(springX, [-0.5, 0.5], [-TILT_RANGE, TILT_RANGE]);

  const handlePointerMove = (event) => {
    if (shouldReduceMotion || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    pointerX.set((event.clientX - rect.left) / rect.width - 0.5);
    pointerY.set((event.clientY - rect.top) / rect.height - 0.5);
  };

  const resetTilt = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  return (
    <motion.div variants={variants} className="relative mx-auto mb-6 h-28 w-28 sm:h-36 sm:w-36" style={{ perspective: 600 }}>
      <motion.div
        className="absolute inset-[-14%] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(220,38,38,0.55), transparent 70%)' }}
        animate={shouldReduceMotion ? { opacity: 0.5 } : { opacity: [0.35, 0.65, 0.35], scale: [0.96, 1.05, 0.96] }}
        transition={shouldReduceMotion ? undefined : { duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden="true"
      />
      <motion.img
        ref={ref}
        src={src}
        alt={alt}
        onPointerMove={handlePointerMove}
        onPointerLeave={resetTilt}
        style={{ rotateX: shouldReduceMotion ? 0 : rotateX, rotateY: shouldReduceMotion ? 0 : rotateY, transformStyle: 'preserve-3d' }}
        className="relative h-full w-full rounded-full object-cover shadow-glow"
      />
    </motion.div>
  );
};

export default HeroLogo;
