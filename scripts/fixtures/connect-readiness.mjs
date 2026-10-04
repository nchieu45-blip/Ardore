// Route tests isolate provider readiness; verify-connect-readiness.mjs exercises
// the actual Stripe/database ownership, eligibility, and mode checks.
export class SyntheticConnectReadinessError extends Error {
  constructor(code, status = 409) {
    super('Dieser Coach kann momentan keine Zahlungen annehmen.')
    this.code = code
    this.status = status
  }
}

export function connectReadinessFixture({ failure = null, accountId = 'acct_syntheticReady', onCheck = () => {} } = {}) {
  return {
    ConnectReadinessError: SyntheticConnectReadinessError,
    configuredStripeLivemode: () => false,
    async requirePublishedCoach() {},
    async requirePayoutReadyCoach(service, creatorId) {
      onCheck(service, creatorId)
      if (failure) throw new SyntheticConnectReadinessError(failure.code, failure.status)
      return { creatorId, accountId, livemode: false, ready: true }
    },
  }
}
