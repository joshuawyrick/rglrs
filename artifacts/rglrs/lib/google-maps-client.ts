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
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("Map view is not configured yet.");
  window.__rglrsGoogleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-rglrs-google-maps="true"]');
    if (existing) {
      existing.addEventListener("load", () => window.google?.maps ? resolve(window.google.maps) : reject(new Error("Google Maps failed to initialize.")), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Maps failed to load.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.dataset.rglrsGoogleMaps = "true";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.onload = () => window.google?.maps ? resolve(window.google.maps) : reject(new Error("Google Maps failed to initialize."));
    script.onerror = () => reject(new Error("Google Maps failed to load."));
    document.head.appendChild(script);
  });
  return window.__rglrsGoogleMapsPromise;
}

export {};
