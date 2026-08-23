"use client";

import { useEffect } from "react";

type BodyStyles = {
  overflow: string;
  position: string;
  top: string;
  width: string;
};

let activeLocks = 0;
let originalStyles: BodyStyles | null = null;
let originalScrollPosition = 0;

function lockBodyScroll() {
  if (activeLocks === 0) {
    const body = document.body;

    originalScrollPosition = window.scrollY;
    originalStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${originalScrollPosition}px`;
    body.style.width = "100%";
  }

  activeLocks += 1;

  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeLocks = Math.max(0, activeLocks - 1);

    if (activeLocks !== 0 || !originalStyles) return;

    const body = document.body;
    const scrollPosition = originalScrollPosition;

    body.style.overflow = originalStyles.overflow;
    body.style.position = originalStyles.position;
    body.style.top = originalStyles.top;
    body.style.width = originalStyles.width;
    originalStyles = null;
    window.scrollTo(0, scrollPosition);
  };
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    return lockBodyScroll();
  }, [locked]);
}
