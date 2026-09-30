export type PopupOrigin = { x: number; y: number };

export function animatePopupOpen(
  popup: HTMLElement | null,
  trigger: HTMLElement | null,
  point?: PopupOrigin | null,
) {
  if (!popup || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const popupRect = popup.getBoundingClientRect();
  const triggerRect = trigger?.getBoundingClientRect();
  const origin = point ?? (triggerRect
    ? { x: triggerRect.left + triggerRect.width / 2, y: triggerRect.top + triggerRect.height / 2 }
    : { x: popupRect.left + popupRect.width / 2, y: popupRect.top + popupRect.height / 2 });

  popup.style.transformOrigin = `${origin.x - popupRect.left}px ${origin.y - popupRect.top}px`;
  popup.animate(
    [{ opacity: 0.4, transform: "scale(0.82)" }, { opacity: 1, transform: "scale(1)" }],
    { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
  );
}
