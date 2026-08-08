export type ProgressRow = {
  gameweek_id: string;
  gameweek_name: string;
  round_order: number | null;
  first_match_starts_at: string;
  last_match_ends_at: string;
  points: number | string;
  average_points: number | string;
  max_points: number | string;
};

const CHART_WIDTH = 800;
const CHART_HEIGHT = 300;
const CHART_MARGIN = { top: 18, right: 18, bottom: 42, left: 48 };

function formatPoints(value: number | string, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits }).format(
    Number(value),
  );
}

function getGameweekLabel(row: ProgressRow) {
  if (row.round_order !== null) {
    return `Gameweek ${row.round_order}`;
  }

  return row.gameweek_name.replace(/^round\s*/i, "Gameweek ");
}

function getShortGameweekLabel(row: ProgressRow, index: number) {
  return `GW${row.round_order ?? index + 1}`;
}

function getNiceStep(range: number) {
  const roughStep = Math.max(range / 4, 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / magnitude;

  if (normalizedStep <= 1) return magnitude;
  if (normalizedStep <= 2) return 2 * magnitude;
  if (normalizedStep <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function getLinePath(
  rows: ProgressRow[],
  getValue: (row: ProgressRow) => number,
  getX: (index: number) => number,
  getY: (value: number) => number,
) {
  return rows
    .map((row, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command} ${getX(index)} ${getY(getValue(row))}`;
    })
    .join(" ");
}

function ProgressChart({ rows }: { rows: ProgressRow[] }) {
  if (!rows.length) {
    return (
      <div className="mt-5 rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-4 py-10 text-center text-sm text-[var(--pf-text-muted)]">
        Your chart will appear after the first scored gameweek.
      </div>
    );
  }

  const values = rows.flatMap((row) => [
    Number(row.points),
    Number(row.average_points),
    Number(row.max_points),
  ]);
  const rawMinimum = Math.min(0, ...values);
  const rawMaximum = Math.max(0, ...values);
  const step = getNiceStep(rawMaximum - rawMinimum || 1);
  const yMinimum = Math.floor(rawMinimum / step) * step;
  const yMaximum = Math.max(Math.ceil(rawMaximum / step) * step, yMinimum + step);
  const yTicks = Array.from(
    { length: Math.round((yMaximum - yMinimum) / step) + 1 },
    (_, index) => yMinimum + index * step,
  );
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const getX = (index: number) =>
    rows.length === 1
      ? CHART_MARGIN.left + plotWidth / 2
      : CHART_MARGIN.left + (index / (rows.length - 1)) * plotWidth;
  const getY = (value: number) =>
    CHART_MARGIN.top +
    ((yMaximum - value) / (yMaximum - yMinimum)) * plotHeight;
  const labelInterval = Math.max(1, Math.ceil(rows.length / 8));

  const series = [
    {
      label: "Your points",
      color: "var(--pf-fantasy-yellow)",
      dashArray: undefined,
      getValue: (row: ProgressRow) => Number(row.points),
    },
    {
      label: "All-team average",
      color: "var(--pf-brand-blue-hover)",
      dashArray: undefined,
      getValue: (row: ProgressRow) => Number(row.average_points),
    },
    {
      label: "Overall max",
      color: "var(--pf-text)",
      dashArray: "8 6",
      getValue: (row: ProgressRow) => Number(row.max_points),
    },
  ];

  return (
    <figure className="mt-5">
      <figcaption className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-black text-[var(--pf-text)]">
          Points by gameweek
        </h2>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-[var(--pf-text-muted)]">
          {series.map((item) => (
            <span className="inline-flex items-center gap-2" key={item.label}>
              <span
                aria-hidden="true"
                className="h-0.5 w-5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </span>
          ))}
        </div>
      </figcaption>

      <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-2 sm:p-4">
        <svg
          aria-label="Your gameweek points compared with the all-team average and overall maximum"
          className="h-auto min-w-[34rem] w-full"
          role="img"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                stroke="var(--pf-card-border)"
                strokeWidth="1"
                x1={CHART_MARGIN.left}
                x2={CHART_WIDTH - CHART_MARGIN.right}
                y1={getY(tick)}
                y2={getY(tick)}
              />
              <text
                fill="var(--pf-text-muted)"
                fontSize="11"
                textAnchor="end"
                x={CHART_MARGIN.left - 9}
                y={getY(tick) + 4}
              >
                {formatPoints(tick)}
              </text>
            </g>
          ))}

          {rows.map((row, index) =>
            index % labelInterval === 0 || index === rows.length - 1 ? (
              <text
                fill="var(--pf-text-muted)"
                fontSize="11"
                key={row.gameweek_id}
                textAnchor="middle"
                x={getX(index)}
                y={CHART_HEIGHT - 13}
              >
                {getShortGameweekLabel(row, index)}
              </text>
            ) : null,
          )}

          {series.map((item) => (
            <g key={item.label}>
              <path
                d={getLinePath(rows, item.getValue, getX, getY)}
                fill="none"
                stroke={item.color}
                strokeDasharray={item.dashArray}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
              />
              {rows.map((row, index) => (
                <circle
                  cx={getX(index)}
                  cy={getY(item.getValue(row))}
                  fill="var(--pf-navy-elevated)"
                  key={row.gameweek_id}
                  r="4"
                  stroke={item.color}
                  strokeWidth="2.5"
                />
              ))}
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}

export function ProgressTable({ rows }: { rows: ProgressRow[] }) {
  return (
    <>
      <ProgressChart rows={rows} />

      <section aria-labelledby="played-gameweeks-title" className="mt-6">
        <h2
          className="text-base font-black text-[var(--pf-text)]"
          id="played-gameweeks-title"
        >
          Played gameweeks
        </h2>

        <div className="mt-3 overflow-hidden rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)]">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(3.5rem,0.55fr))] gap-2 border-b border-[var(--pf-card-border)] bg-[var(--pf-navy-deep)] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-[var(--pf-text-muted)] sm:grid-cols-[minmax(0,1fr)_repeat(3,7rem)] sm:px-4">
            <span className="text-left">Gameweek</span>
            <span>Your points</span>
            <span>Average</span>
            <span>Max</span>
          </div>

          {rows.length ? (
            <div className="divide-y divide-[var(--pf-card-border)]">
              {rows.map((row) => (
                <article
                  className="grid min-h-12 grid-cols-[minmax(0,1fr)_repeat(3,minmax(3.5rem,0.55fr))] items-center gap-2 px-3 py-2 text-right text-sm transition hover:bg-[var(--pf-brand-blue-soft)] sm:grid-cols-[minmax(0,1fr)_repeat(3,7rem)] sm:px-4"
                  key={row.gameweek_id}
                >
                  <h3 className="truncate text-left font-bold text-[var(--pf-text)]">
                    {getGameweekLabel(row)}
                  </h3>
                  <p className="font-black text-[var(--pf-fantasy-yellow)]">
                    {formatPoints(row.points)}
                  </p>
                  <p className="font-semibold text-[var(--pf-text)]">
                    {formatPoints(row.average_points, 1)}
                  </p>
                  <p className="font-semibold text-[var(--pf-text)]">
                    {formatPoints(row.max_points)}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="px-4 py-6 text-sm text-[var(--pf-text-muted)]">
              No played gameweeks yet.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
