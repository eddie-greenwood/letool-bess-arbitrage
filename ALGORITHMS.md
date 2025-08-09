# Lé Tool - Algorithms & Methodology

## Overview

Lé Tool is a Battery Energy Storage System (BESS) arbitrage optimiser for the Australian National Electricity Market (NEM). It provides two complementary optimisation approaches with proper handling of market rules and engineering constraints.

## Core Algorithms

### 1. Dynamic Programming (DP) Optimiser

The DP optimiser uses value function iteration with backward induction to find the globally optimal trading strategy for a single day.

#### State Space & Complexity
- **Primary state**: State of Charge (SoC) discretised to ~201 levels (0.5% resolution)
- **Complexity**: O(S × T × A) where S=states, T=288 time intervals, A=actions
- **Runtime**: <1 second for daily optimisation on modern hardware

#### Key Features:
- **Value Function**: V(s,t) = max value achievable from state s at time t
- **Backward Induction**: Solves from terminal time backward
- **Cyclic Boundary**: Terminal SoC penalty to encourage return to initial state
- **Throughput Cost**: Degradation penalty ($/MWh) on battery throughput

#### Reservation Prices
Computed from value function gradients:
- **Charge threshold** at SoC s: `(V(s) - V(s+Δs)) / (η_ch × ΔE)`
- **Discharge threshold** at SoC s: `(V(s-Δs) - V(s)) × η_dis / ΔE`

#### Limitations:
- **Minimum run constraints**: Not enforced in current state-only formulation
  - Fix: Augment state to (soc, mode, dwell_time) or apply post-processing
- **Single efficiency**: Currently uses √η split; should allow η_ch ≠ η_dis

### 2. Heuristic Optimiser

Fast greedy algorithm for quick estimates and feasibility studies.

#### Algorithm:
1. **Identify opportunities**: Find all charge/discharge window pairs
2. **Rank by profit**: Sort by energy-weighted spread
3. **Select non-overlapping**: Pick best opportunities up to cycle limit
4. **Forward simulate**: Verify feasibility with SoC/power constraints

#### Limitations:
- May violate constraints when opportunities stack
- Requires post-simulation feasibility check

## Market & Engineering Constraints

### Power & Energy
- **SoC update**: `SoC_{t+1} = SoC_t + η_ch × P_ch × Δt - P_dis × Δt / η_dis`
- **Power limits**: -P_max ≤ P_t ≤ P_max (no simultaneous charge/discharge)
- **SoC bounds**: 0 ≤ SoC_t ≤ Capacity
- **Time step**: Δt = 5/60 hours (5-minute NEM dispatch interval)

### Efficiency Model
- **Round-trip efficiency**: η_rt = η_ch × η_dis
- **Current implementation**: η_ch = η_dis = √η_rt
- **Recommended**: Separate charge/discharge efficiencies

### Price Data
- **Source**: AEMO NEMWeb 5-minute dispatch prices (RRP)
- **Default**: Raw prices (captures full volatility)
- **Optional**: Winsorised mode for risk management (99.5th percentile)

### Minimum Run Constraints
- **Requirement**: 15-minute minimum operation (3 consecutive intervals)
- **Implementation options**:
  1. Augmented DP state (recommended but complex)
  2. Post-processing merge (current approach)

## Network Tariffs

### Site Configuration
- **Front-of-meter (FoM)**: Settles at RRP only
- **Behind-the-meter (BtM)**: Includes network charges

### Time-of-Use Structure
- **Solar soak**: 10am-3pm (typically negative or low rates)
- **Peak**: 3pm-9pm (highest rates)
- **Off-peak**: 9pm-10am (moderate rates)

### Demand Charges
- **Calculation**: Monthly peak kVA (not daily pro-rata)
- **Single-day proxy**: Nominated headroom + shadow price for exceedance

## Performance Metrics

### Revenue Calculation
```
Net Revenue = Wholesale Revenue - Network Charges - Standing Charges - Demand Charges
```

### Realised Spread
```
Realised Spread = (Σ Discharge Revenue - Σ Charge Cost) / Σ Discharged MWh
```

### Cycle Counting
```
Cycles = Total Throughput / (2 × Capacity)
```

## Validation Tests

1. **Cyclic operation**: End SoC ≈ Start SoC (within tolerance)
2. **Monotone cycles**: Throughput penalty ↑ → Cycles ↓
3. **Constraint satisfaction**: No SoC violations, power limits respected
4. **FoM/BtM consistency**: Network charges only affect BtM mode

## Implementation Notes

### Numerical Stability
- Fixed-point arithmetic for SoC calculations
- Careful handling of efficiency chains
- Bounds checking on all operations

### Throughput Cost Calibration
- Bisection search to achieve target cycles
- Assumes monotonicity (generally holds)
- Fallback to grid search if non-monotonic

## Future Enhancements

### Near-term
1. **Augmented DP state** for minimum run enforcement
2. **Separate η_ch, η_dis** with temperature dependence
3. **Ramp rate constraints**: |P_t - P_{t-1}| ≤ ramp_rate × Δt
4. **MLF incorporation** for transmission losses

### Medium-term
1. **FCAS co-optimisation** (not just post-hoc revenue)
2. **Multi-day optimisation** with rolling horizon
3. **Stochastic DP** for price uncertainty
4. **Network constraint awareness**

### Long-term
1. **Portfolio optimisation** across multiple assets
2. **Virtual Power Plant (VPP) coordination**
3. **Derivative hedging integration**
4. **Machine learning price forecasts**

## Technical References

- Bertsekas, D. (2017). *Dynamic Programming and Optimal Control*
- AEMO (2024). *NEM Dispatch and Pricing*
- AusNet Services (2024). *Network Tariff Structure Statement*

---

**Note**: This document reflects the current implementation status. Features marked as "limitations" or "future enhancements" are documented for transparency and roadmap planning.