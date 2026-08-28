import type { AudienceType } from "@/lib/post-data";

export function normalizeAudienceSubjectIds(audience: AudienceType, subjectIds: string[]) {
  const uniqueIds = [...new Set(subjectIds.map((id) => id.trim()).filter(Boolean))];
  return audience === "events" ? uniqueIds.slice(0, 1) : uniqueIds;
}

export function toggleAudienceSubjectId(audience: AudienceType, subjectIds: string[], id: string) {
  const normalized = normalizeAudienceSubjectIds(audience, subjectIds);
  if (normalized.includes(id)) return normalized.filter((subjectId) => subjectId !== id);
  return audience === "events" ? [id] : [...normalized, id];
}