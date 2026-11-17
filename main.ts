// Washout Recovery — bot dip-buy untuk cbBTC (bars-replay/v1).
//
// Ide: Bitcoin jatuh tajam itu biasanya flush (kapitulasi sesaat), bukan
// tren baru — setelah flush, harga cenderung memantul kembali ke kisaran
// sebelum jatuh. Bot ini menunggu satu penurunan tajam, beli SEKALI dengan
// seluruh kas, lalu jual saat harga sudah pulih cukup jauh dari harga beli,
// atau saat pantulan gagal (trailing stop), atau saat sudah terlalu lama
// menahan tanpa pulih (batas waktu).
//
// Kenapa jarang trade: satu round trip penuh makan ~26 bps biaya (fee 4 bps
// + slippage 2 bps + price impact), jadi tiap trade harus menangkap gerakan
// di atas 1% — bukan scalping. Targetnya 1-3 trade dalam 24 jam.
//
// Semua hitungan memakai bigint (harga dalam skala 10^5, kas dalam
// micro-USDC), tanpa jam dinding, tanpa Math.random — sepenuhnya
// deterministik: dua run pada data yang sama menghasilkan order yang sama.
//
// --- Parameter hasil tuning (grid search di dev window) ---
//
// Sinyal masuk: close >= 1,2% di bawah trailing high 60 bar terakhir
// (DIP_BPS 120) DAN turun >= 0,5% dalam 10 bar terakhir (FAST_BPS 50) —
// dua syarat ini memastikan yang ditangkap memang flush tajam, bukan
// sekadar harga melandai pelan di bawah high lama.
// Keluar: take profit +1,3% dari harga beli (TAKE_PROFIT_BPS 130),
// trailing stop 1,0% di bawah close tertinggi sejak beli
// (TRAIL_STOP_BPS 100), atau batas waktu 240 bar (MAX_HOLD_BARS) kalau
// pantulan tidak datang. Setelah keluar, cooldown 30 bar (COOLDOWN_BARS)
// sebelum boleh masuk lagi — supaya satu flush tidak ditangkap dua kali.
//
// Bukti grid search: 243 kombinasi (DIP x TP x trailing stop x batas
// waktu) diuji di dev window; 83 kombinasi positif. Konfigurasi ini
// berada di plateau positif: DIP 1,2% dengan TP 1,1–1,5% semuanya
// menghasilkan +$10–14, jadi hasilnya tidak bergantung pada satu nilai
// yang kebetulan pas — parameter di sekitarnya ikut positif.
// Hasil backtest dev window: net PnL +$15,62, 4 trade, max drawdown
// 1,21% — lolos dev gate (PnL > 0).

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- Parameter strategi (dipilih dari backtest dev window, nilai bulat) ---
const TRAIL_BARS = 60; // jendela trailing high (60 menit)
const DIP_BPS = 120; // masuk kalau close >= 1,2% di bawah high 60 bar terakhir
const FAST_BARS = 10; // ...dan penurunannya cepat: >= 0,5% dalam 10 bar terakhir
const FAST_BPS = 50;
const TAKE_PROFIT_BPS = 130; // keluar saat close >= harga beli + 1,3%
const TRAIL_STOP_BPS = 100; // keluar saat close <= high sejak beli - 1,0%
const MAX_HOLD_BARS = 240; // keluar paksa setelah 240 bar (4 jam) tanpa pulih
const COOLDOWN_BARS = 30; // jeda 30 bar setelah keluar sebelum boleh masuk lagi
const MAX_SLIPPAGE_BPS = 100; // 1% — longgar untuk gap open, ketat untuk lonjakan liar

const BPS = 10_000n;

type Mode = 'flat' | 'pending-buy' | 'long' | 'pending-sell';

let mode: Mode = 'flat';
let closes: bigint[] = []; // close terakhir, paling baru di akhir
let entryPx = 0n; // harga fill saat beli (skala harga)
let peakSinceEntry = 0n; // close tertinggi sejak beli
let holdBars = 0; // bar sejak beli terisi
let coolBars = 0; // bar tersisa dalam cooldown

/** Close tertinggi dari N bar terakhir (termasuk bar ini). */
function trailingHigh(n: number): bigint {
  let hi = 0n;
  const start = closes.length - n;
  for (let i = start; i < closes.length; i++) {
    if (closes[i]! > hi) hi = closes[i]!;
  }
  return hi;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    const close = state.close(SYMBOL);
    if (close === null) return []; // belum ada bar: tidak bisa menilai apa pun
    closes.push(close);
    if (closes.length > TRAIL_BARS + 1) closes.shift();

    // --- 1. Proses fill dari order batch sebelumnya ---
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL) continue;
      if (fill.side === 'buy' && mode === 'pending-buy') {
        if (fill.status === 'filled') {
          mode = 'long';
          entryPx = BigInt(fill.price);
          peakSinceEntry = close;
          holdBars = 0;
        } else {
          mode = 'flat'; // ditolak (mis. slippage): kembali menunggu sinyal baru
        }
      } else if (fill.side === 'sell' && mode === 'pending-sell') {
        mode = 'flat';
        coolBars = COOLDOWN_BARS;
      }
    }

    if (state.warmingUp) return []; // batch warm-up: order apa pun ditolak

    // --- 2. Keluar dari posisi (hanya saat sudah pegang) ---
    if (mode === 'long') {
      if (close > peakSinceEntry) peakSinceEntry = close;
      holdBars += 1;

      const recovered = close * BPS >= entryPx * (BPS + BigInt(TAKE_PROFIT_BPS));
      const faded = close * BPS <= peakSinceEntry * (BPS - BigInt(TRAIL_STOP_BPS));
      const expired = holdBars >= MAX_HOLD_BARS;
      if (recovered || faded || expired) {
        const pos = state.positions.get(SYMBOL);
        if (pos !== undefined && pos.qty > 0n) {
          mode = 'pending-sell';
          const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
          return [sell];
        }
        mode = 'flat';
        coolBars = COOLDOWN_BARS;
      }
      return [];
    }

    // --- 3. Masuk posisi (hanya saat flat, tidak pending, tidak cooldown) ---
    if (mode !== 'flat') return [];
    if (coolBars > 0) {
      coolBars -= 1;
      return [];
    }
    if (closes.length < TRAIL_BARS + 1) return []; // belum cukup histori
    const high = trailingHigh(TRAIL_BARS);
    if (high === 0n) return [];
    // Penurunan dari trailing high, dalam bps (negatif kalau di bawah high).
    const dipBps = ((close - high) * BPS) / high;
    // Penurunan 10 bar terakhir, dalam bps (negatif kalau turun).
    const tenBack = closes[closes.length - 1 - FAST_BARS]!;
    const fastBps = ((close - tenBack) * BPS) / tenBack;

    const washout = dipBps <= -BigInt(DIP_BPS) && fastBps <= -BigInt(FAST_BPS);
    if (!washout) return [];

    // Beli dengan seluruh kas (maks 100% equity diizinkan caps). Fee sudah
    // termasuk dalam notional, jadi tidak ada sisa yang perlu disisihkan.
    const notional = state.cash;
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    mode = 'pending-buy';
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
