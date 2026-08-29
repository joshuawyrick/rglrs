declare global {
  interface Window {
    google?: any;
    __rglrsGoogleMapsPromise?: Promise<any>;
  }
}

export async function loadGoogleMaps() {
  if (typeof window === "undefined") throw new Error("Google Maps requires a browser.");
  if (window.google?.maps) return window.google.maps;
  if (window.__rglrsGoogleMapsPromise) return window.__rglrsGoogleMapsPromise;
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new Error("Map view is not configured yet.");
  const promise = new Promise<any>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>('script[data-rglrs-google-maps="true"]');
    const cleanupFailedScript = () => {
      if (script?.parentNode) script.parentNode.removeChild(script);
    };
    const handleLoad = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else {
        cleanupFailedScript();
        reject(new Error("Google Maps failed to initialize."));
      }
    };
    const handleError = () => {
      cleanupFailedScript();
      reject(new Error("Google Maps failed to load."));
    };
    if (script) {
      if (window.google?.maps) return resolve(window.google.maps);
      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });
      return;
    }
    script = document.createElement("script");
    script.dataset.rglrsGoogleMaps = "true";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    document.head.appendChild(script);
  });
  window.__rglrsGoogleMapsPromise = promise;
  void promise.catch(() => {
    if (window.__rglrsGoogleMapsPromise === promise) window.__rglrsGoogleMapsPromise = undefined;
  });
  return promise;
}

export {};
