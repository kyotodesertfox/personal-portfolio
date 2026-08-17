import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';

/*
  Inline carousel for a Work card, with click-to-enlarge.

  Every card on the page advances together. Each card is its own Astro
  island - separate React roots - so React Context cannot reach across
  them. They do share this module instance though, so the clock lives
  here at module scope and each island subscribes to it. Touching any
  one carousel moves all of them and restarts the shared countdown, so
  they never drift apart.
*/

const AUTOPLAY_MS = 5000;

// Advancing a shared counter rather than a per-card index lets cards hold
// different numbers of shots and still stay in step - each one renders
// tick % shots.length. WRAP is divisible by every plausible shot count,
// so stepping backwards past zero still lands on the right slide.
const WRAP = 2520;

const clock = {
  tick: 0,
  listeners: new Set(),
  timer: null,
  holds: 0, // hover and open lightboxes each hold the clock still

  subscribe(fn) {
    this.listeners.add(fn);
    this.start();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.stop();
    };
  },

  getSnapshot() {
    return this.tick;
  },

  emit() {
    this.listeners.forEach((fn) => fn());
  },

  start() {
    if (this.timer || this.holds > 0 || this.listeners.size === 0) return;
    if (typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    this.timer = setInterval(() => this.step(1), AUTOPLAY_MS);
  },

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  },

  // A manual move restarts the countdown so the next auto-advance is a
  // full interval away, not whatever was left on the clock.
  step(delta) {
    this.tick = (this.tick + delta + WRAP) % WRAP;
    this.emit();
  },

  moveTo(next) {
    this.tick = next % WRAP;
    this.emit();
  },

  restart() {
    this.stop();
    this.start();
  },

  hold() {
    this.holds += 1;
    this.stop();
  },

  release() {
    this.holds = Math.max(0, this.holds - 1);
    if (this.holds === 0) this.start();
  },
};

// Stroked chevrons rather than ‹ › glyphs - the text characters render thin
// at any size, and this matches the stroke weight of the arrows already used
// in the tech-stack rows.
function Chevron({ dir = 'right', size = 20 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </svg>
  );
}

export default function ProjectGallery({ shots = [], label = 'project' }) {
  const tick = useSyncExternalStore(
    (fn) => clock.subscribe(fn),
    () => clock.getSnapshot(),
    () => 0, // server render always starts on the first slide
  );

  const [zoomed, setZoomed] = useState(false);
  const count = shots.length;
  const index = count ? tick % count : 0;

  const go = useCallback((delta) => {
    clock.step(delta);
    clock.restart();
  }, []);

  // Keyboard control belongs to the lightbox while it is up.
  useEffect(() => {
    if (!zoomed) return;

    clock.hold();
    const onKey = (e) => {
      if (e.key === 'Escape')     setZoomed(false);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft')  go(-1);
    };

    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clock.release();
    };
  }, [zoomed, go]);

  if (!count) return null;

  const arrowClass =
    'absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center ' +
    'bg-slate-950/60 hover:bg-slate-950/90 text-amber-400 hover:text-amber-300 transition-colors';

  return (
    <>
      <div
        className="relative overflow-hidden border border-slate-700 bg-slate-950"
        onMouseEnter={() => clock.hold()}
        onMouseLeave={() => clock.release()}
      >
        {/* One flex row shifted by whole-percentage steps, which is what
            makes the slide animate instead of swapping. */}
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {shots.map((shot) => (
            <button
              key={shot.src}
              onClick={() => setZoomed(true)}
              aria-label={`Enlarge: ${shot.alt}`}
              className="w-full shrink-0 aspect-[16/10] cursor-zoom-in"
            >
              {/* Not lazy: an off-screen slide that loads only as it slides
                  in shows a blank frame mid-transition. These are 15-40KB
                  each, so fetching all of them up front is the cheaper trade. */}
              <img
                src={shot.src}
                alt={shot.alt}
                decoding="async"
                className="w-full h-full object-cover object-top"
              />
            </button>
          ))}
        </div>

        {count > 1 && (
          <>
            <button onClick={() => go(-1)} aria-label="Previous" className={`${arrowClass} left-0`}>
              <Chevron dir="left" size={18} />
            </button>
            <button onClick={() => go(1)} aria-label="Next" className={`${arrowClass} right-0`}>
              <Chevron dir="right" size={18} />
            </button>

            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
              {shots.map((shot, i) => (
                <button
                  key={shot.src}
                  onClick={() => { clock.moveTo(i); clock.restart(); }}
                  aria-label={`Go to ${shot.alt}`}
                  aria-current={i === index}
                  className={`h-1.5 rounded-full transition-all ${
                    i === index ? 'w-5 bg-amber-400' : 'w-1.5 bg-slate-500 hover:bg-slate-300'
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <p className="mt-2 text-slate-500 text-[11px] uppercase tracking-widest text-center">
        {shots[index].alt}
      </p>

      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-4 sm:p-8"
          onClick={() => setZoomed(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`${label} screenshots`}
        >
          <button
            onClick={() => setZoomed(false)}
            aria-label="Close"
            className="absolute top-4 right-4 text-slate-400 hover:text-amber-400 text-xs font-bold uppercase tracking-widest px-4 py-2 border border-slate-700 hover:border-amber-400 transition-colors"
          >
            Close ✕
          </button>

          {/* Swallows the click the backdrop is listening for. */}
          <figure
            className="max-w-5xl w-full flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* w-fit shrink-wraps this to the image's rendered size, so the
                arrows sit on the image edges rather than the monitor edges.
                Anchoring them to the overlay instead pins them to the viewport. */}
            <div className="relative w-fit max-w-full">
              <img
                src={shots[index].src}
                alt={shots[index].alt}
                className="block w-auto max-w-full max-h-[75vh] object-contain border border-slate-700"
              />

              {count > 1 && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); go(-1); }}
                    aria-label="Previous"
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center bg-slate-950/70 hover:bg-slate-950 text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    <Chevron dir="left" size={24} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); go(1); }}
                    aria-label="Next"
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center bg-slate-950/70 hover:bg-slate-950 text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    <Chevron dir="right" size={24} />
                  </button>
                </>
              )}
            </div>

            <figcaption className="mt-3 text-center text-slate-400 text-xs uppercase tracking-widest">
              {shots[index].alt}
              {count > 1 && <span className="text-slate-600"> · {index + 1} / {count}</span>}
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}
