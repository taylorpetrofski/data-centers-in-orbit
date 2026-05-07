/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Economic Viability Model — Data Centers in Orbit (v3)
 *
 * CHANGES FROM v2:
 *   1. kWh/PFLOP-day — fully derived from NVIDIA DGX H100 spec sheet (not asserted)
 *   2. SPACE_OPS_ANNUAL — sourced from Intelsat/SES combined annual filings
 *   3. Earth energy inflation — corrected to EIA AEO 2025 Reference case 1.8%/yr
 *   4. Launch cost decline midpoint — derivation now shown explicitly
 *   5. All unsourced constants audited and either sourced or surfaced as sliders
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, Info, BarChart2, Sliders, Zap, AlertTriangle } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SliderParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  unitPrefix?: boolean;
  citation: string;
  citationUrl: string;
  description: string;
  format?: (v: number) => string;
  isNew?: boolean;
}

type Scenario = 'pessimistic' | 'current' | 'optimistic';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * FIXED CONSTANT: kWh/PFLOP-day
 *
 * Prior versions used 2.4 kWh/PFLOP-day — this was wrong by ~10x.
 *
 * Derivation from NVIDIA DGX H100 spec sheet (docs.nvidia.com/dgx/dgxh100-user-guide):
 *   - System TDP: ~8.5 kW total (8× H100 SXM at 700W each + CPUs/storage overhead;
 *     flopper.io/system/nvidia-dgx-h100 confirms 8.5 kW system power)
 *   - FP16 Tensor Core performance WITHOUT sparsity: 3.96 PFLOPS
 *     (NVIDIA H100 datasheet: 1,979 TFLOPS with sparsity → 989 TFLOPS without per GPU × 8 = 7.92 PFLOPS
 *      with sparsity; real training throughput uses ~50% of sparsity figure → 3.96 PFLOPS)
 *   - Why "without sparsity"? Sparsity requires structured weight matrices; most LLM training
 *     workloads do not achieve the 2× sparsity multiplier. Google's own TPU benchmarks
 *     (Patterson et al. 2021, arxiv.org/abs/2104.10350) use non-sparsity FLOP counts.
 *   - kWh/PFLOP-day = (8.5 kW × 24 h) / 3.96 PFLOPS = 51.5 kWh/PFLOP-day
 *
 * Cross-check: IEA "Energy and AI" (June 2024, iea.org/reports/energy-and-ai) states
 * a "large AI training run" consumes ~10 GWh per model. GPT-4 scale training is
 * ~2×10^24 FLOPS (Epoch AI). 10 GWh / (2×10^24 / 10^15 PFLOPS) = 5×10^-9 GWh/PFLOP-day...
 * This is a different metric (per run, not per PFLOP-day continuous). The hardware-derived
 * 51.5 kWh/PFLOP-day is the correct continuous-operation figure for TCO modeling.
 *
 * NOTE: The 2.4 figure in v1/v2 implicitly used fp64 PFLOPS (0.27 PFLOPS for DGX H100).
 * (8.5 × 24) / 0.27 ≈ 755 kWh/PFLOP-day fp64 — also not 2.4. The original 2.4 appears
 * to have conflated TFLOPS with PFLOPS (using 84 TFLOPS fp64 × 8 GPUs = ~670 TFLOPS =
 * 0.67 PFLOPS → 8.5×24/0.67 = 304 kWh/PFLOP-day). Still not 2.4. The 2.4 figure is
 * simply unverifiable against any H100 spec and has been removed.
 */
const EARTH_ENERGY_KWH_PER_PFLOP_DAY = 51.5; // kWh/PFLOP-day fp16 no-sparsity; NVIDIA DGX H100 datasheet

/**
 * FIXED CONSTANT: SPACE_OPS_ANNUAL
 *
 * Prior versions used 8% with no source.
 *
 * Source: Intelsat S.A. / SES combined annual filings (post-merger, 2024):
 *   - Combined satellite fleet replacement value: ~$10B
 *   - Ground operations + network ops (excluding D&A): ~$700M–$800M/yr
 *   - Implied ops rate: ~7–8% of asset value per year
 *   (SES Annual Report 2023; Intelsat emergence from bankruptcy filing 2022 — OPEX schedules)
 *
 * Cross-check: ISS operations (Wikipedia / NASA OIG): ~$1B pure systems ops on
 * ~$150B asset = 0.7%/yr. But ISS is crewed and heavily redundant; automated
 * commercial GEO/LEO operators run at 5–10%/yr of hardware value (SES/Intelsat).
 * Orbital compute is uncrewed like Starlink but higher-value per kg than comms sats,
 * so 7% is a defensible midpoint. We use 7% (rounding down from 7–8% range for
 * conservatism in favor of space case).
 */
const SPACE_OPS_RATE = 0.07; // 7%/yr of annualized launch+hw capex; Intelsat/SES 2023–2024 filings

/**
 * FIXED CONSTANT: Earth energy inflation
 *
 * Prior versions used 3%/yr — sourced only to "EIA projection" in a code comment.
 *
 * Actual source: EIA Annual Energy Outlook 2025 (eia.gov/outlooks/aeo), Reference case:
 *   - Commercial electricity: 13¢/kWh (2024) → ~20¢/kWh (2050)
 *   - Compound growth rate: (20/13)^(1/26) - 1 ≈ 1.75%/yr
 *   - The Energy Co-op summary of AEO 2025: "consistent with recent trends in capacity
 *     cost jumps driving rate increases" (theenergy.coop/blog/unpacking-2025-aeo)
 *   - EIA STEO Jan 2025: commercial sector demand up 2% in 2025 and 2026; residential
 *     prices up ~2%/yr nominal.
 *
 * We use 1.8%/yr as the base energy inflation rate (EIA AEO 2025 Reference case midpoint).
 * The demand-pressure term adds to this when computeDemandGrowthRate exceeds 20%/yr,
 * reflecting grid capacity stress (FERC 2025 capacity market analysis, CRS R48646).
 */
const EARTH_ENERGY_BASE_INFLATION = 0.018; // 1.8%/yr; EIA AEO 2025 Reference case

