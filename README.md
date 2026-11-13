# Folio

One net-worth tracker for Indian stocks, US stocks, mutual funds and crypto held across different brokers
and exchanges (Groww, INDmoney, CoinDCX and others).

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add an AI key to turn on AI features
npm run dev
```

## What it does

- Add holdings by hand, import broker statements (Excel/CSV), or describe a trade in a sentence.
- Net-worth history from real trades and daily closes, by asset type, with market gain/loss.
- Exactly what moved today, per holding and per market, including the dollar–rupee effect.
- Filters across the whole dashboard; per-holding charts with "your value on any day" and a what-if slider.
- **Ask Folio**: an assistant that answers questions about your portfolio, records trades you describe
  (after you confirm) and works out what-ifs. It explains; it doesn't give investment advice.

## Privacy

- **Your data stays in the browser.** Accounts, holdings, trades and assistant chats are one JSON document,
  encrypted with your passphrase (PBKDF2-SHA256, 600k rounds, then AES-256-GCM) and stored in IndexedDB.
  See `src/lib/vault.ts`. There is no account and no server-side storage.
- **Prices and logos** are fetched by the server from Yahoo Finance (unofficial), CoinGecko, mfapi.in,
  Frankfurter (USD/INR) and Financial Modeling Prep (logos). Only instrument symbols are sent.
- **AI features are opt-in.** When used, they send the minimum needed to the configured OpenAI-compatible
  provider (Groq by default): a file's headings and a few redacted rows, a trade sentence, or for the
  assistant your holdings, trades and recent messages. Personal identifiers are never sent. The key lives
  only in server env vars.

## Development

- `npx tsx scripts/eval-import.ts <fixtures-dir>` measures statement-reading accuracy.
- `npx tsx scripts/eval-trade.ts` checks how trade sentences are understood (45 phrasings).
- The vault is per browser and per origin. To start over, clear site data for the dev origin.
