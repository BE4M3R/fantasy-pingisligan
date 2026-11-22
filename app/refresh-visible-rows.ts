export async function refreshVisibleRows<Row, Page extends { rows: Row[] }>(
  count: number,
  load: (offset: number) => Promise<Page>,
  total: (page: Page) => number,
) {
  const first = await load(0);
  const rows = [...first.rows];
  while (rows.length && rows.length < Math.min(count, total(first))) {
    const next = await load(rows.length);
    if (!next.rows.length) break;
    rows.push(...next.rows);
  }
  return { ...first, rows };
}