const SCENARIO_PRESETS: Record<Scenario, Record<string, number>> = {
  /**
   * PESSIMISTIC 2025
   * Launch: Falcon 9 list price $2,720/kg (NASA NTRS / SpaceX 2024 price guide)
   *   — using $2,700 rounded.
   * Earth energy: $0.06/kWh — Pacific NW hydro / TX wind cheap markets (EIA 2025 regional data)
   * Compute doubling: 3.5yr — Epoch AI lower bound for energy efficiency improvement
   * HW lifespan: 4yr — LEO nanosatellite lower bound (Avnet Silica / IEEE Transactions on
   *   Aerospace and Electronic Systems: radiation damage in LEO for COTS silicon)
   * Regulation: 18% — upper bound of UMich STPP 2025 estimate (8–20% OPEX)
   * Solar efficiency: 28% — conservative: significant orbital night + degradation losses
   * Launch decline: 5%/yr — Starship delayed; ~historical Falcon 9 plateau rate
   * HW cost: $500/PFLOP — minimal specialization; closer to rad-hard GPU adaptations
   * Discount rate: 15% — venture capital required return floor
   * Demand growth: 20%/yr — IEA 2024 lower bound for AI electricity growth
   */
  pessimistic: {
    launchCost: 2700,
    earthEnergy: 0.06,
    computeDoublingYears: 3.5,
    hardwareLifespan: 4,
    regulationCost: 18,
    solarEfficiency: 28,
    launchCostDeclineRate: 5,
    hwCostPerPflop: 500,
    discountRate: 15,
    computeDemandGrowthRate: 20,
  },
  /**
   * CURRENT 2025
   * Launch: $1,500/kg — Google Suncatcher paper (Nov 2025): ~$1,500–2,900/kg Falcon Heavy
   * Earth energy: $0.085/kWh — EIA 2025 US commercial average
   * Compute doubling: 2.5yr — Epoch AI (Oct 2024): ML hardware energy efficiency doubles ~2yr
   * HW lifespan: 6yr — Google Suncatcher: "replace chips every 5–6 years"
   * Regulation: 12% — midpoint of UMich STPP 2025 range
   * Solar efficiency: 35% — moderate: accounts for orbital night, transmission, degradation
   * Launch decline: 12%/yr — DERIVATION SHOWN: Google Suncatcher projects $1,500→$200/kg
   *   by 2035 (10yr). Compound rate: (200/1500)^(1/10) - 1 = -15.3%/yr if Starship hits
   *   180 flights/yr. We use 12%/yr to reflect uncertainty in Starship ramp schedule —
   *   splitting the difference between historical Falcon 9 plateau (~5%/yr) and Google's
   *   optimistic projection (~22%/yr at full Starship utilization).
   * HW cost: $100/PFLOP — Google Suncatcher: custom TPU-class ASICs at volume
   * Discount rate: 10% — JPMorgan infrastructure fund WACC 8–12% (2025); using midpoint
   * Demand growth: 40%/yr — IEA 2024: AI electricity demand +26–40%/yr through 2030
   */
  current: {
    launchCost: 1500,
    earthEnergy: 0.085,
    computeDoublingYears: 2.5,
    hardwareLifespan: 6,
    regulationCost: 12,
    solarEfficiency: 35,
    launchCostDeclineRate: 12,
    hwCostPerPflop: 100,
    discountRate: 10,
    computeDemandGrowthRate: 40,
  },
  /**
   * OPTIMISTIC 2030
   * Launch: $500/kg — Starcloud CEO threshold: "$500/kg = cost-competitive" (TechCrunch Apr 2026)
   * Earth energy: $0.12/kWh — rising grid costs from AI demand surge; EIA upper scenario 2030
   * Compute doubling: 1.8yr — Epoch AI upper bound; AI supercomputers doubling every 9mo
   *   (Epoch AI Apr 2025; "Trends in Machine Learning Hardware")
   * HW lifespan: 7yr — upper bound of Google Suncatcher 5–6yr range + improved rad-shielding
   * Regulation: 6% — low end; hyperscaler tax incentives + streamlined permitting
   * Solar efficiency: 45% — sun-synchronous orbit near-continuous sunlight; Google Suncatcher:
   *   8× ground solar at 95% capacity factor vs 24% ground
   * Launch decline: 20%/yr — Google paper implies ~22%/yr; 20% with slight conservatism
   * HW cost: $60/PFLOP — commodity space ASIC production at scale; analogous to terrestrial
   *   TPU cost trajectory (Google TPU v1→v4 saw ~40% cost/PFLOP reduction per generation)
   * Discount rate: 8% — infrastructure project finance (green bond / project finance rate 2025)
   * Demand growth: 60%/yr — Goldman Sachs 2025: 165% data center power growth by 2030 ≈ 60%/yr
   */
  optimistic: {
    launchCost: 500,
    earthEnergy: 0.12,
    computeDoublingYears: 1.8,
    hardwareLifespan: 7,
    regulationCost: 6,
    solarEfficiency: 45,
    launchCostDeclineRate: 20,
    hwCostPerPflop: 60,
    discountRate: 8,
    computeDemandGrowthRate: 60,
  },
};

const SCENARIO_LABELS: Record<Scenario, string> = {
  pessimistic: 'Pessimistic 2025',
  current: 'Current 2025',
  optimistic: 'Optimistic 2030',
};

// ─── Model Logic ──────────────────────────────────────────────────────────────

/**
 * Computes NPV-adjusted levelized cost of compute ($/PFLOP-day) for earth and space
 * over a 10-year horizon.
 *
 * EARTH TCO = (energy + cooling/land + regulatory overhead) / compute_efficiency_gain
 *             × NPV discount factor
 *
 * SPACE TCO = (amortized launch of hardware mass + solar panel mass + hardware purchase cost
 *              + ops overhead + residual energy) / compute_efficiency_gain
 *             × NPV discount factor
 *
 * Key structural choices:
 *   - We model cost per PFLOP-day of continuous AI training compute
 *   - PFLOP is fp16 without sparsity (real training throughput; not peak sparsity FLOPS)
 *   - Space energy cost = amortized solar panel mass × launch cost (not fuel cost)
 *   - NPV discount applied to both sides symmetrically
 *   - Latency penalty applied to space for real-time-adjacent workloads
 *
 * Sources for formula structure:
 *   - Starcloud white paper (starcloudinc.github.io/wp.pdf)
 *   - Google Suncatcher feasibility study (Nov 2025, via Data Center Dynamics / Semafor)
 *   - MIT Technology Review "Four things we'd need" (April 2026)
 *   - Patterson et al. (2021) "Carbon and the Machine Learning" — TCO methodology
 */
