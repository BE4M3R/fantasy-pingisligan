"use client";

import { useEffect } from "react";

type ScrollLockStyles = {
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
  rootOverflow: string;
  rootOverscrollBehavior: string;
};

let activeLocks = 0;
let originalStyles: ScrollLockStyles | null = null;

function lockBodyScroll() {
  if (activeLocks === 0) {
    const body = document.body;
    const root = document.documentElement;

    originalStyles = {
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      rootOverflow: root.style.overflow,
      rootOverscrollBehavior: root.style.overscrollBehavior,
    };

    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
  }

  activeLocks += 1;

  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeLocks = Math.max(0, activeLocks - 1);

    if (activeLocks !== 0 || !originalStyles) return;

    const body = document.body;
    const root = document.documentElement;

    body.style.overflow = originalStyles.bodyOverflow;
    body.style.overscrollBehavior = originalStyles.bodyOverscrollBehavior;
    root.style.overflow = originalStyles.rootOverflow;
    root.style.overscrollBehavior = originalStyles.rootOverscrollBehavior;
    originalStyles = null;
  };
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    return lockBodyScroll();
  }, [locked]);
}
