import React, { useState, useMemo, useRef, useLayoutEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { Plus, Trash2, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

// ---------- palette ----------
const INK = "#181B20";
const INK_SOFT = "rgba(24,27,32,0.6)";
const HAIRLINE = "rgba(24,27,32,0.18)";
const PAPER = "#EAEDE4";
const PAPER_RAISED = "#F3F5EE";
const BRASS = "#93712A";
const TEAL = "#33505A";
const RUST = "#9A4A38";

// ---------- amortization math ----------
function standardPayment(balance, monthlyRate, n) {
  if (n <= 0) return 0;
  if (Math.abs(monthlyRate) < 1e-9) return balance / n;
  const f = Math.pow(1 + monthlyRate, n);
  return (balance * monthlyRate * f) / (f - 1);
}

function simulateFull(principal, steps) {
  let balance = principal;
  const rows = [];
  const stepSummaries = [];
  let monthCounter = 0;

  steps.forEach((s, stepIdx) => {
    const r = (s.rate || 0) / 100 / 12;
    const startBalance = balance;
    let stepInterest = 0;
    let stepPrincipal = 0;
    for (let m = 0; m < s.months; m++) {
      monthCounter += 1;
      const beginBalance = balance;
      const interest = beginBalance * r;
      const principalPaid = s.payment - interest;
      balance = beginBalance - principalPaid;
      stepInterest += interest;
      stepPrincipal += principalPaid;
      rows.push({
        month: monthCounter,
        step: stepIdx + 1,
        beginBalance,
        interest,
        payment: s.payment,
        principal: principalPaid,
        endBalance: balance,
      });
    }
    stepSummaries.push({
      step: stepIdx + 1,
      months: s.months,
      rate: s.rate,
      payment: s.payment,
      startBalance,
      interest: stepInterest,
      principal: stepPrincipal,
      endBalance: balance,
    });
  });

  const totalInterest = rows.reduce((a, r) => a + r.interest, 0);
  const totalPayments = rows.reduce((a, r) => a + r.payment, 0);

  return {
    rows,
    stepSummaries,
    totalInterest,
    totalPayments,
    endingBalance: balance,
    totalMonths: monthCounter,
  };
}

// bisection solver for monthly IRR (cash flow sign pattern: one outflow then inflows)
function solveMonthlyIRR(cashflows) {
  const npv = (rate) =>
    cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, i), 0);

  let lo = -0.99;
  let hi = 3;
  let npvLo = npv(lo);
  let npvHi = npv(hi);

  if (npvLo * npvHi > 0) {
    hi = 20;
    npvHi = npv(hi);
    if (npvLo * npvHi > 0) return null;
  }

  let mid = 0;
  for (let i = 0; i < 200; i++) {
    mid = (lo + hi) / 2;
    const npvMid = npv(mid);
    if (Math.abs(npvMid) < 1e-8) break;
    if (npvLo * npvMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      npvLo = npvMid;
    }
  }
  return mid;
}

// ---------- formatting ----------
function fmtMoney(symbol, v) {
  if (v === undefined || v === null || !isFinite(v)) return "—";
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${neg ? "-" : ""}${symbol} ${s}`;
}

function fmtPct(v, d = 2) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${v.toFixed(d)}%`;
}

// format a raw number as "1.234.567" (dot thousand separators, no decimals) for editable inputs
function formatThousands(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  if (!isFinite(n)) return "";
  return Math.round(n).toLocaleString("id-ID");
}

// strip dots/non-digits from a typed value back into a plain number
function parseThousands(str) {
  const digits = String(str).replace(/[^0-9]/g, "");
  if (digits === "") return 0;
  return Number(digits);
}