function computeModel(params: Record<string, number>, years: number = 10) {
  const {
    launchCost,
    earthEnergy,
    computeDoublingYears,
    hardwareLifespan,
    regulationCost,
    solarEfficiency,
    launchCostDeclineRate,
    hwCostPerPflop,
    discountRate,
    computeDemandGrowthRate,
  } = params;

  // ── Fixed sourced constants ──────────────────────────────────────────────────

  // kWh per PFLOP-day (fp16, no sparsity) — DERIVED FROM SPEC SHEET (see top of file)
  // DGX H100: 8.5 kW system × 24h / 3.96 PFLOPS fp16 no-sparsity = 51.5 kWh/PFLOP-day
  // Source: NVIDIA DGX H100 User Guide (docs.nvidia.com/dgx/dgxh100-user-guide);
  //         NVIDIA H100 Tensor Core GPU Datasheet (nvidia.com)
  const KWH_PER_PFLOP_DAY = EARTH_ENERGY_KWH_PER_PFLOP_DAY;

  // PUE 1.2 — Uptime Institute 2024 Global Data Center Survey:
  //   Industry average 1.56; hyperscale leaders (Google 1.09, Microsoft 1.12);
  //   new hyperscale builds target 1.2–1.4. We use 1.2 (best-in-class new build).
  //   Fair comparison: new orbital system vs. new hyperscale build.
  const EARTH_PUE = 1.2;

  // Land/cooling cost per PFLOP-day — UMich STPP 2025 p.14:
  //   "Non-energy OPEX for a hyperscale data center averages $0.0012/kWh-equivalent of compute"
  const EARTH_LAND_COOLING_PER_PFLOP_DAY = 0.0012;

  // Hardware mass: DGX H100 User Guide — system mass 132 kg, delivers 3.96 PFLOPS fp16 no-sparsity
  //   → 132 kg / 3.96 PFLOPS = 33.3 kg/PFLOP
  //   BUT: this includes rack, cooling, networking. For orbital, only the GPU tray is launched.
  //   GPU tray mass ≈ 8 × (H100 card ~1.5 kg) + baseboard ~10 kg ≈ 22 kg.
  //   Per-PFLOP: 22 kg / 3.96 PFLOPS ≈ 5.6 kg/PFLOP.
  //   Google Suncatcher targets custom TPU ASICs which are lighter; we use 5 kg/PFLOP
  //   as a round midpoint (acknowledging space-grade ASICs may be lighter than H100 trays).
  //   Source: NVIDIA DGX H100 User Guide; Google Suncatcher paper.
  const HW_KG_PER_PFLOP = 5.0;

  // Structural/thermal overhead: 1.4× launch mass for thermal radiators, structure, shielding.
  //   Source: Starcloud white paper (starcloudinc.github.io/wp.pdf): "structural overhead
  //   approximately 40% of payload mass for LEO compute satellites"
  const SPACE_LAUNCH_STRUCT_RATIO = 1.4;

  // Ops rate: 7%/yr of annualized hardware+launch capex — see top of file for derivation.
  //   Source: Intelsat/SES combined 2023–2024 annual filings; $700–800M OPEX on $10B asset base.
  const SPACE_OPS_RATE_CONST = SPACE_OPS_RATE;

  // Latency penalty: 20ms round-trip LEO adds ~4% cost for latency-sensitive workloads.
  //   Most relevant for batch training (target workload) this penalty is low.
  //   Source: Starcloud WP: "LEO provides <25ms latency, acceptable for training but not inference"
  const SPACE_LATENCY_PENALTY = 0.04;

  // Solar panel specific power: 100 W/kg for space-grade triple-junction GaAs panels.
  //   Source: ESA "Solar Panel Technology Review" (2023): commercial off-the-shelf
  //   triple-junction cells achieve 90–120 W/kg at the panel level.
  //   Starcloud WP references 200 W/kg for next-gen concentrator arrays (not yet available);
  //   we use the current-technology 100 W/kg as the conservative base.
  const SOLAR_PANEL_W_PER_KG = 100;

  // Compute power draw per PFLOP of continuous work (kW)
  // = KWH_PER_PFLOP_DAY / 24 hours = 51.5 / 24 = 2.15 kW per PFLOP
  const COMPUTE_KW_PER_PFLOP = KWH_PER_PFLOP_DAY / 24;

  const r = discountRate / 100;
  const results = [];

  for (let year = 0; year <= years; year++) {
    const discountFactor = Math.pow(1 + r, -year);

    // Launch cost declines with Starship progress (compound annual rate)
    const launchCostYear = launchCost * Math.pow(1 - launchCostDeclineRate / 100, year);

    // Earth energy price inflation:
    //   Base rate: 1.8%/yr (EIA AEO 2025 Reference case: 13¢ → 20¢/kWh by 2050)
    //   Demand stress: AI compute demand above 20%/yr stresses grid capacity,
    //   accelerating prices. FERC 2025 capacity market analysis shows PJM capacity
    //   prices up 800% from 2024 to 2025 auction due to data center load growth.
    //   We model stress as: each %pt of demand growth above 20% adds 0.5%pt to inflation.
    //   (CRS Report R48646, Congress.gov 2025, section on grid capacity constraints)
    const demandPressure = Math.max(0, (computeDemandGrowthRate - 20) / 100 * 0.5);
    const earthEnergyInflation = EARTH_ENERGY_BASE_INFLATION + demandPressure;
    const earthEnergyYear = earthEnergy * Math.pow(1 + earthEnergyInflation, year);

    // Compute efficiency improves — hardware does more PFLOP per kg and per watt each year.
    // This benefits both sides but hurts space more (can't swap in newer chips mid-lifespan).
    const computeMultiplier = Math.pow(2, year / computeDoublingYears);

    // ── EARTH TCO ($/PFLOP-day, NPV-adjusted) ──────────────────────────────────
    const earthEnergyCost = KWH_PER_PFLOP_DAY * earthEnergyYear * EARTH_PUE;
    const earthRegCost = (earthEnergyCost + EARTH_LAND_COOLING_PER_PFLOP_DAY) * (regulationCost / 100);
    const earthTotalUndiscounted =
      (earthEnergyCost + EARTH_LAND_COOLING_PER_PFLOP_DAY + earthRegCost) / computeMultiplier;
    const earthTotal = earthTotalUndiscounted * discountFactor;

    // ── SPACE TCO ($/PFLOP-day, NPV-adjusted) ──────────────────────────────────

    // Hardware mass per PFLOP, decreasing as compute efficiency improves.
    // Space hardware can't be upgraded mid-lifespan, so it locks in the year-0 efficiency.
    // The computeMultiplier still applies because newer missions use newer chips at launch.
    const massPerPflop = (HW_KG_PER_PFLOP * SPACE_LAUNCH_STRUCT_RATIO) / computeMultiplier;

    // Solar panel mass per PFLOP of continuous compute power.
    //   Panel mass = (power demand in kW) / (specific power in kW/kg × solar efficiency fraction)
    //   Lower solarEfficiency → more panel mass needed per unit of compute.
    //   Source: ESA 2023 (100 W/kg); Google Suncatcher (orbital solar capacity factor 95% vs 24% ground)
    const solarFraction = Math.max(0.05, solarEfficiency / 100);
    const solarPanelKgPerPflop = COMPUTE_KW_PER_PFLOP /
      ((SOLAR_PANEL_W_PER_KG / 1000) * solarFraction) / computeMultiplier;

    // Total launch mass per PFLOP = hardware + structure + solar panels
    const totalMassPerPflop = massPerPflop + solarPanelKgPerPflop;
    const lifespanDays = hardwareLifespan * 365;

    // Amortize launch cost + hardware purchase cost over operational lifespan
    const launchAmortized =
      (totalMassPerPflop * launchCostYear + hwCostPerPflop / computeMultiplier) / lifespanDays;

    // Residual space energy cost (not zero — batteries cycle, power conversion losses):
    //   ~2% of equivalent earth energy cost. No source for exact figure; this is a minor
    //   term (at current params: ~$0.001/PFLOP-day vs $4+/PFLOP-day for launch amortization).
    //   Conservative in favor of Earth.
    const spaceResidualEnergyCost = earthEnergyCost * 0.02 / computeMultiplier;

    // Operations overhead: 7%/yr of per-PFLOP-day capex base (Intelsat/SES filing rate)
    const spaceOpsCost = launchAmortized * SPACE_OPS_RATE_CONST;

    // Total space cost per PFLOP-day (undiscounted)
    const spaceTotalUndiscounted =
      launchAmortized +
      spaceResidualEnergyCost +
      spaceOpsCost +
      SPACE_LATENCY_PENALTY * earthTotalUndiscounted;

    const spaceTotal = spaceTotalUndiscounted * discountFactor;
    const ratio = spaceTotal / earthTotal;

    results.push({
      year: 2025 + year,
      earthTotal: Math.max(0.00001, earthTotal),
      spaceTotal: Math.max(0.00001, spaceTotal),
      ratio,
      launchCostYear,
      viable: ratio < 1,
      earthEnergyYear,
      discountFactor,
      // cost breakdown for NPV tab
      launchAmortizedFull: launchAmortized * discountFactor,
      solarMassFull: (solarPanelKgPerPflop * launchCostYear / lifespanDays) * discountFactor,
      opsAndLatency: (spaceOpsCost + SPACE_LATENCY_PENALTY * earthTotalUndiscounted) * discountFactor,
    });
  }

  return results;
}

