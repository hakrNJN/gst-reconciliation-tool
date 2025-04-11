// src/core/reconciliation/reconciliation.service.ts
import 'reflect-metadata'; // DI requirement
import { container, inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import config from '../../config';
import { LOGGER_TOKEN } from '../../infrastructure/logger';
import { InternalInvoiceRecord, ReconciliationMatch, ReconciliationMismatch, ReconciliationPotentialMatch, ReconciliationResults } from '../common/interfaces/models';

import { IValidationService, ValidationService } from '../validation';
import { IReconciliationService, ReconciliationOptions } from './interfaces/services';
import { checkInvoiceSimilarity } from './normalization.utils';

// Small epsilon for comparing floating point numbers for "perfect" match
const FLOAT_EPSILON = 0.001;

@singleton()
@injectable()
export class ReconciliationService implements IReconciliationService {

    constructor(
        @inject(LOGGER_TOKEN) private logger: Logger,
        @inject(ValidationService) private validationService: IValidationService
    ) {
        this.logger.info('ReconciliationService initialized.');
    }

    /**
     * Performs reconciliation between local purchase data and portal data.
     */
    async reconcile(
        localData: InternalInvoiceRecord[],
        portalData: InternalInvoiceRecord[],
        options?: ReconciliationOptions // Options currently not used, but available for future extension
    ): Promise<ReconciliationResults> {

        // --- Determine effective tolerances and date strategy ---
        const effectiveToleranceAmount = options?.toleranceAmount ?? config.reconciliation.toleranceAmount;
        const effectiveToleranceTax = options?.toleranceTax ?? config.reconciliation.toleranceTax;
        const effectiveDateStrategy = options?.dateMatchStrategy ?? 'month'; // Default to 'month'
        const reconciliationScope = options?.reconciliationScope ?? 'all'; // Default to all

        this.logger.info(`Starting reconciliation. Scope: ${reconciliationScope}, Local: ${localData.length}, Portal: ${portalData.length}`);
        this.logger.info(`Using Tolerances: Amount=±<span class="math-inline">\{effectiveToleranceAmount\}, Tax\=±</span>{effectiveToleranceTax}`);
        this.logger.info(`Using Date Match Strategy: ${effectiveDateStrategy}`);

        // --- Filter Data Based on Scope ---
        const filterByScope = (record: InternalInvoiceRecord) => {
            if (reconciliationScope === 'all') return true;
            if (reconciliationScope === 'b2b') return record.documentType === 'INV'; // Assuming 'INV' for B2B
            if (reconciliationScope === 'cdnr') return record.documentType === 'C' || record.documentType === 'D';
            return false;
        };
        const filteredLocalData = localData.filter(filterByScope);
        const filteredPortalData = portalData.filter(filterByScope);
        this.logger.info(`Filtered records for scope "${reconciliationScope}". Local: ${filteredLocalData.length}, Portal: ${filteredPortalData.length}`);
        // --- End Filter ---
        // Initialize results
        const results: ReconciliationResults = {
            summary: {
                totalLocalRecords: filteredLocalData.length,
                totalPortalRecords: filteredPortalData.length,
                perfectlyMatchedCount: 0,
                toleranceMatchedCount: 0,
                mismatchedAmountsCount: 0,
                potentialMatchCount: 0,
                missingInPortalCount: 0,
                missingInLocalCount: 0,
                totalSuppliersLocal: 0,
                totalSuppliersPortal: 0,
                reconciliationTimestamp: new Date()
            },
            details: new Map<string, {
                supplierName?: string;
                matches: ReconciliationMatch[];
                missingInPortal: InternalInvoiceRecord[];
                missingInLocal: InternalInvoiceRecord[];
                mismatchedAmounts: ReconciliationMismatch[];
                potentialMatches: ReconciliationPotentialMatch[];
            }>()
        };

        const matchedLocalRecordIds = new Set<string>();
        const matchedPortalRecordIds = new Set<string>();
        const localMapBySupplier = this.groupDataBySupplier(localData);
        const portalMapBySupplier = this.groupDataBySupplier(portalData);
        const uniqueSuppliers = new Set([...localMapBySupplier.keys(), ...portalMapBySupplier.keys()]);
        results.summary.totalSuppliersLocal = localMapBySupplier.size;
        results.summary.totalSuppliersPortal = portalMapBySupplier.size;
        this.logger.info(`Processing ${uniqueSuppliers.size} unique suppliers.`);


        // ---Main Reconciliation Loop,Iterate through each supplier---
        this.logger.info('Starting Pass 1: Exact Invoice Number Matches...');
        for (const supplierGstin of uniqueSuppliers) {
            const supplierLocalInvoices = localMapBySupplier.get(supplierGstin) || [];
            const supplierPortalInvoices = portalMapBySupplier.get(supplierGstin) || [];

            // Initialize result entry if not already present (might be empty supplier list)
            if (!results.details.has(supplierGstin)) {
                const supplierName = supplierLocalInvoices[0]?.supplierName ?? supplierPortalInvoices[0]?.supplierName;
                results.details.set(supplierGstin, { supplierName: supplierName, matches: [], missingInPortal: [], missingInLocal: [], mismatchedAmounts: [], potentialMatches: [] });
            }
            const supplierResults = results.details.get(supplierGstin)!;
            for (const localInv of supplierLocalInvoices) {
                if (matchedLocalRecordIds.has(localInv.id)) continue; // Skip if already handled
                for (const portalInv of supplierPortalInvoices) {
                    if (matchedPortalRecordIds.has(portalInv.id)) continue; // Skip if already handled

                    // --- Check Date (Rule B) ---
                    let isDateMatch = false;
                    if (effectiveDateStrategy === 'fy') {
                        isDateMatch = !!localInv.financialYear && !!portalInv.financialYear && (localInv.financialYear === portalInv.financialYear);
                    } else {
                        isDateMatch = !!localInv.dateMonthYear && !!portalInv.dateMonthYear && (localInv.dateMonthYear === portalInv.dateMonthYear);
                    }
                    if (!isDateMatch) continue; // Skip if dates don't match by selected strategy

                    // --- Check EXACT Normalized Invoice Number (Rule A) ---

                    if (localInv.invoiceNumberNormalized === portalInv.invoiceNumberNormalized) {
                        // --- Invoice Numbers Match Exactly - Now Check Amounts ---
                        const taxableAmountDiff = localInv.taxableAmount - portalInv.taxableAmount;
                        const taxAmountDiff = localInv.totalTax - portalInv.totalTax;
                        const isAmountMatchTolerance = Math.abs(taxableAmountDiff) <= effectiveToleranceAmount && Math.abs(taxAmountDiff) <= effectiveToleranceTax;

                        // Mark both as handled regardless of amount match status
                        matchedLocalRecordIds.add(localInv.id);
                        matchedPortalRecordIds.add(portalInv.id);

                        if (isAmountMatchTolerance) {
                            // Amounts Match within Tolerance
                            const isPerfectTaxable = Math.abs(taxableAmountDiff) < FLOAT_EPSILON;
                            const isPerfectTax = Math.abs(taxAmountDiff) < FLOAT_EPSILON;
                            const isPerfectMatch = isPerfectTaxable && isPerfectTax;
                            const status = isPerfectMatch ? 'MatchedPerfectly' : 'MatchedWithTolerance';
                            if (status === 'MatchedPerfectly') { results.summary.perfectlyMatchedCount++; } else { results.summary.toleranceMatchedCount++; }
                            const exactDateCompare = localInv.date && portalInv.date ? localInv.date.getTime() === portalInv.date.getTime() : localInv.date === portalInv.date;
                            const match: ReconciliationMatch = {
                                localRecord: localInv, portalRecord: portalInv, status: status,
                                toleranceDetails: {
                                    taxableAmount: !isPerfectTaxable, taxAmount: !isPerfectTax,
                                    rawInvoiceNumberDiffers: localInv.invoiceNumberRaw !== portalInv.invoiceNumberRaw,
                                    exactDateDiffers: !exactDateCompare,
                                }
                            }
                            supplierResults.matches.push(match);
                        } else {
                            // Amount Mismatch
                            const mismatch: ReconciliationMismatch = {
                                localRecord: localInv, portalRecord: portalInv,
                                taxableAmountDifference: parseFloat(taxableAmountDiff.toFixed(2)),
                                totalTaxDifference: parseFloat(taxAmountDiff.toFixed(2))
                            };
                            supplierResults.mismatchedAmounts.push(mismatch);
                            results.summary.mismatchedAmountsCount++;
                        }
                        break; // Found the exact invoice number pair for this localInv, move to next localInv
                    }
                } // End inner portal invoice loop (Pass 1)
            } // End outer local invoice loop (Pass 1)
        } // End supplier loop (Pass 1)
        this.logger.info('Finished Pass 1.');

        // --- PASS 2: Find Potential Matches (among remaining records) ---
        this.logger.info('Starting Pass 2: Potential Invoice Number Matches...');
        for (const supplierGstin of uniqueSuppliers) {
            const supplierLocalInvoices = localMapBySupplier.get(supplierGstin) || [];
            const supplierPortalInvoices = portalMapBySupplier.get(supplierGstin) || [];
            const supplierResults = results.details.get(supplierGstin)!; // Should exist from Pass 1
            for (const localInv of supplierLocalInvoices) {
                // *** Check if localInv was already handled in Pass 1 ***
                if (matchedLocalRecordIds.has(localInv.id)) continue;
                for (const portalInv of supplierPortalInvoices) {
                    // *** Check if portalInv was already handled in Pass 1 ***
                    if (matchedPortalRecordIds.has(portalInv.id)) continue;
                    // --- Check Date (Rule B) ---
                    let isDateMatch = false;
                    if (effectiveDateStrategy === 'fy') {
                        isDateMatch = !!localInv.financialYear && !!portalInv.financialYear && (localInv.financialYear === portalInv.financialYear);
                    } else {
                        isDateMatch = !!localInv.dateMonthYear && !!portalInv.dateMonthYear && (localInv.dateMonthYear === portalInv.dateMonthYear);
                    }
                    if (!isDateMatch) continue; // Skip if dates don't match by selected strategy
                    // --- Check Amounts within Tolerance (Rule C) ---
                    // NOTE: Invoice numbers are known NOT to match exactly here
                    const taxableAmountDiff = Math.abs(localInv.taxableAmount - portalInv.taxableAmount);
                    const taxAmountDiff = Math.abs(localInv.totalTax - portalInv.totalTax);
                    const isAmountMatchTolerance = taxableAmountDiff <= effectiveToleranceAmount && taxAmountDiff <= effectiveToleranceTax;
                    if (isAmountMatchTolerance) {
                        // --- Date and Amounts Match - Check Similarity ---
                        const similarity = checkInvoiceSimilarity(localInv.invoiceNumberRaw, portalInv.invoiceNumberRaw);
                        if (similarity) {
                            // Found a potential match
                            matchedLocalRecordIds.add(localInv.id); // Mark both as handled
                            matchedPortalRecordIds.add(portalInv.id);
                            const potential: ReconciliationPotentialMatch = {
                                localRecord: localInv, portalRecord: portalInv,
                                similarityMethod: similarity.method, similarityScore: similarity.score
                            };;
                            supplierResults.potentialMatches.push(potential);
                            results.summary.potentialMatchCount++;
                            this.logger.debug(`Found Potential Match: Local ${localInv.invoiceNumberRaw} <> Portal ${portalInv.invoiceNumberRaw}`);
                            break; // Found potential pairing for localInv, move to next localInv
                        }
                    }
                } // End inner portal invoice loop (Pass 2)
            } // End outer local invoice loop (Pass 2)
        } // End supplier loop (Pass 2)
        this.logger.info('Finished Pass 2.');

        // --- Final Pass: Identify Missing Records ---
        this.logger.info('Starting Final Pass: Identifying Missing Records...');
        for (const supplierGstin of uniqueSuppliers) {
            const supplierLocalInvoices = localMapBySupplier.get(supplierGstin) || [];
            const supplierPortalInvoices = portalMapBySupplier.get(supplierGstin) || [];
            const supplierResults = results.details.get(supplierGstin)!;

            for (const localInv of supplierLocalInvoices) {
                if (!matchedLocalRecordIds.has(localInv.id)) {
                    supplierResults.missingInPortal.push(localInv);
                    results.summary.missingInPortalCount++;
                }
            }
            for (const portalInv of supplierPortalInvoices) {
                if (!matchedPortalRecordIds.has(portalInv.id)) {
                    supplierResults.missingInLocal.push(portalInv);
                    results.summary.missingInLocalCount++;
                }
            }
        }
        this.logger.info('Finished Identifying Missing Records.');

        this.logger.info('Reconciliation completed.');
        this.logger.info(`Summary: Perfectly Matched: ${results.summary.perfectlyMatchedCount}, Tolerance Matched: ${results.summary.toleranceMatchedCount}, Missing in Portal: ${results.summary.missingInPortalCount}, Missing in Local: ${results.summary.missingInLocalCount}`);

        return results;
    }

    /** Helper function to group records by supplier GSTIN */
    private groupDataBySupplier(data: InternalInvoiceRecord[]): Map<string, InternalInvoiceRecord[]> {
        const map = new Map<string, InternalInvoiceRecord[]>();
        for (const record of data) {
            const gstin = record.supplierGstin?.trim().toUpperCase() || 'UNKNOWN_GSTIN';
            if (!map.has(gstin)) {
                map.set(gstin, []);
            }
            map.get(gstin)!.push(record); // Assert non-null as we just set it
        }
        return map;
    }
}

// --- DI Registration ---
// Registering the class itself as a singleton.
container.registerSingleton(ReconciliationService);
// Optionally, use an interface token if preferred:
// import { RECONCILIATION_SERVICE_TOKEN } from './interfaces/services'; // Define token first
// container.register(RECONCILIATION_SERVICE_TOKEN, { useClass: ReconciliationService }, { lifecycle: Lifecycle.Singleton });

// Add financialYear to InternalInvoiceRecord if not done already
// In src/core/common/interfaces/models.ts add:
// financialYear?: string; // e.g., "2024-25" (Calculated)