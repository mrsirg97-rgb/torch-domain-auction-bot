import type { LoanPositionInfo } from 'torchsdk'
import type { MonitoredToken, WalletProfile, ScoredLoan, RiskFactors } from './types'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

const WEIGHTS = {
  ltvProximity: 0.35,
  priceMomentum: 0.25,
  walletRisk: 0.2,
  interestBurden: 0.2,
}

const computeLtvProximity = (position: LoanPositionInfo, token: MonitoredToken): number => {
  const currentLtv = position.current_ltv_bps ?? 0
  const threshold = token.lendingInfo.liquidation_threshold_bps
  if (threshold === 0) return 0

  // how close is current LTV to liquidation threshold (0-100)
  const proximity = (currentLtv / threshold) * 100
  return Math.min(proximity, 100)
}

const computePriceMomentum = (token: MonitoredToken): number => {
  const history = token.priceHistory
  if (history.length < 2) return 50 // neutral

  const recent = history[history.length - 1]
  const older = history[0]
  if (older === 0) return 50

  // price drop = higher risk
  const change = (recent - older) / older
  // map -50% to 100 risk, +50% to 0 risk
  const momentum = 50 - change * 100
  return Math.min(Math.max(momentum, 0), 100)
}

const computeInterestBurden = (position: LoanPositionInfo): number => {
  if (position.borrowed_amount === 0) return 0

  const interestRatio = position.accrued_interest / position.borrowed_amount
  // 10% interest = 50 risk, 20% = 100 risk
  return Math.min(interestRatio * 500, 100)
}

const estimateProfit = (position: LoanPositionInfo, token: MonitoredToken): number => {
  const bonus = token.lendingInfo.liquidation_bonus_bps / 10000
  // use SDK value if available, otherwise estimate from collateral amount * token price
  const collateralValue =
    position.collateral_value_sol ?? position.collateral_amount * token.priceSol
  const profitSol = collateralValue * bonus
  return Math.floor(profitSol * LAMPORTS_PER_SOL)
}

/**
 * Score a loan position for liquidation risk and profitability.
 * Returns a ScoredLoan with risk score (0-100) and factor breakdown.
 */
export const scoreLoan = (
  token: MonitoredToken,
  borrower: string,
  position: LoanPositionInfo,
  profile: WalletProfile,
): ScoredLoan => {
  const factors: RiskFactors = {
    ltvProximity: Math.round(computeLtvProximity(position, token)),
    priceMomentum: Math.round(computePriceMomentum(token)),
    walletRisk: profile.riskScore,
    interestBurden: Math.round(computeInterestBurden(position)),
  }

  const riskScore = Math.round(
    factors.ltvProximity * WEIGHTS.ltvProximity +
      factors.priceMomentum * WEIGHTS.priceMomentum +
      factors.walletRisk * WEIGHTS.walletRisk +
      factors.interestBurden * WEIGHTS.interestBurden,
  )

  return {
    mint: token.mint,
    tokenName: token.name,
    borrower,
    position,
    walletProfile: profile,
    riskScore: Math.min(Math.max(riskScore, 0), 100),
    factors,
    estimatedProfitLamports: estimateProfit(position, token),
    lastScored: Date.now(),
  }
}
