# National power research: summary and source check

Date: 2026-11-08.

- **Source:** a Perplexity deep-research report commissioned by the owner, with evidence cutoff
  2026-11-08. The owner shared it in the orchestrator session.
- **This file:** a condensed record of what the World Board spec relies on, plus an independent
  check of its citations.
- **Owner's request:** ground a Civ-like globe in academic work on what national "HP" and power
  are made of, and how they add up.

## Main conclusions

- **Keep these separate:**
  - capacity;
  - current functioning ("HP");
  - resilience (to a named shock);
  - influence;
  - exposure and dependence;
  - stakes;
  - trajectory.

  A country can be strong, failing and exposed at once.
- **The literature's main lessons:**
  - Barnett and Duvall (2005), Baldwin (2016) and Nye (2017): power has several forms and only
    makes sense in context.
  - Beckley (2018): gross size misleads.
  - Hanson and Sigman (2021): state capacity has several dimensions.
  - Biddle (2004): inventories are not effectiveness.
  - Keohane and Nye: sensitivity is not the same as vulnerability.
  - Farrell and Newman (2019): control of network hubs gives leverage.
  - OECD fragility work: fragility is exposure to risk combined with too little resilience.
  - OECD/JRC composite-indicator handbook: weighting and aggregation are modelling choices that
    must be transparent.
- **References, not models to copy:** the Lowy Asia Power Index (resources versus relationships)
  and Correlates of War CINC (six material inputs, now dated).
- **Twelve Strength domains:**
  - productive economy;
  - fiscal and financial capacity;
  - government and institutions;
  - people and human capital;
  - society and legitimacy;
  - military and security;
  - energy;
  - food, water and environment;
  - infrastructure and logistics;
  - technology and information;
  - diplomacy and external access;
  - cultural and narrative influence.

  Geography is a cross-cutting constraint, not a bar. Nuclear capability is a separate strategic
  layer, never added into a total.
- **HP means national functioning:** whether essential systems work now. It has six bars:
  governing continuity, security and control, essential services, household security, fiscal and
  payment continuity, and societal cooperation. Each bar shows adequacy, change and who is
  affected. HP does not measure size.
- **Resilience is per hazard:** buffers, redundancy, substitutability, adaptation time,
  implementation, recovery and protection of the vulnerable. "Energy disruption resilience" is
  meaningful; "Resilience: 82" is not.
- **Dependencies are directed graph records, and every one carries its denominator.** There are
  four mechanisms: supply, demand, transit and system. The first-pass exposure is
  E = (import share of use) × (partner share of imports). This is not vulnerability, which also
  needs alternatives, cost, buffers and time.
- **The buffer runway** is accessible inventory ÷ (consumption − remaining supply). It applies only
  when the units match and the inputs are known; otherwise it shows "unknown".
- **Stakes** record actor, issue, objective, importance, horizon, commitments, constraints,
  alternatives, evidence status and internal disagreement. The labels are: declared, documented,
  behaviour consistent with it, analyst hypothesis, contested.
- **Alliances are conditional.** An ally's strength is never added to a country's own.
- **One total number is possible only as an explicit, optional overview.** The order of
  construction is: raw observations, then indicators, then domain measures, then scenario
  assessments, then an optional overview. Normalise with fixed, versioned anchors. Declare each
  indicator's role, to avoid double counting. Prefer separate bars plus critical-threshold flags
  over averages.
- **News updates evidence and statuses, never scores directly.** The model has three layers:
  structural baseline, current conditions, and forecasts or scenarios. Events have stages
  (announced → implemented → observed → reversed). Repeated reporting of one event is
  deduplicated, and news volume does not measure damage.
- **Uncertainty is information.** "Unknown" is a valid result. Every observation keeps its period,
  publication date, retrieval date and version.
- **Suggested first release:** separate panels for capacity, functioning and exposure; a small
  documented indicator set; a few dependencies; structured events; one disruption scenario
  (shipping); and no general power index.
- **Ten fixed rules.** The spec adopts all of them; see its section 3.

## Citation check (2026-11-08)

A sub-agent checked the key citations and data sources against primary pages and search results.

**Result: nothing fabricated.** Every cited work, dataset and organisation exists, and the core
claims hold.

**Corrections and limits:**

- The correspondence on Beckley's measure (Pomeroy) is in *International Security* 44(1), 2019,
  not in the same issue as the 2018 article.
- The IEA critical-minerals percentages have not been checked against the report itself.
- The Lowy Asia Power Index has no stated reuse licence and no bulk download. Use it as a design
  reference only.
- The UCDP API has needed an access token since February 2026.
- UN Comtrade's free tier needs a key for useful limits. Published figures vary.
- The IMF PortWatch refresh lag and the IMF reuse terms are still unchecked.

**Confirmed data facts:**

- **World Bank Indicators API:** keyless. It carries `EG.IMP.CONS.ZS` and `MS.MIL.XPND.CD`.
- **WGI:** revised December 2025, with 0–100 scores back-cast to 1996, licensed CC BY 4.0.
- **IMF PortWatch:** daily transit calls and estimated trade volume for 28 chokepoints, served by a
  public ArcGIS FeatureServer.
- **Natural Earth:** public domain, with about 31 point-of-view variants for disputed borders.
- **OECD States of Fragility 2025:** 56 indicators across six dimensions.
- **Hanson and Sigman:** dataset v1 covers 177 countries, 1960–2015.
- **Correlates of War NMC v7:** data to 2022.

## Key references

- Barnett and Duvall, "Power in International Politics", *International Organization* 59 (2005).
- Baldwin, *Power and International Relations* (Princeton, 2016).
- Beckley, "The Power of Nations", *International Security* 43(2) (2018); Pomeroy, correspondence,
  *International Security* 44(1) (2019).
- Hanson and Sigman, "Leviathan's Latent Dimensions", *Journal of Politics* 83(4) (2021).
- Farrell and Newman, "Weaponized Interdependence", *International Security* 44(1) (2019).
- Biddle, *Military Power* (Princeton, 2004).
- OECD, *States of Fragility 2025*.
- OECD/JRC, *Handbook on Constructing Composite Indicators* (2008).
- Lowy Institute, Asia Power Index 2025 methodology.
- World Bank, Logistics Performance Indicators 2.0; Worldwide Governance Indicators 2025 revision.
- IEA, *Global Critical Minerals Outlook 2026*.
