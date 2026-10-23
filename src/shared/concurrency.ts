// Runs `task` over `items` with at most `limit` in flight. Unlike a bare
// Promise.all this keeps a large Vault tree from opening hundreds of
// requests at once, and unlike a sequential loop it doesn't pay one
// network round-trip per item.
export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  task: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );

  return results;
}