// Thousands-formatted numeric input that keeps the cursor where you typed,
// even in the middle or at the start — a plain formatThousands()/onChange()
// pair re-renders the dotted string on every keystroke and the browser
// resets the caret to the end, making it impossible to edit anywhere but
// the tail. This tracks how many DIGITS (ignoring separator dots) sit
// before the caret, reformats, then restores the caret after that many
// digits in the new string.
function ThousandsInput({ value, onChange, className, style, ...rest }) {
  const ref = useRef(null);
  const pendingCursor = useRef(null);

  useLayoutEffect(() => {
    if (pendingCursor.current !== null && ref.current) {
      ref.current.setSelectionRange(pendingCursor.current, pendingCursor.current);
      pendingCursor.current = null;
    }
  });

  const handleChange = (e) => {
    const raw = e.target.value;
    const cursorPos = e.target.selectionStart ?? raw.length;
    const digitsBeforeCursor = raw.slice(0, cursorPos).replace(/[^0-9]/g, "").length;

    const numeric = parseThousands(raw);
    const formatted = formatThousands(numeric);

    let seen = 0;
    let newPos = formatted.length;
    for (let i = 0; i < formatted.length; i++) {
      if (/[0-9]/.test(formatted[i])) seen++;
      if (seen === digitsBeforeCursor) {
        newPos = i + 1;
        break;
      }
    }
    if (digitsBeforeCursor === 0) newPos = 0;

    pendingCursor.current = newPos;
    onChange(numeric);
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      value={formatThousands(value)}
      onChange={handleChange}
      className={className}
      style={style}
      {...rest}
    />
  );
}

let idSeed = 1;
function nextId() {
  idSeed += 1;
  return idSeed;
}

const DEFAULT_STEPS = [
  { id: nextId(), months: 36, rate: 3, payment: 6905816 },
  { id: nextId(), months: 36, rate: 6.5, payment: 8358534 },
  { id: nextId(), months: 108, rate: 9.35, payment: 9364331 },
];

