"use client";

export type ReadyMessageUpload = { uploadId: string; mediaType: "image" | "video" };

function put(url: string, headers: Record<string, string>, file: File) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.onerror = () => reject(new Error("The media upload was interrupted."));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("The media upload failed."));
    xhr.send(file);
  });
}

export async function uploadMessageFile(file: File): Promise<ReadyMessageUpload> {
  const supported = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];
  if (!supported.includes(file.type)) throw new Error("Choose a JPEG, PNG, WebP, MP4, or QuickTime file.");
  const max = file.type.startsWith("image/") ? 15 * 1024 * 1024 : 100 * 1024 * 1024;
  if (!file.size || file.size > max) throw new Error(file.type.startsWith("image/") ? "Photos must be 15 MB or smaller." : "Videos must be 100 MB or smaller.");
  const prepared = await fetch("/private-media/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type, fileName: file.name, size: file.size }),
  });
  const payload = await prepared.json().catch(() => null) as { uploadId?: string; uploadUrl?: string; fallbackUploadUrl?: string; headers?: Record<string, string>; error?: string } | null;
  if (!prepared.ok || !payload?.uploadId || !payload.uploadUrl || !payload.fallbackUploadUrl || !payload.headers) throw new Error(payload?.error || "Could not prepare the upload.");
  try {
    try {
      await put(payload.uploadUrl, payload.headers, file);
    } catch {
      await put(payload.fallbackUploadUrl, { "Content-Type": file.type }, file);
    }
    const response = await fetch(`/private-media/uploads/${payload.uploadId}/complete`, { method: "POST" });
    const complete = await response.json().catch(() => null) as { uploadId?: string; mediaType?: "image" | "video"; error?: string } | null;
    if (!response.ok || !complete?.uploadId || !complete.mediaType) throw new Error(complete?.error || "Media validation failed.");
    return { uploadId: complete.uploadId, mediaType: complete.mediaType };
  } catch (error) {
    await fetch(`/private-media/uploads/${payload.uploadId}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}