import type { ReactNode } from "react";

const scoring = [
  ["Individual match win", "+4"],
  ["Each set won", "+1"],
  ["Doubles match win, per player", "+2"],
  ["Your club wins the fixture (all club players)", "+3"],
  ["Win all singles (minimum two)", "+2"],
] as const;

const chips = [
  ["Wildcard", "Unlimited free transfers for one gameweek."],
  ["Triple Captain", "Your captain scores 3x instead of 2x."],
  ["Bench Boost", "Both bench players' points count."],
] as const;

function RuleCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="table-panel rounded-xl border p-5 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--pf-brand-blue)]">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-xl font-black tracking-tight text-[var(--pf-text)]">
        {title}
      </h2>
      <div className="mt-4 text-sm leading-6 text-[var(--pf-text-muted)]">
        {children}
      </div>
    </section>
  );
}

export function RulesContent() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 sm:py-14">
      <div className="max-w-3xl">
        <p className="text-sm font-bold uppercase tracking-widest text-[var(--pf-brand-blue)]">
          Quick guide
        </p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-[var(--pf-text)] sm:text-5xl">
          Game rules
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--pf-text-muted)]">
          Build your squad, pick your starters, and earn points from real
          Pingisligan performances. Here is the short version.
        </p>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <RuleCard eyebrow="01" title="Build your squad">
          <ul className="space-y-2">
            <li><strong className="text-[var(--pf-fantasy-yellow)]">SEK 100m</strong> budget</li>
            <li><strong className="text-[var(--pf-fantasy-yellow)]">6 players:</strong> 4 starters and 2 bench players</li>
            <li>Maximum <strong className="text-[var(--pf-fantasy-yellow)]">2 players per club</strong></li>
            <li>No positions or formation requirements</li>
          </ul>
        </RuleCard>

        <RuleCard eyebrow="02" title="Choose your lineup">
          <ul className="space-y-2">
            <li>Only starters normally count toward your score.</li>
            <li>Bench players replace absent starters in priority order.</li>
            <li>Your captain scores <strong className="text-[var(--pf-fantasy-yellow)]">2x points</strong>.</li>
            <li>An empty squad slot always scores zero.</li>
          </ul>
        </RuleCard>

        <section className="table-panel overflow-hidden rounded-xl border md:col-span-2">
          <div className="border-b border-[var(--pf-card-border)] p-5 sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--pf-brand-blue)]">
              03
            </p>
            <h2 className="mt-2 text-xl font-black tracking-tight text-[var(--pf-text)]">Score points</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--pf-text-muted)]">
              Points from every completed match are added together for the gameweek.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--pf-navy-deep)] text-xs uppercase tracking-wide text-[var(--pf-text-muted)]">
                <tr>
                  <th className="px-5 py-3 font-semibold sm:px-6">Event</th>
                  <th className="px-5 py-3 text-right font-semibold sm:px-6">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--pf-card-border)]">
                {scoring.map(([event, points]) => (
                  <tr
                    className="transition hover:bg-[var(--pf-brand-blue-soft)]"
                    key={event}
                  >
                    <td className="px-5 py-3 text-[var(--pf-text-muted)] sm:px-6">{event}</td>
                    <td className="px-5 py-3 text-right font-black text-[var(--pf-fantasy-yellow)] sm:px-6">
                      {points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <RuleCard eyebrow="04" title="Make transfers">
          <ul className="space-y-2">
            <li><strong className="text-[var(--pf-fantasy-yellow)]">1 free transfer</strong> each gameweek</li>
            <li>Extra transfers cost <strong className="text-[var(--pf-fantasy-yellow)]">-4 points</strong> each</li>
            <li>Unused free transfers roll over, up to <strong className="text-[var(--pf-fantasy-yellow)]">4 total</strong>.</li>
            <li>Changes fully reversed before the deadline do not count.</li>
          </ul>
        </RuleCard>

        <RuleCard eyebrow="05" title="Play your chips">
          <ul className="space-y-3">
            {chips.map(([name, description]) => (
              <li key={name}>
                <strong className="text-[var(--pf-fantasy-yellow)]">{name}:</strong> {description}
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-[var(--pf-card-border)] pt-4">
            Each chip can be used once per season, and only one can be active
            in a gameweek.
          </p>
        </RuleCard>

        <RuleCard eyebrow="06" title="Know the deadline">
          <ul className="space-y-2">
            <li>The gameweek locks <strong className="text-[var(--pf-fantasy-yellow)]">2 hours before</strong> its earliest fixture.</li>
            <li>Schedule changes can move the deadline before it locks.</li>
            <li>Once locked, the gameweek is not reopened.</li>
            <li>Postponed fixtures still score in their original gameweek.</li>
          </ul>
        </RuleCard>

      </div>
    </div>
  );
}