export default function StepMortgageCalculator() {
  const [symbol, setSymbol] = useState("Rp");
  const [principal, setPrincipal] = useState(1000000000);
  const [steps, setSteps] = useState(DEFAULT_STEPS);
  const [showSchedule, setShowSchedule] = useState(false);
  const [takeoverEnabled, setTakeoverEnabled] = useState(false);
  const [oldRate, setOldRate] = useState(9);
  const [oldTermMonths, setOldTermMonths] = useState(360);
  const [customPlafon, setCustomPlafon] = useState(false);
  const [oldPlafon, setOldPlafon] = useState(300000);
  const [takeoverFee, setTakeoverFee] = useState(0);

  const updateStep = (id, patch) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addStep = () => {
    if (steps.length >= 7) return;
    setSteps((prev) => [
      ...prev,
      { id: nextId(), months: 12, rate: prev.length ? prev[prev.length - 1].rate : 0, payment: 0 },
    ]);
  };

  const removeStep = (id) => {
    setSteps((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  };

  // Recompute every step's payment in one top-down pass. For each step, the
  // payment is the standard annuity payment that would fully amortize the
  // CURRENT running balance if this step's rate held for the remaining total
  // term (an ARM-style recast). The balance is then carried forward through
  // that step's own months using the payment just computed, so step N+1
  // always starts from a value derived from freshly-solved numbers rather
  // than from whatever was previously typed into step N — this is what the
  // old per-step button couldn't guarantee, since it read each other step's
  // payment as-is regardless of whether it had been (re)calculated yet.
  const recalcAllPayments = () => {
    setSteps((prev) => {
      let balance = principal;
      const next = [];
      for (let i = 0; i < prev.length; i++) {
        const monthsOwn = Math.max(1, Math.round(Number(prev[i].months) || 1));
        const remainingMonths = prev
          .slice(i)
          .reduce((a, s) => a + Math.max(1, Math.round(Number(s.months) || 1)), 0);
        const r = (Number(prev[i].rate) || 0) / 100 / 12;
        const payment = Math.round(standardPayment(balance, r, remainingMonths));
        next.push({ ...prev[i], payment });
        for (let m = 0; m < monthsOwn; m++) {
          const interest = balance * r;
          balance -= payment - interest;
        }
      }
      return next;
    });
  };

  const result = useMemo(() => {
    if (!principal || principal <= 0) return null;
    const cleanSteps = steps.map((s) => ({
      months: Math.max(1, Math.round(Number(s.months) || 1)),
      rate: Number(s.rate) || 0,
      payment: Number(s.payment) || 0,
    }));
    const sim = simulateFull(principal, cleanSteps);

    const cashflows = [-principal];
    sim.rows.forEach((row, i) => {
      const isLast = i === sim.rows.length - 1;
      cashflows.push(row.payment + (isLast ? sim.endingBalance : 0));
    });

    const monthlyIRR = solveMonthlyIRR(cashflows);
    const nominalAnnual = monthlyIRR !== null ? monthlyIRR * 12 * 100 : null;
    const effectiveAnnual =
      monthlyIRR !== null ? (Math.pow(1 + monthlyIRR, 12) - 1) * 100 : null;

    // Alternative annual IRR: sum each calendar year's cash flow into one lump
    // (as if it landed on a single date instead of monthly), then solve IRR
    // directly on those yearly buckets. This is what you get from "=IRR(...)"
    // over a 15-row yearly cash-flow table in Excel — it does NOT match the
    // monthly-then-annualized figures above, because bunching intra-year
    // payments into one year-end value changes the implied timing of money.
    const yearlyCashflows = [-principal];
    for (let y = 0; y < Math.ceil(sim.rows.length / 12); y++) {
      const chunk = cashflows.slice(1 + y * 12, 1 + y * 12 + 12);
      yearlyCashflows.push(chunk.reduce((a, b) => a + b, 0));
    }
    const yearlyIRR = yearlyCashflows.length > 1 ? solveMonthlyIRR(yearlyCashflows) : null;
    const annualIRRFromYearlyBuckets = yearlyIRR !== null ? yearlyIRR * 100 : null;

    return {
      ...sim,
      monthlyIRR,
      nominalAnnual,
      effectiveAnnual,
      annualIRRFromYearlyBuckets,
    };
  }, [principal, steps]);

  const chartData = useMemo(() => {
    if (!result) return [];
    const step = Math.max(1, Math.ceil(result.rows.length / 200));
    const out = [];
    result.rows.forEach((r, i) => {
      if (i % step === 0 || i === result.rows.length - 1) {
        out.push({ month: r.month, balance: Math.max(0, r.endBalance) });
      }
    });
    return out;
  }, [result]);

  const stepBoundaries = useMemo(() => {
    if (!result) return [];
    const bounds = [];
    let cum = 0;
    result.stepSummaries.forEach((s, i) => {
      cum += s.months;
      if (i < result.stepSummaries.length - 1) bounds.push(cum);
    });
    return bounds;
  }, [result]);

  const hasBalloon = result && Math.abs(result.endingBalance) > 1;

  // comparison: current step scheme vs. a single flat-rate "before takeover" scheme
  const takeover = useMemo(() => {
    if (!takeoverEnabled || !result || !principal || principal <= 0) return null;

    const oldPrincipal = customPlafon ? Number(oldPlafon) || 0 : principal;
    const oldMonthlyRate = (Number(oldRate) || 0) / 100 / 12;
    const oldMonths = Math.max(1, Math.round(Number(oldTermMonths) || 1));
    const oldPayment = standardPayment(oldPrincipal, oldMonthlyRate, oldMonths);
    const fee = Number(takeoverFee) || 0;

    const horizon = Math.max(oldMonths, result.totalMonths);
    const cumOld = [0];
    const cumNew = [fee];
    let runningOld = 0;
    let runningNew = fee;

    for (let t = 1; t <= horizon; t++) {
      if (t <= oldMonths) runningOld += oldPayment;
      cumOld.push(runningOld);

      if (t <= result.totalMonths) runningNew += result.rows[t - 1].payment;
      cumNew.push(runningNew);
    }

    // find every point where the two cumulative lines meet (cross or touch),
    // interpolating a fractional month for a precise position on the chart
    const EPS = 1e-6;
    const crossings = [];
    for (let t = 1; t <= horizon; t++) {
      const dPrev = cumNew[t - 1] - cumOld[t - 1];
      const dCurr = cumNew[t] - cumOld[t];
      if (Math.abs(dPrev) < EPS) {
        crossings.push(t - 1);
      } else if (dPrev * dCurr < 0) {
        const frac = dPrev / (dPrev - dCurr);
        crossings.push(t - 1 + frac);
      }
    }
    if (Math.abs(cumNew[horizon] - cumOld[horizon]) < EPS) crossings.push(horizon);

    // dedupe near-identical months (can happen at segment boundaries) and sort
    crossings.sort((a, b) => a - b);
    const meetMonths = crossings.filter(
      (m, i) => i === 0 || Math.abs(m - crossings[i - 1]) > 1e-4
    );

    const firstMeetMonth = meetMonths.length ? meetMonths[0] : null;
    const lastMeetMonth = meetMonths.length ? meetMonths[meetMonths.length - 1] : null;

    const valueAt = (cum, month) => {
      const t0 = Math.floor(month);
      const t1 = Math.ceil(month);
      const frac = month - t0;
      return cum[t0] + (cum[t1] - cum[t0]) * frac;
    };
    const firstMeetValue = firstMeetMonth !== null ? valueAt(cumOld, firstMeetMonth) : null;
    const lastMeetValue = lastMeetMonth !== null ? valueAt(cumOld, lastMeetMonth) : null;

    let status;
    if (meetMonths.length > 0) status = "crosses";
    else if (cumNew[horizon] < cumOld[horizon]) status = "still-below";
    else status = "always-above";

    const oldTotal = cumOld[oldMonths];

    return {
      oldPrincipal,
      oldPayment,
      oldMonths,
      fee,
      horizon,
      cumOld,
      cumNew,
      status,
      firstMeetMonth,
      firstMeetValue,
      lastMeetMonth,
      lastMeetValue,
      oldTotal,
      newTotalAtHorizon: cumNew[result.totalMonths],
    };
  }, [takeoverEnabled, oldRate, oldTermMonths, customPlafon, oldPlafon, takeoverFee, principal, result]);

  const takeoverChartData = useMemo(() => {
    if (!takeover) return [];
    const step = Math.max(1, Math.ceil(takeover.horizon / 200));
    const out = [];
    for (let t = 0; t <= takeover.horizon; t++) {
      if (t % step === 0 || t === takeover.horizon) {
        out.push({ month: t, baru: takeover.cumNew[t], lama: takeover.cumOld[t] });
      }
    }
    return out;
  }, [takeover]);

  const inputStyle = {
    borderBottom: `1px solid ${HAIRLINE}`,
    color: INK,
  };

  return (
    <div style={{ background: PAPER, color: INK, minHeight: "100vh" }} className="font-mono step-mortgage-calc">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .step-mortgage-calc input[type="number"]::-webkit-outer-spin-button,
        .step-mortgage-calc input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .step-mortgage-calc input[type="number"] {
          -moz-appearance: textfield;
          appearance: textfield;
        }
      `}</style>

      <div className="max-w-fit mx-auto px-6 py-10">
        <header className="mb-10 max-w-xl">
          <h1 style={{ fontFamily: "Fraunces, serif" }} className="text-4xl mb-3">
            Kalkulator KPR
          </h1>
          <h4 style={{ fontFamily: "Fraunces, serif" }} className="text-4xl mb-3">
            Consumer Loan Group (CSL)
            </h4>
          <p style={{ color: INK_SOFT }} className="text-sm leading-relaxed">
            Simulasi Kredit KPR dengan program disesuaikan · Made with ❤️ Claude
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
          {/* LEFT: inputs */}
          <div className="lg:col-span-2 lg:pr-10" style={{ borderRight: `1px solid ${HAIRLINE}` }}>
            <section className="mb-10">
              <h2 className="text-xs mb-4" style={{ color: INK_SOFT }}>
                Pinjaman
              </h2>
              <div className="space-y-5">
                <div className="flex items-end gap-3">
                  <div className="w-16">
                    <label className="block text-xs mb-1" style={{ color: INK_SOFT }}>
                      Simbol
                    </label>
                    <input
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value)}
                      className="w-full bg-transparent py-1 text-sm focus:outline-none"
                      style={inputStyle}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs mb-1" style={{ color: INK_SOFT }}>
                      Jumlah pinjaman
                    </label>
                    <ThousandsInput
                      value={principal}
                      onChange={setPrincipal}
                      className="w-full bg-transparent py-1 text-lg focus:outline-none"
                      style={inputStyle}
                    />
                  </div>
                </div>
                <div className="text-xs pt-1" style={{ color: INK_SOFT }}>
                  Total jangka waktu: {result ? result.totalMonths : 0} bulan (
                  {result ? (result.totalMonths / 12).toFixed(1) : "0"} tahun)
                </div>
              </div>
            </section>

            <section className="mb-10">
              <label className="flex items-center gap-2 text-xs mb-4 cursor-pointer" style={{ color: INK_SOFT }}>
                <input
                  type="checkbox"
                  checked={takeoverEnabled}
                  onChange={(e) => setTakeoverEnabled(e.target.checked)}
                />
                Aktifkan simulasi take over (bandingkan dengan skema sebelumnya)
              </label>

              {takeoverEnabled && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: INK_SOFT }}>
                      Suku bunga skema lama (%) — sebelum take over
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={oldRate}
                      onChange={(e) => setOldRate(parseFloat(e.target.value) || 0)}
                      className="w-32 bg-transparent py-1 text-sm focus:outline-none"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: INK_SOFT }}>
                      Sisa jangka waktu skema lama (bulan)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={oldTermMonths}
                      onChange={(e) => setOldTermMonths(parseFloat(e.target.value) || 0)}
                      className="w-32 bg-transparent py-1 text-sm focus:outline-none"
                      style={inputStyle}
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: INK_SOFT }}>
                    <input
                      type="checkbox"
                      checked={customPlafon}
                      onChange={(e) => setCustomPlafon(e.target.checked)}
                    />
                    Plafon skema lama berbeda dari pinjaman baru
                  </label>

                  {customPlafon && (
                    <div>
                      <label className="block text-xs mb-1" style={{ color: INK_SOFT }}>
                        Plafon skema lama
                      </label>
                      <ThousandsInput
                        value={oldPlafon}
                        onChange={setOldPlafon}
                        className="w-full bg-transparent py-1 text-sm focus:outline-none"
                        style={inputStyle}
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs mb-1" style={{ color: INK_SOFT }}>
                      Biaya tambahan take over (bulan ke-0)
                    </label>
                    <ThousandsInput
                      value={takeoverFee}
                      onChange={setTakeoverFee}
                      className="w-full bg-transparent py-1 text-sm focus:outline-none"
                      style={inputStyle}
                    />
                  </div>

                  <div className="text-xs" style={{ color: INK_SOFT }}>
                    Skema lama diasumsikan bunga tetap tunggal dengan cicilan tetap:{" "}
                    {takeover ? fmtMoney(symbol, takeover.oldPayment) : "—"} / bulan
                    {customPlafon ? " (dihitung dari plafon skema lama)." : " (menggunakan plafon yang sama dengan pinjaman baru)."}
                  </div>
                </div>
              )}
            </section>

            <section>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-xs" style={{ color: INK_SOFT }}>
                  Tahap pembayaran
                </h2>
                <span className="text-xs" style={{ color: INK_SOFT }}>
                  {steps.length}/7
                </span>
              </div>

              <div className="grid grid-cols-12 gap-2 text-xs pb-2 mb-1" style={{ color: INK_SOFT, borderBottom: `1px solid ${HAIRLINE}` }}>
                <div className="col-span-1">#</div>
                <div className="col-span-3">Bulan</div>
                <div className="col-span-3">Bunga %</div>
                <div className="col-span-4">Cicilan</div>
                <div className="col-span-1"></div>
              </div>

              {steps.map((s, idx) => (
                <div
                  key={s.id}
                  className="grid grid-cols-12 gap-2 items-center py-2"
                  style={{ borderBottom: `1px solid ${HAIRLINE}` }}
                >
                  <div
                    className="col-span-1 text-sm"
                    style={{ fontFamily: "Fraunces, serif", color: BRASS }}
                  >
                    {idx + 1}
                  </div>
                  <input
                    type="number"
                    min="1"
                    value={s.months}
                    onChange={(e) => updateStep(s.id, { months: e.target.value })}
                    className="col-span-3 bg-transparent text-sm py-1 focus:outline-none"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={s.rate}
                    onChange={(e) => updateStep(s.id, { rate: e.target.value })}
                    className="col-span-3 bg-transparent text-sm py-1 focus:outline-none"
                  />
                  <ThousandsInput
                    value={s.payment}
                    onChange={(v) => updateStep(s.id, { payment: v })}
                    className="col-span-4 bg-transparent text-sm py-1 focus:outline-none"
                  />
                  <div className="col-span-1 flex gap-1 justify-end">
                    <button
                      title="Hapus tahap"
                      onClick={() => removeStep(s.id)}
                      disabled={steps.length === 1}
                      className="p-1"
                    >
                      <Trash2 size={14} color={steps.length === 1 ? HAIRLINE : RUST} />
                    </button>
                  </div>
                </div>
              ))}

              <div className="mt-4 flex items-center gap-4">
                <button
                  onClick={addStep}
                  disabled={steps.length >= 7}
                  className="text-xs flex items-center gap-1"
                  style={{ color: steps.length >= 7 ? INK_SOFT : TEAL }}
                >
                  <Plus size={14} /> Tambah tahap
                </button>
                <button
                  title="Hitung ulang cicilan semua tahap dari awal, berurutan"
                  onClick={recalcAllPayments}
                  className="text-xs flex items-center gap-1"
                  style={{ color: BRASS }}
                >
                  <RefreshCw size={14} /> Hitung ulang semua cicilan
                </button>
              </div>
            </section>
          </div>

          {/* RIGHT: results */}
          <div className="lg:col-span-3">
            <div className="mb-10">
              {result && result.monthlyIRR !== null ? (
                <>
                  <div
                    style={{ fontFamily: "Fraunces, serif", color: BRASS }}
                    className="text-6xl leading-none"
                  >
                    {fmtPct(result.annualIRRFromYearlyBuckets)}
                  </div>
                  <div className="text-sm mt-3" style={{ color: INK_SOFT }}>
                    IRR tahunan bagi pemberi pinjaman
                  </div>
                  <div className="text-xs mt-1" style={{ color: INK_SOFT }}>
                    {fmtPct(result.monthlyIRR * 100, 4)} per bulan · {fmtPct(result.nominalAnnual)} nominal tahunan · {fmtPct(result.effectiveAnnual)} effective IRR
                  </div>
                </>
              ) : (
                <div className="text-sm" style={{ color: INK_SOFT }}>
                  Masukkan jumlah pinjaman dan minimal satu tahap pembayaran untuk menghitung IRR.
                </div>
              )}
            </div>

            <div
              className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm mb-3 pb-6"
              style={{ borderBottom: `1px solid ${HAIRLINE}` }}
            >
              <div style={{ color: INK_SOFT }}>Total jangka waktu</div>
              <div className="text-right">{result?.totalMonths ?? 0} bulan</div>
              <div style={{ color: INK_SOFT }}>Total pembayaran</div>
              <div className="text-right">{fmtMoney(symbol, result?.totalPayments ?? 0)}</div>
              <div style={{ color: INK_SOFT }}>Total bunga</div>
              <div className="text-right">{fmtMoney(symbol, result?.totalInterest ?? 0)}</div>
              <div style={{ color: INK_SOFT }}>Sisa saldo akhir</div>
              <div className="text-right" style={{ color: hasBalloon ? RUST : INK }}>
                {fmtMoney(symbol, result?.endingBalance ?? 0)}
              </div>
            </div>
            {hasBalloon && (
              <div className="text-xs mb-8" style={{ color: RUST }}>
                Sisa saldo yang tidak nol dianggap sebagai pelunasan yang diterima pada bulan terakhir saat menghitung IRR.
              </div>
            )}
            {!hasBalloon && <div className="mb-8" />}

            <div className="mb-10">
              <h2 className="text-xs mb-4" style={{ color: INK_SOFT }}>
                Saldo dari waktu ke waktu
              </h2>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid stroke={HAIRLINE} vertical={false} />
                  <XAxis
                    dataKey="month"
                    type="number"
                    domain={[0, "dataMax"]}
                    tick={{ fontSize: 11, fill: INK_SOFT }}
                    tickLine={false}
                    axisLine={{ stroke: HAIRLINE }}
                    label={{ value: "Bulan", position: "insideBottom", offset: -5, fontSize: 11, fill: INK_SOFT }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: INK_SOFT }}
                    tickLine={false}
                    axisLine={{ stroke: HAIRLINE }}
                    tickFormatter={(v) => symbol + " " + Math.round(v / 1000) + "rb"}
                  />
                  <Tooltip formatter={(v) => fmtMoney(symbol, v)} labelFormatter={(l) => `Bulan ${l}`} />
                  {stepBoundaries.map((b, i) => (
                    <ReferenceLine key={i} x={b} stroke={HAIRLINE} strokeDasharray="3 3" />
                  ))}
                  <Line type="monotone" dataKey="balance" stroke={TEAL} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {takeover && (
              <div className="mb-10">
                <h2 className="text-xs mb-4" style={{ color: INK_SOFT }}>
                  Total pembayaran kumulatif: skema baru vs skema lama
                </h2>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={takeoverChartData}>
                    <CartesianGrid stroke={HAIRLINE} vertical={false} />
                    <XAxis
                      dataKey="month"
                      type="number"
                      domain={[0, "dataMax"]}
                      tick={{ fontSize: 11, fill: INK_SOFT }}
                      tickLine={false}
                      axisLine={{ stroke: HAIRLINE }}
                      label={{ value: "Bulan", position: "insideBottom", offset: -5, fontSize: 11, fill: INK_SOFT }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: INK_SOFT }}
                      tickLine={false}
                      axisLine={{ stroke: HAIRLINE }}
                      tickFormatter={(v) => symbol + " " + Math.round(v / 1000) + "rb"}
                    />
                    <Tooltip formatter={(v) => fmtMoney(symbol, v)} labelFormatter={(l) => `Bulan ${l}`} />
                    {takeover.firstMeetMonth !== null && (
                      <ReferenceLine
                        x={Math.round(takeover.firstMeetMonth)}
                        stroke={RUST}
                        strokeDasharray="3 3"
                        label={{ value: "Titik temu pertama", fontSize: 11, fill: RUST, position: "top" }}
                      />
                    )}
                    {takeover.lastMeetMonth !== null &&
                      Math.abs(takeover.lastMeetMonth - takeover.firstMeetMonth) > 0.5 && (
                        <ReferenceLine
                          x={Math.round(takeover.lastMeetMonth)}
                          stroke={TEAL}
                          strokeDasharray="3 3"
                          label={{ value: "Titik temu terakhir", fontSize: 11, fill: TEAL, position: "top" }}
                        />
                      )}
                    <Line type="monotone" dataKey="baru" name="Skema baru" stroke={BRASS} dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="lama" name="Skema lama" stroke={TEAL} dot={false} strokeWidth={2} strokeDasharray="5 3" />
                  </LineChart>
                </ResponsiveContainer>

                <div className="text-sm mt-4" style={{ color: INK_SOFT }}>
                  {takeover.status === "crosses" && (
                    <>
                      Titik temu pertama sekitar bulan{" "}
                      <span style={{ color: INK }}>{Math.round(takeover.firstMeetMonth)}</span>{" "}
                      ({(takeover.firstMeetMonth / 12).toFixed(1)} tahun), saat total pembayaran kumulatif
                      sekitar {fmtMoney(symbol, takeover.firstMeetValue)}.
                      {Math.abs(takeover.lastMeetMonth - takeover.firstMeetMonth) > 0.5 && (
                        <>
                          {" "}Kedua skema bertemu lagi sekitar bulan{" "}
                          <span style={{ color: INK }}>{Math.round(takeover.lastMeetMonth)}</span>{" "}
                          ({(takeover.lastMeetMonth / 12).toFixed(1)} tahun), saat total pembayaran kumulatif
                          sekitar {fmtMoney(symbol, takeover.lastMeetValue)}.
                        </>
                      )}
                    </>
                  )}
                  {takeover.status === "still-below" && (
                    <>
                      Skema baru tetap lebih hemat secara kumulatif dibanding skema lama sepanjang{" "}
                      {takeover.horizon} bulan yang disimulasikan — kedua garis belum pernah bertemu dalam jangka
                      waktu ini.
                    </>
                  )}
                  {takeover.status === "always-above" && (
                    <>
                      Total pembayaran skema baru sudah lebih tinggi dari skema lama sejak awal dan tidak
                      pernah bertemu — skema lama secara kumulatif selalu lebih hemat.
                    </>
                  )}
                </div>

                <div
                  className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm mt-5 pt-5"
                  style={{ borderTop: `1px solid ${HAIRLINE}` }}
                >
                  {customPlafon && (
                    <>
                      <div style={{ color: INK_SOFT }}>Plafon skema lama</div>
                      <div className="text-right">{fmtMoney(symbol, takeover.oldPrincipal)}</div>
                    </>
                  )}
                  <div style={{ color: INK_SOFT }}>Total skema lama ({takeover.oldMonths} bulan)</div>
                  <div className="text-right">{fmtMoney(symbol, takeover.oldTotal)}</div>
                  {takeover.fee > 0 && (
                    <>
                      <div style={{ color: INK_SOFT }}>Biaya tambahan take over (bulan ke-0)</div>
                      <div className="text-right">{fmtMoney(symbol, takeover.fee)}</div>
                    </>
                  )}
                  <div style={{ color: INK_SOFT }}>Total skema baru ({result.totalMonths} bulan)</div>
                  <div className="text-right">{fmtMoney(symbol, takeover.newTotalAtHorizon)}</div>
                </div>
              </div>
            )}

            <div className="mb-8">
              <h2 className="text-xs mb-4" style={{ color: INK_SOFT }}>
                Ringkasan tahap
              </h2>
              <table className="max-w-fit text-sm divide-y">
                <thead>
                  <tr style={{ color: INK_SOFT, borderBottom: `1px solid ${HAIRLINE}` }} className="text-left">
                    <th className="py-2 px-2 font-normal">Tahap</th>
                    <th className="py-2 px-2 font-normal">Bulan</th>
                    <th className="py-2 px-2 font-normal">Bunga</th>
                    <th className="py-2 px-2 font-normal">Cicilan</th>
                    <th className="py-2 px-2 font-normal text-right">Bunga terbayar</th>
                    <th className="py-2 px-2 font-normal text-right">Pokok terbayar</th>
                    <th className="py-2 px-2 font-normal text-right">Saldo akhir</th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  {result?.stepSummaries.map((s) => (
                    <tr key={s.step} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                      <td className="py-2 px-2 text-center" style={{ fontFamily: "Fraunces, serif", color: BRASS }}>
                        {s.step}
                      </td>
                      <td className="py-2 px-2">{s.months}</td>
                      <td className="py-2 px-2">{fmtPct(s.rate)}</td>
                      <td className="py-2 px-2">{fmtMoney(symbol, s.payment)}</td>
                      <td className="py-2 px-2 text-right">{fmtMoney(symbol, s.interest)}</td>
                      <td className="py-2 px-2 text-right">{fmtMoney(symbol, s.principal)}</td>
                      <td className="py-2 px-2 text-right">{fmtMoney(symbol, s.endBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <button
                onClick={() => setShowSchedule((v) => !v)}
                className="text-xs flex items-center gap-1"
                style={{ color: TEAL }}
              >
                {showSchedule ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showSchedule ? "Sembunyikan" : "Tampilkan"} jadwal bulanan
              </button>
              {showSchedule && (
                <div className="mt-4 max-h-80 overflow-y-auto" style={{ border: `1px solid ${HAIRLINE}` }}>
                  <table className="w-full text-xs">
                    <thead style={{ position: "sticky", top: 0, background: PAPER_RAISED }}>
                      <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                        <th className="py-1 px-2 text-left font-normal">Bln</th>
                        <th className="py-1 px-2 text-left font-normal">Awal</th>
                        <th className="py-1 px-2 text-left font-normal">Bunga</th>
                        <th className="py-1 px-2 text-left font-normal">Cicilan</th>
                        <th className="py-1 px-2 text-left font-normal">Pokok</th>
                        <th className="py-1 px-2 text-left font-normal">Akhir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result?.rows.map((r) => (
                        <tr key={r.month} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                          <td className="py-1 px-2">{r.month}</td>
                          <td className="py-1 px-2">{fmtMoney(symbol, r.beginBalance)}</td>
                          <td className="py-1 px-2">{fmtMoney(symbol, r.interest)}</td>
                          <td className="py-1 px-2">{fmtMoney(symbol, r.payment)}</td>
                          <td className="py-1 px-2">{fmtMoney(symbol, r.principal)}</td>
                          <td className="py-1 px-2">{fmtMoney(symbol, r.endBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}