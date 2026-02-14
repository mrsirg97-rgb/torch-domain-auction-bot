"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanForLendingMarkets = void 0;
const torchsdk_1 = require("torchsdk");
const MAX_PRICE_HISTORY = 50;
/**
 * Probe token holders for active loan positions.
 * Returns addresses that have an active loan on this token.
 */
const discoverBorrowers = async (connection, mint, log) => {
    const borrowers = [];
    try {
        const { holders } = await (0, torchsdk_1.getHolders)(connection, mint, 20);
        for (const holder of holders) {
            try {
                const pos = await (0, torchsdk_1.getLoanPosition)(connection, mint, holder.address);
                if (pos.health !== 'none') {
                    borrowers.push(holder.address);
                }
            }
            catch {
                // skip — holder may not have a loan
            }
        }
    }
    catch (err) {
        log.debug(`borrower discovery failed for ${mint.slice(0, 8)}...: ${err}`);
    }
    return borrowers;
};
/**
 * Scan for tokens with active lending markets.
 * Discovers migrated tokens, builds MonitoredToken entries, and probes for borrowers.
 */
const scanForLendingMarkets = async (connection, existing, depth, log) => {
    const tokens = new Map(existing);
    log.info(`scanning for lending markets (depth=${depth})`);
    try {
        const result = await (0, torchsdk_1.getTokens)(connection, {
            status: 'migrated',
            limit: depth,
            sort: 'newest',
        });
        log.info(`found ${result.tokens.length} migrated tokens`);
        for (const summary of result.tokens) {
            try {
                // skip if recently scanned
                const prev = tokens.get(summary.mint);
                if (prev && Date.now() - prev.lastScanned < 30000)
                    continue;
                const detail = await (0, torchsdk_1.getToken)(connection, summary.mint);
                const lending = await (0, torchsdk_1.getLendingInfo)(connection, summary.mint);
                const priceSol = detail.price_sol / torchsdk_1.LAMPORTS_PER_SOL;
                const prevHistory = prev?.priceHistory ?? [];
                const trimmedHistory = [...prevHistory, priceSol].slice(-MAX_PRICE_HISTORY);
                // discover borrowers when there are active loans
                let borrowers = prev?.activeBorrowers ?? [];
                if (lending.active_loans && lending.active_loans > 0) {
                    borrowers = await discoverBorrowers(connection, summary.mint, log);
                    log.info(`${detail.symbol}: ${lending.active_loans} active loans, ${borrowers.length} borrowers found, price=${priceSol.toFixed(8)} SOL`);
                }
                tokens.set(summary.mint, {
                    mint: summary.mint,
                    name: detail.name,
                    symbol: detail.symbol,
                    lendingInfo: lending,
                    priceSol,
                    priceHistory: trimmedHistory,
                    activeBorrowers: borrowers,
                    lastScanned: Date.now(),
                });
            }
            catch (err) {
                log.debug(`skipping ${summary.mint}: ${err}`);
            }
        }
    }
    catch (err) {
        log.error('scan failed', err);
    }
    return tokens;
};
exports.scanForLendingMarkets = scanForLendingMarkets;
//# sourceMappingURL=scanner.js.map