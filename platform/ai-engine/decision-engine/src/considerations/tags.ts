/** Shared helper: extracts the opt-in `action.params.tags: string[]` convention every tag-aware consideration reads. */
export function actionTags(params: Record<string, unknown> | undefined): string[] {
  const tags = params?.tags;
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
}
