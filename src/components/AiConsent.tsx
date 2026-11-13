"use client";

import { useAi } from "@/lib/ai";
import { Button, Modal } from "./ui";

export function AiConsent() {
  const { asking, answer, status } = useAi();
  if (!asking) return null;
  const who = status?.provider || "the AI provider";
  return (
    <Modal title="Use AI features?" onClose={() => answer(false)}>
      <div className="space-y-4 text-sm leading-relaxed text-ink-2">
        <p>
          Everything else in Folio stays in this browser. The AI features are the one exception: they send some
          details to <strong className="text-ink">{who}</strong>, which runs the open model{" "}
          <strong className="text-ink">{status?.model}</strong>.
        </p>
        <div className="rounded-2xl bg-sunken p-4 ring-1 ring-line">
          <p className="mb-2 font-semibold text-ink">What&apos;s sent</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Reading a file: its column headings and the first eight rows.</li>
            <li>
              Asking the assistant: your question, the recent conversation, and your portfolio — each holding&apos;s name, type, broker, units,
              cost and value, every trade (date, units, price, broker) and today&apos;s moves.
            </li>
            <li>Describing a trade: the sentence you type, the holding&apos;s name and price, and how many units you hold with each broker.</li>
          </ul>
          <p className="mb-2 mt-3 font-semibold text-ink">What&apos;s never sent</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Your name, PAN, phone, email, folio or account numbers — they&apos;re removed first.</li>
            <li>Your passphrase or the rest of your vault.</li>
          </ul>
        </div>
        <p className="text-xs text-ink-3">
          It&apos;s sent only when you use an AI feature. The assistant explains your numbers; it isn&apos;t investment advice. You can turn
          AI off from the assistant panel.
        </p>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="quiet" onClick={() => answer(false)}>
          Not now
        </Button>
        <Button onClick={() => answer(true)}>Allow AI features</Button>
      </div>
    </Modal>
  );
}
