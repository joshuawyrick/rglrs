"use client";

import { useRef } from "react";
import { Download, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function QrDownloads({ value, fileName, printable = false }: { value: string; fileName: string; printable?: boolean }) {
  const qrRef = useRef<HTMLDivElement>(null);

  function serializedSvg() {
    const source = qrRef.current?.querySelector("svg");
    if (!source) return null;
    const svg = source.cloneNode(true) as SVGElement;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // Keep exported files self-contained; the on-screen mark uses a relative
    // asset that a downloaded SVG/blob cannot resolve reliably.
    svg.querySelectorAll("image").forEach((image) => image.remove());
    return new XMLSerializer().serializeToString(svg);
  }

  function saveSvg() {
    const svg = serializedSvg();
    if (svg) download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${fileName}.svg`);
  }

  function savePng() {
    const svg = serializedSvg();
    if (!svg) return;
    const imageUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2048;
      canvas.height = 2048;
      const context = canvas.getContext("2d");
      if (!context) return URL.revokeObjectURL(imageUrl);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(imageUrl);
        if (blob) download(blob, `${fileName}-2048.png`);
      }, "image/png");
    };
    image.onerror = () => URL.revokeObjectURL(imageUrl);
    image.src = imageUrl;
  }

  return <div className="stack gap8">
    <div ref={qrRef} className="qr-card">
      <QRCodeSVG value={value} size={320} bgColor="#ffffff" fgColor="#0b0f13" level="H" marginSize={2} imageSettings={{ src: "/icon.svg", height: 58, width: 58, excavate: true }} />
    </div>
    <div className="row gap8 qr-download-actions">
      <button className="text-btn" type="button" onClick={saveSvg}><Download size={14} /> SVG</button>
      <button className="text-btn" type="button" onClick={savePng}><Download size={14} /> PNG (2048px)</button>
      {printable ? <button className="text-btn" type="button" onClick={() => window.print()}><Printer size={14} /> Print card</button> : null}
    </div>
  </div>;
}