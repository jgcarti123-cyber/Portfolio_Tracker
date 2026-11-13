"use client";

import { useMemo, useState } from "react";
import { money } from "@/lib/format";
import { convert, type Position } from "@/lib/portfolio";
import { ACCOUNT_COLORS, CLASS_META, CLASS_ORDER, type Account, type Currency } from "@/lib/types";
import { Card, CardHead, Icon, Segmented } from "./ui";

type Mode = "class" | "account";
interface Slice {
  key: string;
  label: string;
  color: string;
  value: number;
}

export function Allocation({
  positions,
  accounts,
  currency,
  usdInr,
}: {
  positions: Position[];
  accounts: Account[];
  currency: Currency;
  usdInr: number;
}) {
  const [mode, setMode] = useState<Mode>("class");
  const [hover, setHover] = useState<string | null>(null);

  const slices = useMemo<Slice[]>(() => {
    const worth = (p: Position) => convert(p.value ?? p.cost, p.asset.currency, currency, usdInr);
    if (mode === "class") {
      return CLASS_ORDER.map((cls) => ({
        key: cls,
        label: CLASS_META[cls].label,
        color: CLASS_META[cls].color,
        value: positions.filter((p) => p.asset.cls === cls).reduce((s, p) => s + worth(p), 0),
      })).filter((s) => s.value > 0);
    }
    // Colour follows the account's place in the list, not its rank by value.
    return accounts
      .map((acc, i) => ({
        key: acc.id,
        label: acc.name,
        color: ACCOUNT_COLORS[Math.min(i, ACCOUNT_COLORS.length - 1)],
        value: positions.reduce(
          (s, p) => s + (p.qty > 0 ? worth(p) * ((p.byAccount[acc.id] ?? 0) / p.qty) : 0),
          0,
        ),
      }))
      .filter((s) => s.value > 0);
  }, [positions, accounts, currency, usdInr, mode]);

  const total = slices.reduce((s, x) => s + x.value, 0);

  return (
    <Card className="flex flex-col p-5 sm:p-6">
      <CardHead icon={Icon.pie} title="Where it sits" color="var(--cat-4)">
        <Segmented
          options={[
            { value: "class", label: "Asset type" },
            { value: "account", label: "Broker" },
          ]}
          value={mode}
          onChange={setMode}
          label="Group by"
          size="sm"
        />
      </CardHead>

      {total === 0 ? (
        <p className="mt-8 text-sm text-ink-2">Add a holding to see how your money is split.</p>
      ) : (
        <>
          <div className="mt-5 flex h-10 gap-[3px]" key={mode} onMouseLeave={() => setHover(null)}>
            {slices.map((s, i) => (
              <div
                key={s.key}
                onMouseEnter={() => setHover(s.key)}
                className="seg-grow h-full min-w-[6px] rounded-[7px] transition-opacity first:rounded-l-[12px] last:rounded-r-[12px]"
                style={{
                  flexGrow: s.value,
                  flexBasis: 0,
                  background: s.color,
                  opacity: hover && hover !== s.key ? 0.3 : 1,
                  animationDelay: `${i * 70}ms`,
                }}
              />
            ))}
          </div>

          <ul className="mt-3 flex-1 divide-y divide-line">
            {slices.map((s) => (
              <li
                key={s.key}
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
                className={`flex items-center justify-between gap-3 py-2.5 transition-opacity ${
                  hover && hover !== s.key ? "opacity-40" : ""
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                  <span className="truncate text-sm font-semibold">{s.label}</span>
                </span>
                <span className="num flex shrink-0 items-baseline gap-3">
                  <span className="text-[13px] text-ink-2">{money(s.value, currency)}</span>
                  <span className="w-12 text-right text-sm font-bold">
                    {((s.value / total) * 100).toFixed(1)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
