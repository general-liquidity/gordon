export function getRuntimeApprovalShortId(id: string): string {
  const normalized = id.replace(/^approval[-_:]*/i, "");
  const source = normalized.length > 0 ? normalized : id;
  return source.slice(0, 8);
}