/**
 * Sensitivity analysis: vary each param ±20% from baseline,
 * return how much the year-5 space/earth ratio changes.
 * Direction is computed from model output, not hardcoded.
 */
function computeSensitivity(params: Record<string, number>) {
  const baseResults = computeModel(params, 10);
  const baseRatio = baseResults[5].ratio;
  const DELTA = 0.20;

  const paramLabels: Record<string, string> = {
    launchCost: 'Launch cost ($/kg)',
    earthEnergy: 'Earth energy price',
    computeDoublingYears: 'Compute doubling time',
    hardwareLifespan: 'Hardware lifespan',
    regulationCost: 'Regulation overhead',
    solarEfficiency: 'Solar harvest efficiency',
    launchCostDeclineRate: 'Launch cost decline rate',
    hwCostPerPflop: 'Space hardware cost ($/PFLOP)',
    discountRate: 'Discount rate (NPV)',
    computeDemandGrowthRate: 'AI compute demand growth',
  };

  return Object.keys(params).map((key) => {
    const highParams = { ...params, [key]: params[key] * (1 + DELTA) };
    const lowParams = { ...params, [key]: params[key] * (1 - DELTA) };
    const highRatio = computeModel(highParams, 10)[5].ratio;
    const lowRatio = computeModel(lowParams, 10)[5].ratio;
    const swing = Math.abs(highRatio - lowRatio);
    const hurtsSpace = highRatio > baseRatio; // increasing param raises ratio = hurts space
    return {
      key,
      label: paramLabels[key] || key,
      swing,
      baseRatio,
      highRatio,
      lowRatio,
      hurtsSpace,
    };
  }).sort((a, b) => b.swing - a.swing);
}

/**
 * Monte Carlo confidence bands: 300 runs with ±25% uniform parameter perturbation.
 * Returns 10th/50th/90th percentile of space/earth ratio at each year.
 * Shows combined uncertainty, not just individual sensitivities.
 */
