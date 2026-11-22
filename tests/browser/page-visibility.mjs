export async function returnAfter(page, elapsed) {
  await page.evaluate((milliseconds) => {
    const currentTime = Date.now;
    const returnedAt = currentTime();
    try {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      Date.now = () => returnedAt - milliseconds;
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      Date.now = () => returnedAt;
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      window.dispatchEvent(new Event("focus"));
    } finally {
      Reflect.deleteProperty(document, "hidden");
      Date.now = currentTime;
    }
  }, elapsed);
}
