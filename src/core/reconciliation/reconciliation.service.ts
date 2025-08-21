// src/core/reconciliation/reconciliation.service.ts
import 'reflect-metadata'; // DI requirement
import { inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import config from '../../config';
import { LOGGER_TOKEN } from '../../infrastructure/logger';
import {
    AmountSummary, InternalInvoiceRecord, ReconciliationMatch, ReconciliationMismatch,
    ReconciliationPotentialMatch, ReconciliationResults, ReconciliationSummary
} from '../common/interfaces/models';
import { IValidationService, ValidationService } from '../validation';
import { IReconciliationService, ReconciliationOptions } from './interfaces/services';
import { checkInvoiceSimilarity } from './normalization.utils';

// Small epsilon for comparing floating point numbers for "perfect" match
const FLOAT_EPSILON = 0.001;

// Helper to create an empty amount summary object
const getEmptyAmountSummary = (): AmountSummary => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });

// Helper to add a record's amounts to a summary object
const addToAmountSummary = (summary: AmountSummary, record: InternalInvoiceRecord) => {
    summary.taxable += record.taxableAmount;
    summary.igst += record.igst;
    summary.cgst += record.cgst;
    summary.sgst += record.sgst;
};

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
        options?: ReconciliationOptions
    ): Promise<ReconciliationResults> {

        // --- Separate Reverse Charge Invoices ---
        const reverseChargeInvoices = portalData.filter(p => p.reverseCharge === true);
        const nonReverseChargePortalData = portalData.filter(p => p.reverseCharge !== true);
        this.logger.info(`Separated ${reverseChargeInvoices.length} reverse charge invoices.`);

        // --- Determine effective options ---
        const effectiveToleranceAmount = options?.toleranceAmount ?? config.reconciliation.toleranceAmount;
        const effectiveToleranceTax = options?.toleranceTax ?? config.reconciliation.toleranceTax;
        const effectiveDateStrategy = options?.dateMatchStrategy ?? 'month';
        const reconciliationScope = options?.reconciliationScope ?? 'all';

        this.logger.info(`Starting reconciliation. Scope: ${reconciliationScope}, Local: ${localData.length}, Portal: ${nonReverseChargePortalData.length}`);

        // --- Filter Data Based on Scope ---
        const filterByScope = (record: InternalInvoiceRecord): boolean => {
            if (reconciliationScope === 'all') return true;
            if (reconciliationScope === 'b2b') return record.documentType === 'INV';
            if (reconciliationScope === 'cdnr') return record.documentType === 'C' || record.documentType === 'D';
            return false;
        };
        const filteredLocalData = localData.filter(filterByScope);
        const filteredPortalData = nonReverseChargePortalData.filter(filterByScope);

        // --- Initialize New Summary Structure ---
        const summary: ReconciliationSummary = {
            reconciliationTimestamp: new Date(),
            totalSuppliersLocal: 0, // Will be set later
            totalSuppliersPortal: 0, // Will be set later
            totalLocal: { count: filteredLocalData.length, amounts: getEmptyAmountSummary() },
            totalPortal: { count: filteredPortalData.length, amounts: getEmptyAmountSummary() },
            perfectlyMatched: { count: 0, book: getEmptyAmountSummary(), portal: getEmptyAmountSummary() },
            toleranceMatched: { count: 0, book: getEmptyAmountSummary(), portal: getEmptyAmountSummary() },
            mismatched: { count: 0, book: getEmptyAmountSummary(), portal: getEmptyAmountSummary() },
            potentialMatches: { count: 0, book: getEmptyAmountSummary(), portal: getEmptyAmountSummary() },
            missingInPortal: { count: 0, amounts: getEmptyAmountSummary() },
            missingInLocal: { count: 0, amounts: getEmptyAmountSummary() },
            rcmEntries: { count: reverseChargeInvoices.length, amounts: getEmptyAmountSummary() },
        };

        // Calculate total amounts
        filteredLocalData.forEach(rec => addToAmountSummary(summary.totalLocal.amounts, rec));
        filteredPortalData.forEach(rec => addToAmountSummary(summary.totalPortal.amounts, rec));
        reverseChargeInvoices.forEach(rec => addToAmountSummary(summary.rcmEntries.amounts, rec));

        // --- Grouping and Setup ---
        const localMapBySupplier = this.groupDataBySupplier(filteredLocalData);
        const portalMapBySupplier = this.groupDataBySupplier(filteredPortalData);
        const uniqueSuppliers = new Set([...localMapBySupplier.keys(), ...portalMapBySupplier.keys()]);
        summary.totalSuppliersLocal = localMapBySupplier.size;
        summary.totalSuppliersPortal = portalMapBySupplier.size;

        const results: ReconciliationResults = {
            summary: summary,
            details: new Map(),
            reverseChargeLiable: reverseChargeInvoices
        };

        const matchedLocalRecordIds = new Set<string>();
        const matchedPortalRecordIds = new Set<string>();

        // --- Main Reconciliation Loop ---
        this.logger.info('Starting reconciliation passes...');
        for (const supplierGstin of uniqueSuppliers) {
            const supplierLocalInvoices = localMapBySupplier.get(supplierGstin) || [];
            const supplierPortalInvoices = portalMapBySupplier.get(supplierGstin) || [];

            if (!results.details.has(supplierGstin)) {
                const supplierName = supplierLocalInvoices[0]?.supplierName ?? supplierPortalInvoices[0]?.supplierName;
                results.details.set(supplierGstin, {
                    supplierName: supplierName,
                    matches: [], missingInPortal: [], missingInLocal: [],
                    mismatchedAmounts: [], potentialMatches: []
                });
            }
            const supplierResults = results.details.get(supplierGstin)!;

            // PASS 1: Exact Invoice Number Matches
            for (const localInv of supplierLocalInvoices) {
                if (matchedLocalRecordIds.has(localInv.id)) continue;
                for (const portalInv of supplierPortalInvoices) {
                    if (matchedPortalRecordIds.has(portalInv.id)) continue;

                    let isDateMatch = this.checkDateMatch(localInv, portalInv, effectiveDateStrategy);
                    if (!isDateMatch) continue;

                    if (localInv.invoiceNumberNormalized === portalInv.invoiceNumberNormalized) {
                        matchedLocalRecordIds.add(localInv.id);
                        matchedPortalRecordIds.add(portalInv.id);

                        const taxableAmountDiff = localInv.taxableAmount - portalInv.taxableAmount;
                        const taxAmountDiff = localInv.totalTax - portalInv.totalTax;
                        const isAmountMatchTolerance = Math.abs(taxableAmountDiff) <= effectiveToleranceAmount && Math.abs(taxAmountDiff) <= effectiveToleranceTax;

                        if (isAmountMatchTolerance) {
                            const isPerfectMatch = this.isPerfectMatch(localInv, portalInv, taxableAmountDiff, taxAmountDiff);
                            const status = isPerfectMatch ? 'MatchedPerfectly' : 'MatchedWithTolerance';
                            const categorySummary = isPerfectMatch ? summary.perfectlyMatched : summary.toleranceMatched;

                            categorySummary.count++;
                            addToAmountSummary(categorySummary.book, localInv);
                            addToAmountSummary(categorySummary.portal, portalInv);

                            supplierResults.matches.push({ localRecord: localInv, portalRecord: portalInv, status: status, toleranceDetails: {} as any });
                        } else {
                            summary.mismatched.count++;
                            addToAmountSummary(summary.mismatched.book, localInv);
                            addToAmountSummary(summary.mismatched.portal, portalInv);
                            supplierResults.mismatchedAmounts.push({ localRecord: localInv, portalRecord: portalInv, taxableAmountDifference: taxableAmountDiff, totalTaxDifference: taxAmountDiff });
                        }
                        break; // Move to next localInv
                    }
                }
            }
        }

        // PASS 2: Potential Matches (among remaining records)
        for (const supplierGstin of uniqueSuppliers) {
            const supplierLocalInvoices = localMapBySupplier.get(supplierGstin) || [];
            const supplierPortalInvoices = portalMapBySupplier.get(supplierGstin) || [];
            const supplierResults = results.details.get(supplierGstin)!;

            for (const localInv of supplierLocalInvoices) {
                if (matchedLocalRecordIds.has(localInv.id)) continue;
                for (const portalInv of supplierPortalInvoices) {
                    if (matchedPortalRecordIds.has(portalInv.id)) continue;

                    if (!this.checkDateMatch(localInv, portalInv, effectiveDateStrategy)) continue;

                    const taxableAmountDiff = Math.abs(localInv.taxableAmount - portalInv.taxableAmount);
                    const taxAmountDiff = Math.abs(localInv.totalTax - portalInv.totalTax);
                    if (taxableAmountDiff <= effectiveToleranceAmount && taxAmountDiff <= effectiveToleranceTax) {
                        const similarity = checkInvoiceSimilarity(localInv.invoiceNumberRaw, portalInv.invoiceNumberRaw);
                        if (similarity) {
                            matchedLocalRecordIds.add(localInv.id);
                            matchedPortalRecordIds.add(portalInv.id);

                            summary.potentialMatches.count++;
                            addToAmountSummary(summary.potentialMatches.book, localInv);
                            addToAmountSummary(summary.potentialMatches.portal, portalInv);

                            supplierResults.potentialMatches.push({ localRecord: localInv, portalRecord: portalInv, similarityMethod: similarity.method, similarityScore: similarity.score });
                            break; // Move to next localInv
                        }
                    }
                }
            }
        }

        // FINAL PASS: Identify Missing Records
        for (const supplierGstin of uniqueSuppliers) {
            const supplierLocalInvoices = localMapBySupplier.get(supplierGstin) || [];
            const supplierPortalInvoices = portalMapBySupplier.get(supplierGstin) || [];
            const supplierResults = results.details.get(supplierGstin)!;

            for (const localInv of supplierLocalInvoices) {
                if (!matchedLocalRecordIds.has(localInv.id)) {
                    supplierResults.missingInPortal.push(localInv);
                    summary.missingInPortal.count++;
                    addToAmountSummary(summary.missingInPortal.amounts, localInv);
                }
            }
            for (const portalInv of supplierPortalInvoices) {
                if (!matchedPortalRecordIds.has(portalInv.id)) {
                    supplierResults.missingInLocal.push(portalInv);
                    summary.missingInLocal.count++;
                    addToAmountSummary(summary.missingInLocal.amounts, portalInv);
                }
            }
        }

        this.logger.info('Reconciliation completed.');
        return results;
    }

    private checkDateMatch(localInv: InternalInvoiceRecord, portalInv: InternalInvoiceRecord, strategy: ReconciliationOptions['dateMatchStrategy']): boolean {
        if (strategy === 'fy') {
            return localInv.financialYear === portalInv.financialYear;
        }
        if (strategy === 'quarter') {
            return localInv.financialYear === portalInv.financialYear && localInv.dateQuarter === portalInv.dateQuarter;
        }
        // Default to month strategy
        return localInv.dateMonthYear === portalInv.dateMonthYear;
    }

    private isPerfectMatch(localInv: InternalInvoiceRecord, portalInv: InternalInvoiceRecord, taxableDiff: number, taxDiff: number): boolean {
        const isPerfectTaxable = Math.abs(taxableDiff) < FLOAT_EPSILON;
        const isPerfectTax = Math.abs(taxDiff) < FLOAT_EPSILON;
        const isExactDateMatch = localInv.date?.getTime() === portalInv.date?.getTime();
        return isPerfectTaxable && isPerfectTax && isExactDateMatch;
    }

    private groupDataBySupplier(data: InternalInvoiceRecord[]): Map<string, InternalInvoiceRecord[]> {
        const map = new Map<string, InternalInvoiceRecord[]>();
        for (const record of data) {
            const gstin = record.supplierGstin?.trim().toUpperCase() || 'UNKNOWN_GSTIN';
            if (!map.has(gstin)) {
                map.set(gstin, []);
            }
            map.get(gstin)!.push(record);
        }
        return map;
    }
}