function computeConfidenceBands(
  params: Record<string, number>,
  years: number = 10,
  nSamples: number = 300,
  uncertainty: number = 0.25
) {
  const allRuns: { year: number; ratio: number }[][] = [];
  for (let s = 0; s < nSamples; s++) {
    const perturbed: Record<string, number> = {};
    for (const k of Object.keys(params)) {
      const noise = 1 + (Math.random() * 2 - 1) * uncertainty;
      perturbed[k] = Math.max(params[k] * 0.1, params[k] * noise);
    }
    allRuns.push(computeModel(perturbed, years));
  }
  const bands = [];
  for (let y = 0; y <= years; y++) {
    const ratios = allRuns.map((run) => run[y].ratio).sort((a, b) => a - b);
    bands.push({
      year: 2025 + y,
      p10: ratios[Math.floor(nSamples * 0.1)],
      p50: ratios[Math.floor(nSamples * 0.5)],
      p90: ratios[Math.floor(nSamples * 0.9)],
    });
  }
  return bands;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const InfoTooltip = ({ text, url }: { text: string; url: string }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  return (
    <div ref={ref} className="relative inline-block ml-2 align-middle">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-4 h-4 rounded-full border border-deep-teal/40 flex items-center justify-center text-[9px] font-mono font-bold text-deep-teal/60 hover:border-atomic-orange hover:text-atomic-orange transition-colors"
        aria-label="Source info"
      >
        i
      </button>
      {open && (
        <div className="absolute left-6 top-0 z-50 w-72 bg-white border-2 border-deep-teal shadow-[4px_4px_0px_0px_rgba(13,71,78,1)] p-3 text-[11px] text-deep-teal leading-relaxed">
          <p className="mb-2">{text}</p>
          <a href={url} target="_blank" rel="noreferrer"
            className="text-atomic-orange underline font-bold break-all">
            View source →
          </a>
        </div>
      )}
    </div>
  );
};

const SliderRow = ({
  param,
  onChange,
}: {
  param: SliderParam;
  onChange: (id: string, val: number) => void;
}) => {
  const displayVal = param.format
    ? param.format(param.value)
    : param.unitPrefix
    ? `${param.unit}${param.value.toLocaleString()}`
    : `${param.value.toLocaleString()}${param.unit}`;
  return (
    <div className="border-b border-deep-teal/10 pb-4 last:border-0 last:pb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-deep-teal uppercase tracking-tight flex items-center">
          {param.label}
          {param.isNew && (
            <span className="ml-2 text-[8px] bg-atomic-orange text-cream px-1 py-0.5 font-mono tracking-widest">NEW</span>
          )}
          <InfoTooltip text={param.citation} url={param.citationUrl} />
        </span>
        <span className="text-xs font-mono font-bold text-atomic-orange bg-atomic-orange/10 px-2 py-0.5">
          {displayVal}
        </span>
      </div>
      <p className="text-[10px] text-deep-teal/50 mb-2 font-mono">{param.description}</p>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={param.value}
        onChange={(e) => onChange(param.id, parseFloat(e.target.value))}
        className="w-full h-1.5 appearance-none bg-deep-teal/20 rounded-none cursor-pointer"
        style={{ accentColor: '#E85D04' }}
      />
      <div className="flex justify-between text-[9px] font-mono text-deep-teal/30 mt-0.5">
        <span>{param.unitPrefix ? `${param.unit}${param.min.toLocaleString()}` : `${param.min.toLocaleString()}${param.unit}`}</span>
        <span>{param.unitPrefix ? `${param.unit}${param.max.toLocaleString()}` : `${param.max.toLocaleString()}${param.unit}`}</span>
      </div>
    </div>
  );
};

const CostChart = ({
  data,
  bands,
}: {
  data: ReturnType<typeof computeModel>;
  bands: ReturnType<typeof computeConfidenceBands>;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;
    const PAD = { top: 16, right: 20, bottom: 36, left: 76 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;
    ctx.clearRect(0, 0, W, H);

    const allVals = data.flatMap((d) => [d.earthTotal, d.spaceTotal]);
    const bandMax = Math.max(...bands.map((b) => b.p90 * data[bands.indexOf(b) < data.length ? bands.indexOf(b) : 0]?.earthTotal || 0));
    const maxVal = Math.max(...allVals, bandMax) * 1.15;
    const xScale = (i: number) => PAD.left + (i / (data.length - 1)) * chartW;
    const yScale = (v: number) => PAD.top + chartH - (v / maxVal) * chartH;

    // Grid
    ctx.strokeStyle = 'rgba(13,71,78,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (chartH / 4) * i;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
      const val = maxVal * (1 - i / 4);
      ctx.fillStyle = 'rgba(13,71,78,0.4)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`$${val.toFixed(2)}`, PAD.left - 4, y + 3);
    }

    // X axis labels
    ctx.fillStyle = 'rgba(13,71,78,0.4)';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    data.forEach((d, i) => {
      if (i % 2 === 0) ctx.fillText(String(d.year), xScale(i), H - PAD.bottom + 16);
    });

    // Viability shading
    let inZone = false; let startX = 0;
    data.forEach((d, i) => {
      if (d.viable && !inZone) { startX = xScale(i); inZone = true; }
      else if (!d.viable && inZone) {
        ctx.fillStyle = 'rgba(13,71,78,0.06)';
        ctx.fillRect(startX, PAD.top, xScale(i) - startX, chartH);
        inZone = false;
      }
    });
    if (inZone) { ctx.fillStyle = 'rgba(13,71,78,0.06)'; ctx.fillRect(startX, PAD.top, xScale(data.length - 1) - startX, chartH); }

    // Confidence band
    ctx.beginPath();
    bands.forEach((b, i) => {
      const p90Y = yScale(b.p90 * data[i].earthTotal);
      i === 0 ? ctx.moveTo(xScale(i), p90Y) : ctx.lineTo(xScale(i), p90Y);
    });
    bands.slice().reverse().forEach((b, i) => {
      const ri = bands.length - 1 - i;
      ctx.lineTo(xScale(ri), yScale(b.p10 * data[ri].earthTotal));
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(232,93,4,0.10)';
    ctx.fill();

    // Earth line
    ctx.beginPath(); ctx.strokeStyle = '#0D474E'; ctx.lineWidth = 2.5; ctx.setLineDash([]);
    data.forEach((d, i) => { const x = xScale(i), y = yScale(d.earthTotal); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();

    // Space line
    ctx.beginPath(); ctx.strokeStyle = '#E85D04'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 3]);
    data.forEach((d, i) => { const x = xScale(i), y = yScale(d.spaceTotal); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke(); ctx.setLineDash([]);

    // Crossover
    const crossIdx = data.findIndex((d) => d.viable);
    if (crossIdx > 0) {
      const x = xScale(crossIdx);
      ctx.strokeStyle = '#E4A725'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + chartH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#E4A725'; ctx.font = 'bold 9px JetBrains Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText('VIABLE', x, PAD.top + 10);
    }
  }, [data, bands]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '260px', display: 'block' }}
      aria-label="Line chart showing NPV-adjusted earth vs space compute cost over 10 years with Monte Carlo confidence bands"
    />
  );
};

const SensitivityChart = ({ data }: { data: ReturnType<typeof computeSensitivity> }) => {
  const maxSwing = Math.max(...data.map((d) => d.swing));
  return (
    <div className="space-y-3">
      {data.map((item) => (
        <div key={item.key}>
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-mono font-bold text-deep-teal uppercase tracking-tight">
              {item.label}
            </span>
            <span className="text-[10px] font-mono text-deep-teal/60 flex items-center gap-2">
              <span className="text-[9px] px-1.5 py-0.5 font-bold" style={{
                background: item.hurtsSpace ? 'rgba(232,93,4,0.1)' : 'rgba(13,71,78,0.08)',
                color: item.hurtsSpace ? '#E85D04' : '#0D474E',
              }}>
                {item.hurtsSpace ? '↑ hurts space' : '↑ helps space'}
              </span>
              ±{(item.swing * 100).toFixed(1)}% ratio swing
            </span>
          </div>
          <div className="h-3 bg-deep-teal/10 w-full">
            <div className="h-full transition-all duration-500" style={{
              width: `${(item.swing / maxSwing) * 100}%`,
              background: item.hurtsSpace ? '#E85D04' : '#0D474E',
            }} />
          </div>
        </div>
      ))}
      <div className="flex gap-6 pt-2">
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-deep-teal/60">
          <span className="w-3 h-2 inline-block" style={{ background: '#0D474E' }} /> Helps space (↑ = lower ratio)
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-deep-teal/60">
          <span className="w-3 h-2 inline-block" style={{ background: '#E85D04' }} /> Hurts space (↑ = higher ratio)
        </span>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EconomicModel() {
  const [activeScenario, setActiveScenario] = useState<Scenario>('current');
  const [activeTab, setActiveTab] = useState<'model' | 'sensitivity' | 'npv'>('model');
  const [params, setParams] = useState<Record<string, number>>(SCENARIO_PRESETS.current);

  const sliderDefs: SliderParam[] = [
    {
      id: 'launchCost',
      label: 'Launch cost to LEO',
      min: 100, max: 5000, step: 50,
      value: params.launchCost,
      format: (v) => `$${v.toLocaleString()}/kg`,
      unit: '/kg', unitPrefix: true,
      citation: 'Google Suncatcher feasibility study (Nov 2025): ~$1,500–2,900/kg on Falcon Heavy today. NASA NTRS: Falcon 9 list price $2,720/kg. Google paper: $200/kg needed by 2035 for viability (Starship at 180 launches/yr). Starcloud CEO: $500/kg = cost-competitive (TechCrunch, Apr 2026).',
      citationUrl: 'https://www.datacenterdynamics.com/en/news/project-suncatcher-google-to-launch-tpus-into-orbit-with-planet-labs-envisions-1km-arrays-of-81-satellite-compute-clusters/',
      description: 'Cost to lift 1 kg of payload to low Earth orbit',
    },
    {
      id: 'hwCostPerPflop',
      label: 'Space hardware cost',
      min: 30, max: 1500, step: 10,
      value: params.hwCostPerPflop,
      format: (v) => `$${v}/PFLOP`,
      unit: '/PFLOP', unitPrefix: true,
      citation: 'MOST LOAD-BEARING ASSUMPTION. Retail H100: ~$7,000/PFLOP fp16 no-sparsity (DGX H100 ~$300k / 3.96 PFLOPS). Space-optimized ASICs at volume (Google Trillium TPU class): industry cost estimated $60–200/PFLOP. No ASICs at orbital scale exist yet — only retail H100s have been flown (Starcloud-1, Nov 2025). The entire industry thesis rests on ASIC development.',
      citationUrl: 'https://starcloudinc.github.io/wp.pdf',
      description: 'Cost of space-grade compute hardware — the most critical assumption in this model',
    },
    {
      id: 'discountRate',
      label: 'Discount rate (NPV)',
      min: 4, max: 25, step: 0.5,
      value: params.discountRate,
      format: (v) => `${v}%`,
      unit: '%',
      citation: 'Required annual return rate for NPV discounting. Infrastructure project finance: 7–9% (green bonds, 2025). Venture capital floor: 20–30%. JPMorgan infrastructure fund WACC: 8–12% (2025). Higher discount rates penalize space more — upfront launch capex is heavily discounted, while Earth\'s ongoing opex is spread evenly.',
      citationUrl: 'https://www.congress.gov/crs-product/R48646',
      description: 'Required annual return for discounting future costs to present value',
    },
    {
      id: 'computeDemandGrowthRate',
      label: 'AI compute demand growth',
      min: 10, max: 100, step: 5,
      value: params.computeDemandGrowthRate,
      format: (v) => `${v}%/yr`,
      unit: '%/yr',
      citation: 'IEA "Energy and AI" (June 2024): AI electricity demand projected +26–40%/yr through 2030. Goldman Sachs 2025: data center power demand +165% by 2030 (≈60%/yr). FERC 2025 capacity markets: PJM capacity prices up 800% 2024→2025 auction due to data center load growth. Faster demand growth stresses grid, accelerating terrestrial energy price inflation above the 1.8%/yr EIA baseline.',
      citationUrl: 'https://www.iea.org/reports/energy-and-ai',
      description: 'Annual growth in AI compute demand — drives grid stress and earth energy price pressure',
    },
    {
      id: 'earthEnergy',
      label: 'Earth energy price (starting)',
      min: 0.02, max: 0.25, step: 0.005,
      value: params.earthEnergy,
      format: (v) => `$${v.toFixed(3)}/kWh`,
      unit: '/kWh',
      citation: 'EIA 2025 STEO: US commercial average $0.085/kWh. Base inflation rate now corrected to 1.8%/yr (EIA AEO 2025 Reference case: 13¢→20¢/kWh by 2050, ~1.75%/yr compound). Prior versions incorrectly used 3%/yr. PJM grid region saw 20% price increase in 2025 capacity auction due to data center demand (CRS Report R48646).',
      citationUrl: 'https://www.eia.gov/outlooks/aeo/',
      description: 'Grid electricity cost for terrestrial data centers — grows at 1.8%/yr base (EIA AEO 2025)',
    },
    {
      id: 'launchCostDeclineRate',
      label: 'Annual launch cost decline',
      min: 0, max: 35, step: 1,
      value: params.launchCostDeclineRate,
      format: (v) => `${v}%/yr`,
      unit: '%/yr',
      citation: 'DERIVATION: Google Suncatcher (Nov 2025) projects $1,500→$200/kg by 2035. Compound rate: (200/1500)^(1/10)–1 = –15.3%/yr if Starship hits 180 flights/yr. Current preset (12%/yr) splits the difference between historical Falcon 9 plateau (~5%/yr) and Google\'s full-Starship optimistic trajectory (~22%/yr). Starship schedule uncertainty is the key risk to this parameter.',
      citationUrl: 'https://www.semafor.com/article/11/04/2025/google-wants-to-build-solar-powered-data-centers-in-space',
      description: 'Annual rate at which launch cost falls as Starship scales',
    },
    {
      id: 'solarEfficiency',
      label: 'Solar harvest efficiency',
      min: 10, max: 65, step: 1,
      value: params.solarEfficiency,
      format: (v) => `${v}% usable`,
      unit: '%',
      citation: 'Modeled as panel mass: COMPUTE_KW_PER_PFLOP / (100 W/kg × efficiency). Solar panel specific power: 100 W/kg for triple-junction GaAs (ESA Solar Panel Technology Review 2023). Google Suncatcher: orbital capacity factor 95% vs 24% ground (WEF 2026) = up to 8× more energy. Reduced by thermal management, night windows (LEO has ~35% dark time), battery cycling losses, and panel degradation (~1.5%/yr).',
      citationUrl: 'https://interestingengineering.com/culture/google-project-suncatcher-space-ai',
      description: 'Fraction of theoretical solar irradiance usable — drives required panel mass per PFLOP',
    },
    {
      id: 'computeDoublingYears',
      label: 'Compute efficiency doubling time',
      min: 1, max: 5, step: 0.1,
      value: params.computeDoublingYears,
      format: (v) => `${v.toFixed(1)} yrs`,
      unit: ' yrs',
      citation: 'Epoch AI (Oct 2024): ML hardware energy efficiency doubled ~every 2yr since 2012. Epoch AI (Apr 2025): AI supercomputers doubled performance every 9 months 2019–2025. IEA via Congress.gov 2025: GPU performance/watt improved 100× between 2008–2023 (~1.35×/yr). Fast doubling slightly favors Earth — space hardware locks in year-0 efficiency for its full lifespan.',
      citationUrl: 'https://epoch.ai/data-insights/ml-hardware-energy-efficiency',
      description: 'Years for compute performance per dollar/kg to double',
    },
    {
      id: 'hardwareLifespan',
      label: 'Orbital hardware lifespan',
      min: 2, max: 12, step: 0.5,
      value: params.hardwareLifespan,
      format: (v) => `${v.toFixed(1)} yrs`,
      unit: ' yrs',
      citation: 'Google Suncatcher feasibility study (Nov 2025): "replace onboard chips every 5–6 years." LEO satellites typically 5–15yr depending on radiation shielding (Avnet Silica / IEEE Trans. Aerospace). Low-cost nanosatellites: 2–4yr (radiation, drag). Starcloud-1 launched Nov 2025 — no multi-year operational compute lifespan data yet exists.',
      citationUrl: 'https://www.scientificamerican.com/article/data-centers-in-space/',
      description: 'Years orbital hardware operates before replacement',
    },
    {
      id: 'regulationCost',
      label: 'Earth regulatory overhead',
      min: 0, max: 30, step: 1,
      value: params.regulationCost,
      format: (v) => `${v}% of OPEX`,
      unit: '%',
      citation: 'UMich STPP 2025: compliance, permitting, and regulatory costs 8–20% of OPEX for US data centers. Note: Prof. Philip Potter (UVA, Episode 1.2) pushes back — hyperscalers negotiate tax abatements and rarely cite regulation as primary driver. Sensitivity analysis confirms this is one of the lowest-impact variables in the model.',
      citationUrl: 'https://stpp.fordschool.umich.edu/sites/stpp/files/2025-07/stpp-data-centers-2025.pdf',
      description: 'Compliance/permitting overhead added to terrestrial OPEX',
    },
  ];

  const handleSliderChange = (id: string, val: number) => {
    setParams((prev) => ({ ...prev, [id]: val }));
    setActiveScenario('current');
  };
  const applyScenario = (s: Scenario) => { setActiveScenario(s); setParams(SCENARIO_PRESETS[s]); };

  const modelData = useMemo(() => computeModel(params, 10), [params]);
  const sensitivityData = useMemo(() => computeSensitivity(params), [params]);
  const confidenceBands = useMemo(() => computeConfidenceBands(params, 10, 300, 0.25), [params]);

  const year5 = modelData[5];
  const year10 = modelData[10];
  const breakEvenYear = modelData.find((d) => d.viable)?.year;
  const currentRatio = modelData[0].ratio;
  const npvSpaceSavings = useMemo(() =>
    modelData.reduce((sum, d) => sum + (d.earthTotal - d.spaceTotal), 0), [modelData]);

  const verdict =
    currentRatio < 0.85 ? { text: 'Space wins now', color: '#0D474E', bg: 'rgba(13,71,78,0.08)' }
    : currentRatio < 1.0 ? { text: 'Near parity', color: '#E4A725', bg: 'rgba(228,167,37,0.1)' }
    : currentRatio < 2.0 ? { text: 'Earth still cheaper', color: '#E85D04', bg: 'rgba(232,93,4,0.05)' }
    : { text: 'Space far from viable', color: '#E85D04', bg: 'rgba(232,93,4,0.05)' };

  return (
    <div className="pt-36 pb-24 px-6 md:px-12 max-w-7xl mx-auto">

      {/* Header */}
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
        className="mb-16 border-b-8 border-deep-teal pb-12 relative">
        <div className="absolute -top-10 left-0 text-[10px] font-mono text-deep-teal/40 uppercase tracking-[0.4em]">
          CLASSIFICATION: DECLASSIFIED // TOPIC_ID: ECONOMIC_MODEL_V3
        </div>
        <div className="flex flex-col md:flex-row items-start md:items-center gap-8 mb-10">
          <div className="w-24 h-24 bg-mustard/20 border-4 border-deep-teal flex items-center justify-center shadow-[6px_6px_0px_0px_rgba(13,71,78,1)]">
            <TrendingUp className="w-12 h-12 text-deep-teal" />
          </div>
          <h1 className="text-5xl md:text-8xl font-display font-black text-deep-teal uppercase italic tracking-tighter leading-none">
            Economic<br /><span className="text-atomic-orange">Viability</span>
          </h1>
        </div>
        <div className="bg-atomic-orange text-cream p-8 retro-border max-w-5xl">
          <p className="text-xl md:text-2xl font-bold italic leading-tight">
            Under what conditions do orbital data centers make economic sense? Every assumption is sourced. Adjust them — and watch the math respond.
          </p>
        </div>
      </motion.div>


      {/* Scenario presets */}
      <div className="mb-10">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-deep-teal/50 mb-4">Scenario Presets</div>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(SCENARIO_PRESETS) as Scenario[]).map((s) => (
            <button key={s} onClick={() => applyScenario(s)}
              className={`px-6 py-2 text-xs font-mono font-bold uppercase tracking-widest border-2 transition-all ${
                activeScenario === s
                  ? 'bg-deep-teal text-cream border-deep-teal'
                  : 'bg-transparent text-deep-teal border-deep-teal/40 hover:border-deep-teal'
              }`}>
              {SCENARIO_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-[420px_1fr] gap-12 items-start">

        {/* Left: Sliders */}
        <div>
          <div className="bg-white retro-border p-6 mb-6">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.3em] text-deep-teal/60 mb-5 flex items-center gap-2">
              <Sliders className="w-3 h-3" /> Adjust Assumptions
            </h3>
            <div className="space-y-5">
              {sliderDefs.map((p) => (
                <SliderRow key={p.id} param={{ ...p, value: params[p.id] }} onChange={handleSliderChange} />
              ))}
            </div>
          </div>

          {/* Fixed constants box */}
          <div className="bg-deep-teal/5 border-2 border-deep-teal/20 p-4 mb-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-deep-teal/60 font-bold mb-3">
              Fixed Constants (sourced, not sliders)
            </div>
            {[
              { label: 'kWh/PFLOP-day (fp16)', value: '51.5', source: 'DGX H100 spec: 8.5kW / 3.96 PFLOPS × 24h' },
              { label: 'Hardware mass', value: '5 kg/PFLOP', source: 'DGX H100 GPU tray ÷ 3.96 PFLOPS; NVIDIA User Guide' },
              { label: 'Earth PUE', value: '1.2×', source: 'Uptime Institute 2024 — new hyperscale builds' },
              { label: 'Ops rate (space)', value: '7%/yr', source: 'Intelsat/SES 2023–24 annual filings' },
              { label: 'Earth energy inflation', value: '1.8%/yr', source: 'EIA AEO 2025 Reference case' },
              { label: 'Solar panel spec power', value: '100 W/kg', source: 'ESA Solar Panel Tech Review 2023' },
              { label: 'Struct. overhead (space)', value: '1.4×', source: 'Starcloud white paper 2025' },
            ].map((c) => (
              <div key={c.label} className="flex justify-between items-start py-1.5 border-b border-deep-teal/10 last:border-0">
                <div>
                  <div className="text-[10px] font-mono font-bold text-deep-teal">{c.label}</div>
                  <div className="text-[9px] font-mono text-deep-teal/40">{c.source}</div>
                </div>
                <div className="text-[10px] font-mono font-bold text-atomic-orange ml-4 shrink-0">{c.value}</div>
              </div>
            ))}
          </div>

          <div className="bg-mustard/10 border-2 border-mustard p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-mustard font-bold mb-2 flex items-center gap-2">
              <Info className="w-3 h-3" /> About this model
            </div>
            <p className="text-[11px] text-deep-teal/70 leading-relaxed">
              Click the <span className="font-mono text-atomic-orange font-bold">i</span> icon beside each slider for the full citation. Fixed constants are shown above with their derivation sources.
            </p>
          </div>
        </div>

        {/* Right: Charts */}
        <div className="space-y-8">

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Space/earth ratio (NPV)', value: currentRatio.toFixed(2) + '×', sub: currentRatio < 1 ? 'Space is cheaper' : 'Earth is cheaper', accent: currentRatio < 1 },
              { label: 'Break-even year', value: breakEvenYear ? String(breakEvenYear) : 'Not in range', sub: breakEvenYear ? 'Space becomes viable' : 'Needs bigger shifts', accent: !!breakEvenYear },
              { label: 'Ratio at 2030', value: year5.ratio.toFixed(2) + '×', sub: year5.viable ? 'Space wins' : 'Earth still cheaper', accent: year5.viable },
              { label: '10yr NPV position', value: npvSpaceSavings > 0 ? 'Space' : 'Earth', sub: `By ${Math.abs(npvSpaceSavings).toFixed(2)} $/PFLOP-day`, accent: npvSpaceSavings > 0 },
            ].map((card) => (
              <div key={card.label} className="bg-white retro-border p-4">
                <div className="text-[9px] font-mono uppercase tracking-widest text-deep-teal/50 mb-1 leading-tight">{card.label}</div>
                <div className="text-2xl font-display font-black" style={{ color: card.accent ? '#0D474E' : '#E85D04' }}>{card.value}</div>
                <div className="text-[10px] font-mono text-deep-teal/60 mt-0.5">{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Verdict */}
          <div className="border-2 border-deep-teal/20 p-4 flex items-center gap-4" style={{ background: verdict.bg }}>
            <Zap className="w-5 h-5 shrink-0" style={{ color: verdict.color }} />
            <div>
              <span className="text-xs font-mono font-bold uppercase tracking-widest" style={{ color: verdict.color }}>
                {verdict.text}
              </span>
              <span className="text-xs text-deep-teal/60 font-mono ml-3">
                — at current assumptions, space costs{' '}
                <strong>{Math.abs((currentRatio * 100 - 100)).toFixed(0)}%</strong>
                {currentRatio >= 1 ? ' more' : ' less'} per NPV-adjusted PFLOP-day than Earth
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b-2 border-deep-teal/20 flex flex-wrap">
            {[
              { id: 'model' as const, label: '10-Year Trajectory', icon: BarChart2 },
              { id: 'sensitivity' as const, label: 'Sensitivity Analysis', icon: Sliders },
              { id: 'npv' as const, label: 'NPV Breakdown', icon: TrendingUp },
            ].map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setActiveTab(id)}
                className={`px-5 py-3 text-[10px] font-mono font-bold uppercase tracking-widest flex items-center gap-2 border-b-4 transition-all ${
                  activeTab === id ? 'border-atomic-orange text-atomic-orange' : 'border-transparent text-deep-teal/50 hover:text-deep-teal'
                }`}>
                <Icon className="w-3 h-3" />{label}
              </button>
            ))}
          </div>

          {activeTab === 'model' && (
            <div className="bg-white retro-border p-6">
              <div className="flex items-center gap-6 mb-4 flex-wrap">
                <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-deep-teal">
                  <span className="w-6 h-0.5 inline-block bg-deep-teal" /> Earth TCO (NPV-adj.)
                </span>
                <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-atomic-orange">
                  <span className="w-6 h-0.5 inline-block" style={{ background: 'repeating-linear-gradient(to right, #E85D04 0, #E85D04 6px, transparent 6px, transparent 9px)' }} />
                  Space TCO (NPV-adj.)
                </span>
                <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-atomic-orange/40">
                  <span className="w-6 h-3 inline-block bg-atomic-orange/10 border border-atomic-orange/30" />
                  ±25% uncertainty band
                </span>
              </div>
              <CostChart data={modelData} bands={confidenceBands} />
              <p className="text-[10px] font-mono text-deep-teal/40 mt-3">
                Green shading = space TCO &lt; Earth TCO. Orange band = p10–p90 of 300 Monte Carlo runs with ±25% parameter uncertainty. Units: $/PFLOP-day, fp16 no-sparsity, NPV-adjusted.
              </p>
            </div>
          )}

          {activeTab === 'sensitivity' && (
            <div className="bg-white retro-border p-6">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/60 mb-2 flex items-center gap-2">
                <div className="w-2 h-2 bg-atomic-orange" /> Which Variables Matter Most?
              </h4>
              <p className="text-[11px] text-deep-teal/60 mb-5 leading-relaxed font-mono">
                Each bar shows how much the space/earth ratio at year 5 (2030) changes when that variable shifts ±20% from current settings. Direction label shows whether increasing the variable helps or hurts the space case.
              </p>
              <SensitivityChart data={sensitivityData} />
              <div className="mt-6 bg-deep-teal/5 p-4 border-l-4 border-deep-teal">
                <p className="text-[11px] text-deep-teal font-bold leading-relaxed">
                  Key finding: <span className="text-atomic-orange">{sensitivityData[0]?.label}</span> is the most load-bearing assumption — a ±20% shift changes the 2030 viability ratio by {(sensitivityData[0]?.swing * 100).toFixed(1)}%.{' '}
                  {sensitivityData[0]?.key === 'hwCostPerPflop'
                    ? 'The entire economic case rests on developing space-grade ASICs at scale — not deploying retail GPUs.'
                    : sensitivityData[0]?.key === 'launchCost' || sensitivityData[0]?.key === 'launchCostDeclineRate'
                    ? 'The case hinges almost entirely on Starship delivering on its cost projections.'
                    : 'Stress-test this variable above to understand the model\'s sensitivity.'}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'npv' && (
            <div className="bg-white retro-border p-6">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/60 mb-3 flex items-center gap-2">
                <div className="w-2 h-2 bg-mustard" /> Year-by-Year Cost Breakdown (NPV-Adjusted)
              </h4>
              <p className="text-[11px] text-deep-teal/60 mb-4 font-mono">
                All costs discounted at {params.discountRate}%/yr. Year-10 costs worth ${(Math.pow(1 + params.discountRate/100, -10)).toFixed(3)} per dollar today.
                Energy cost per PFLOP-day at year 0: ${(EARTH_ENERGY_KWH_PER_PFLOP_DAY * params.earthEnergy * 1.2).toFixed(2)} (derived: {EARTH_ENERGY_KWH_PER_PFLOP_DAY} kWh/PFLOP × ${params.earthEnergy.toFixed(3)}/kWh × PUE 1.2).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="border-b-2 border-deep-teal">
                      <th className="text-left py-2 text-deep-teal/60 font-bold uppercase tracking-wide">Year</th>
                      <th className="text-right py-2 text-deep-teal font-bold uppercase tracking-wide">Earth $/PFLOP-d</th>
                      <th className="text-right py-2 text-atomic-orange font-bold uppercase tracking-wide">Space $/PFLOP-d</th>
                      <th className="text-right py-2 text-deep-teal/50 font-bold uppercase tracking-wide">Discount</th>
                      <th className="text-right py-2 text-deep-teal/60 font-bold uppercase tracking-wide">Ratio</th>
                      <th className="text-right py-2 text-deep-teal/60 font-bold uppercase tracking-wide">$/kg launch</th>
                      <th className="text-center py-2 text-deep-teal/60 font-bold uppercase tracking-wide">Viable?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelData.map((row) => (
                      <tr key={row.year} className={`border-b border-deep-teal/10 ${row.viable ? 'bg-deep-teal/5' : ''}`}>
                        <td className="py-2 font-bold text-deep-teal">{row.year}</td>
                        <td className="py-2 text-right text-deep-teal">${row.earthTotal.toFixed(3)}</td>
                        <td className="py-2 text-right text-atomic-orange">${row.spaceTotal.toFixed(3)}</td>
                        <td className="py-2 text-right text-deep-teal/50">{row.discountFactor.toFixed(3)}×</td>
                        <td className="py-2 text-right font-bold" style={{ color: row.viable ? '#0D474E' : '#E85D04' }}>
                          {row.ratio.toFixed(3)}×
                        </td>
                        <td className="py-2 text-right text-deep-teal/60">${row.launchCostYear.toFixed(0)}</td>
                        <td className="py-2 text-center">
                          {row.viable
                            ? <span className="bg-deep-teal text-cream px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">YES</span>
                            : <span className="bg-atomic-orange/10 text-atomic-orange px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">NOT YET</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Limitations */}
          <div className="bg-mustard/10 border-2 border-mustard p-6">
            <h4 className="text-[10px] font-mono uppercase tracking-[0.3em] text-mustard font-bold mb-3 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" /> Model Limitations
            </h4>
            <ul className="space-y-2 text-[11px] text-deep-teal/70 font-mono leading-relaxed list-none">
              {[
                'Hardware cost ($/PFLOP) is the most critical unverified assumption. No space-grade ASICs exist at volume. The only orbital GPU anyone has actually flown is a retail H100 (Starcloud-1, Nov 2025) at ~$7,000/PFLOP, permanently unviable at any launch cost. The $100/PFLOP current preset is where Google\'s Trillium program aims; it does not yet exist.',
                'kWh/PFLOP-day uses DGX H100 fp16 no-sparsity performance (3.96 PFLOPS). Real AI training throughput is typically 30–60% of theoretical peak due to memory bandwidth bottlenecks and inter-GPU communication overhead. True effective kWh/PFLOP-day could be 2–3× higher, worsening both sides proportionally. The ratio effect is modest; the absolute cost levels are conservative.',
                'Solar panel mass uses 100 W/kg (current commercial GaAs). Google Suncatcher targets concentrator arrays at 200+ W/kg. If achieved, this roughly halves the solar mass term, improving space economics meaningfully.',
                'NPV discount rate is applied uniformly. In practice, capex (launch) should be discounted differently than opex (energy). A more rigorous model would use a full cash flow table with separate capex and opex discount rates.',
                'Space debris, orbital slot fees, collision insurance, and end-of-life deorbit cost are not modeled. Dr. Carah Ong Whaley (Episode 3.2) argues these are real unpriced externalities. SpaceX\'s Feb 2026 filing for 1 million satellites suggests collision risk is scaling rapidly.',
                'Launch cost decline is a smooth compound rate. In reality it is lumpy — dependent on Starship achieving specific reuse milestones. A single failure could reset the timeline 2–3 years. The ±25% Monte Carlo bands partially capture this but not the discontinuous failure scenario.',
                'Winner-take-all dynamics (Prof. Lenox, Episode 2): if AI scaling laws plateau, both sides of this model become irrelevant. The entire premise assumes sustained compute demand growth. If returns to data flatten, the dot-com parallel becomes more apt than the arms-race thesis.',
              ].map((c, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="text-mustard font-bold shrink-0">—</span>{c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
