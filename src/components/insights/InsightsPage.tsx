"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useBenchmarks } from "@/lib/benchmarks";
import {
  behaviour,
  concentration,
  dailyMoves,
  drawdown,
  firstHeld,
  marketDrivers,
  moneyFlows,
  riskBreakdown,
  scorecard,
  standing,
  whatIfModel,
  type Basis,
  type InsightInput,
} from "@/lib/insights";
import type { DayValue } from "@/lib/networth";
import type { Position } from "@/lib/portfolio";
import type { Market } from "@/lib/prices";
import type { Candle, Currency, VaultData } from "@/lib/types";
import { Button, Card, CardHead, Segmented } from "../ui";
import { Diversification } from "./Diversification";
import { Downside } from "./Downside";
import { DriversRing } from "./DriversRing";
import { Basis as Small, ChartEmpty, Explain, InsightIcon, missingNote } from "./kit";
import { MoneyMap } from "./MoneyMap";
import { WhatIf } from "./WhatIf";

export function InsightsPage({
  data,
  positions,
  closes,
  market,
  currency,
  series,
  loading,
}: {
  data: VaultData;
  positions: Position[];
  closes: Record<string, Candle[]>;
  market: Market;
  currency: Currency;
  series: DayValue[];
  loading: boolean;
}) {
  const [basis, setBasis] = useState<Basis>("mix");
  const { bench, loading: benchLoading } = useBenchmarks();
  const input: InsightInput = useMemo(
    () => ({ data, positions, closes, usdInr: market.usdInr, fxSeries: market.fxSeries, currency, series, withCash: true, bench }),
    [data, positions, closes, market.usdInr, market.fxSeries, currency, series, bench],
  );
  const risk = useMemo(() => riskBreakdown(input, basis), [input, basis]);
  const moves = useMemo(() => dailyMoves(input, basis), [input, basis]);
  const dd = useMemo(() => drawdown(input, basis), [input, basis]);
  const stand = useMemo(() => standing(input, basis, risk), [input, basis, risk]);
  const drivers = useMemo(() => concentration(input, risk), [input, risk]);
  const model = useMemo(() => whatIfModel(input, basis), [input, basis]);
  const card = useMemo(() => scorecard(input, basis, risk, moves, dd), [input, basis, risk, moves, dd]);
  const factors = useMemo(() => marketDrivers(input, basis), [input, basis]);
  const behave = useMemo(() => behaviour(input, basis), [input, basis]);
  const flows = useMemo(() => moneyFlows(input), [input]);

  const realDays = isFinite(firstHeld(data)) ? series.length : 0;
  const tag = basis === "mix" ? "Current mix · past year" : `Your history · ${realDays}d`;
  const pending = loading && !Object.keys(closes).length;
  const benchPending = benchLoading && !Object.keys(bench).length;
  const notEnough = (reason?: string) => (
    <ChartEmpty
      title="Not enough history yet"
      body={reason}
      action={
        basis === "real" ? (
          <Button variant="ghost" onClick={() => setBasis("mix")}>
            Use your current mix instead
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2">
        <div className="max-w-[560px]">
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">Insights</h1>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-2">How spread out you are, how much you could lose, and what moves your money.</p>
        </div>
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <Segmented
            options={[
              { value: "mix", label: "Current mix · 1Y" },
              { value: "real", label: `My history · ${realDays}d` },
            ]}
            value={basis}
            onChange={setBasis}
            label="Insights use"
            size="sm"
          />
          <p className="max-w-[340px] text-[11.5px] leading-snug text-ink-3 sm:text-right">
            {basis === "mix" ? "Your holdings today, run over the last year of real prices." : "Only the days you actually held things, from your own trades."}
          </p>
        </div>
      </div>

      <InsightCard
        icon={InsightIcon.spark}
        title="Diversification"
        color="var(--cat-3)"
        tag={tag}
        explain={
          <>
            <b>Independent bets</b> counts how many truly separate things your money rides on — holdings that rise and fall together count as one. A <b>swing</b> is the day-to-day up and down of your total value.
          </>
        }
      >
        {pending || benchPending ? (
          <Skeleton h={520} />
        ) : risk.ok ? (
          <>
            <Diversification risk={risk} points={stand} drivers={drivers} currency={currency} />
            {risk.missing.length > 0 && <Small>{missingNote(risk.missing)}</Small>}
          </>
        ) : (
          notEnough(risk.reason)
        )}
      </InsightCard>

      <InsightCard
        icon={InsightIcon.bridge}
        title="Try a different mix"
        color="var(--cat-6)"
        tag={tag}
        explain="Move the sliders — change what you hold or test adding an index fund or gold — and see how your spread and swings would have looked over the same days."
      >
        {pending || benchPending ? (
          <Skeleton h={320} />
        ) : model ? (
          <WhatIf key={model.items.map((i) => i.key).join("|")} model={model} currency={currency} />
        ) : (
          notEnough("Needs at least 20 market days of prices.")
        )}
      </InsightCard>

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <InsightCard icon={InsightIcon.dip} title="Your downside" color="var(--cat-5)" tag={tag} explain="How much you could lose, in money, on what you hold today.">
          {pending ? <Skeleton h={320} /> : risk.ok ? <Downside card={card} currency={currency} /> : notEnough(risk.reason)}
        </InsightCard>
        <InsightCard
          icon={InsightIcon.clock}
          title="What drives you"
          color="var(--cat-4)"
          tag={tag}
          explain="Each ring is a market: the longer it is, the more your ups and downs follow it. Each row shows what a 1% fall has meant for you, and how you held up on that market's worst days."
        >
          {pending || benchPending ? <Skeleton h={320} /> : factors.ok ? <DriversRing factors={factors.factors} markets={behave.markets} currency={currency} /> : notEnough(factors.reason)}
        </InsightCard>
      </div>

      <InsightCard icon={InsightIcon.flow} title="Money map" color="var(--cat-6)" explain="Follow the bands left to right: broker → asset type → each holding. Green is what the market added; red is what it took away.">
        {flows.nodes.length ? <MoneyMap flows={flows} currency={currency} /> : <ChartEmpty title="Nothing to map yet" body="Add a holding and its money shows up here." />}
      </InsightCard>

      <p className="px-1 text-xs leading-relaxed text-ink-3">
        Worked out in your browser from your trades, real daily closes, real index prices (Nifty 50, S&amp;P 500, Nippon Gold ETF, Bitcoin) and the real dollar–rupee rate. Past behaviour doesn&apos;t predict
        the future. This is a tracker, not investment advice.
      </p>
    </main>
  );
}

export function InsightCard({
  icon,
  title,
  color,
  tag,
  explain,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  color: string;
  tag?: string;
  explain?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col p-5 sm:p-6">
      <CardHead icon={icon} title={title} color={color}>
        {action ?? (tag && <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-ink-3 ring-1 ring-line">{tag}</span>)}
      </CardHead>
      {explain && <Explain>{explain}</Explain>}
      <div className="mt-4 flex-1">{children}</div>
    </Card>
  );
}

function Skeleton({ h }: { h: number }) {
  return <div className="skeleton" style={{ height: h }} />;
}
