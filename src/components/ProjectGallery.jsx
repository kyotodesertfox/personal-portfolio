import { useState, useEffect, useCallback } from 'react';

/*
  Thumbnail strip that opens a full-size carousel.

  Astro renders the page statically, so this ships as a React island
  (client:load). Each Work card passes its own shots; nothing here knows
  about a specific project.
*/

export default function ProjectGallery({ shots = [], label = 'project' }) {
  const [openAt, setOpenAt] = useState(null);
  const isOpen = openAt !== null;
  const count  = shots.length;

  const close = useCallback(() => setOpenAt(null), []);
  const step  = useCallback(
    (delta) => setOpenAt((i) => (i === null ? null : (i + delta + count) % count)),
    [count],
  );

  // Arrow keys and Escape only make sense while the lightbox is up, so the
  // listener is bound to that state rather than mounted for the whole page.
  useEffect(() => {
    if (!isOpen) return;

    const onKey = (e) => {
      if (e.key === 'Escape')     close();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft')  step(-1);
    };

    document.addEventListener('keydown', onKey);
    // Stop the page behind the overlay from scrolling with it.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, close, step]);

  if (!count) return null;

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-3">
        {shots.map((shot, i) => (
          <button
            key={shot.src}
            onClick={() => setOpenAt(i)}
            aria-label={`View ${shot.alt}`}
            className="group relative w-32 sm:w-40 aspect-[16/10] overflow-hidden border border-slate-700 hover:border-amber-400 transition-colors"
          >
            <img
              src={shot.src}
              alt={shot.alt}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover object-top opacity-80 group-hover:opacity-100 transition-opacity"
            />
          </button>
        ))}
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-4 sm:p-8"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={`${label} screenshots`}
        >
          <button
            onClick={close}
            aria-label="Close"
            className="absolute top-4 right-4 text-slate-400 hover:text-amber-400 text-xs font-bold uppercase tracking-widest px-4 py-2 border border-slate-700 hover:border-amber-400 transition-colors"
          >
            Close ✕
          </button>

          {/* The image is the one thing inside the overlay that must not
              close it, so it swallows the click that the backdrop listens for. */}
          <figure className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={shots[openAt].src}
              alt={shots[openAt].alt}
              className="w-full h-auto max-h-[75vh] object-contain border border-slate-700"
            />
            <figcaption className="mt-3 text-center text-slate-400 text-xs uppercase tracking-widest">
              {shots[openAt].alt}
              {count > 1 && <span className="text-slate-600"> · {openAt + 1} / {count}</span>}
            </figcaption>
          </figure>

          {count > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); step(-1); }}
                aria-label="Previous"
                className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 text-slate-300 hover:text-amber-400 text-3xl px-3 py-6 transition-colors"
              >
                ‹
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); step(1); }}
                aria-label="Next"
                className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 text-slate-300 hover:text-amber-400 text-3xl px-3 py-6 transition-colors"
              >
                ›
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
