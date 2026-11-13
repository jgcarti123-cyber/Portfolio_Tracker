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
import { MarketFalls, VsMarket } from "./Behaviour";
import { DriversRing } from "./DriversRing";
import { Basis as Small, ChartEmpty, Explain, InsightIcon, missingNote } from "./kit";
import { MoneyMap } from "./MoneyMap";
import { Correlations, MoneyRisk, SWING_EXPLAINER } from "./MoneyRisk";
import { Scorecard } from "./Scorecard";
import { Standing } from "./Standing";
import { Concentration, WhatIf } from "./WhatIf";

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
  const toMix = (
    <Button variant="ghost" onClick={() => setBasis("mix")}>
      Use your current mix instead
    </Button>
  );
  const pending = loading && !Object.keys(closes).length;
  const benchPending = benchLoading && !Object.keys(bench).length;
  const notEnough = (reason?: string) => <ChartEmpty title="Not enough history yet" body={reason} action={basis === "real" ? toMix : undefined} />;

  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2">
        <div className="max-w-[560px]">
          <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">Insights</h1>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-2">How spread out you are, how much you could lose, and how your money behaves when markets move.</p>
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

      <Section title="Diversification" sub="How spread out your money really is — and what's concentrating it." />
      <Pair>
        <InsightCard icon={InsightIcon.spark} title="Where you stand" color="var(--cat-3)" tag={tag} explain={<><b>Independent bets</b> counts how many truly separate things your money rides on. <b>Yearly swing</b> is how far your value typically moves in a year. The other dots are real index portfolios over the same days.</>}>
          {pending || benchPending ? <Skeleton h={360} /> : risk.ok && stand.length ? <Standing points={stand} holdings={risk.holdings} /> : notEnough(risk.reason)}
        </InsightCard>
        <InsightCard icon={InsightIcon.target} title="What's concentrating you" color="var(--cat-2)" tag={tag} explain="Plain facts about what limits your spread, worked out from your holdings. Folio doesn't recommend trades.">
          {pending ? <Skeleton h={360} /> : risk.ok ? <Concentration drivers={drivers} risk={risk} /> : notEnough(risk.reason)}
        </InsightCard>
      </Pair>
      <Pair>
        <InsightCard icon={InsightIcon.risk} title="Money vs risk" color="var(--cat-4)" tag={tag} explain={SWING_EXPLAINER}>
          {pending ? (
            <Skeleton h={380} />
          ) : risk.ok ? (
            <>
              <MoneyRisk risk={risk} currency={currency} />
              {risk.missing.length > 0 && <Small>{missingNote(risk.missing)}</Small>}
            </>
          ) : (
            notEnough(risk.reason)
          )}
        </InsightCard>
        <InsightCard icon={InsightIcon.flow} title="What moves together" color="var(--cat-1)" tag={tag} explain="Shows which of your holdings rise and fall together. Owning things that move together doesn't spread your risk.">
          {pending ? (
            <Skeleton h={380} />
          ) : risk.ok && risk.corr.labels.length >= 2 ? (
            <Correlations risk={risk} />
          ) : (
            <ChartEmpty title={risk.ok ? "Needs two holdings with prices" : "Not enough history yet"} body={risk.ok ? "Add another holding with a live price to compare." : risk.reason} />
          )}
        </InsightCard>
      </Pair>
      <InsightCard icon={InsightIcon.bridge} title="Try a different mix" color="var(--cat-6)" tag={tag} explain="Move the sliders — change what you hold or test adding an index fund or gold — and see how spread and swings would have looked over the same days.">
        {pending || benchPending ? <Skeleton h={300} /> : model ? <WhatIf key={model.items.map((i) => i.key).join("|")} model={model} currency={currency} /> : notEnough("Needs at least 20 market days of prices.")}
      </InsightCard>

      <Section title="Risk management" sub="How much you could lose, and where that risk comes from." />
      <InsightCard icon={InsightIcon.dip} title="Your risk at a glance" color="var(--cat-5)" tag={tag} explain="Six numbers that sum up your downside. Amounts are on what you hold today.">
        {pending ? <Skeleton h={300} /> : risk.ok ? <Scorecard card={card} currency={currency} /> : notEnough(risk.reason)}
      </InsightCard>

      <Section title="Portfolio behaviour" sub="How your money moves when markets move." />
      <Pair>
        <InsightCard icon={InsightIcon.clock} title="What drives you" color="var(--cat-4)" tag={tag} explain="Each ring is a market. The longer the ring, the more your daily ups and downs follow it. The amount is what a 1% move in it has typically meant for you.">
          {pending || benchPending ? <Skeleton h={300} /> : factors.ok ? <DriversRing factors={factors.factors} currency={currency} /> : notEnough(factors.reason)}
        </InsightCard>
        <InsightCard icon={InsightIcon.bell} title="You vs the market" color="var(--cat-1)" tag={tag} explain="Each dot is one day: across is the market's move, up is yours. A line steeper than the dashed one means you move more than the market.">
          {pending || benchPending ? <Skeleton h={300} /> : behave.ok ? <VsMarket data={behave} /> : notEnough(behave.reason)}
        </InsightCard>
      </Pair>
      <InsightCard icon={InsightIcon.dip} title="When markets fall" color="var(--cat-2)" tag={tag} explain="How you did on each market's 10 worst days of the window, next to the market itself. A shorter bar than the market's means you held up better.">
        {pending || benchPending ? <Skeleton h={260} /> : behave.ok ? <MarketFalls data={behave} moves={moves} /> : notEnough(behave.reason)}
      </InsightCard>

      <Section title="Where your money is" sub="Where it came from, what it's in, and what it's worth now." />
      <InsightCard icon={InsightIcon.flow} title="Money map" color="var(--cat-6)" explain="Follow the bands from left to right: broker → asset type → each holding. Green bands are what the market added; red is what it took away.">
        {flows.nodes.length ? <MoneyMap flows={flows} currency={currency} /> : <ChartEmpty title="Nothing to map yet" body="Add a holding and its money shows up here." />}
      </InsightCard>

      <p className="px-1 text-xs leading-relaxed text-ink-3">
        Worked out in your browser from your trades, real daily closes, real index prices (Nifty 50, S&amp;P 500, Nippon Gold ETF, Bitcoin) and the real dollar–rupee rate. Past behaviour doesn&apos;t predict
        the future. This is a tracker, not investment advice.
      </p>
    </main>
  );
}

function Section({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="px-1 pt-6">
      <h2 className="text-[19px] font-bold tracking-[-0.01em]">{title}</h2>
      <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>
    </div>
  );
}

function Pair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">{children}</div>;
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
