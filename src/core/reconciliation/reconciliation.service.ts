// src/core/reconciliation/reconciliation.service.ts
import 'reflect-metadata'; // DI requirement
import { container, inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import config from '../../config';
import { LOGGER_TOKEN } from '../../infrastructure/logger';
import { InternalInvoiceRecord, ReconciliationMatch, ReconciliationResults } from '../common/interfaces/models';
import { IReconciliationService, ReconciliationOptions } from './interfaces/services';
import { getCanonicalMonthYear, normalizeInvoiceNumber } from './normalization.utils';

// Small epsilon for comparing floating point numbers for "perfect" match
const FLOAT_EPSILON = 0.001;

@singleton()
@injectable()
export class ReconciliationService implements IReconciliationService {

    constructor(
        @inject(LOGGER_TOKEN) private logger: Logger
    ) {
        this.logger.info('ReconciliationService initialized.');
    }

    /**
     * Performs reconciliation between local purchase data and portal data.
     */
    async reconcile(
        localDataInput: InternalInvoiceRecord[],
        portalDataInput: InternalInvoiceRecord[],
        options?: ReconciliationOptions // Options currently not used, but available for future extension
    ): Promise<ReconciliationResults> {

        this.logger.info(`Starting reconciliation. Local records: ${localDataInput.length}, Portal records: ${portalDataInput.length}`);

        // --- Temporary Standardization Step ---
        // TODO: Move this logic to a dedicated Validation/Standardization Service
        // This ensures required fields for matching are present before reconciliation begins.
        const standardize = (record: InternalInvoiceRecord): InternalInvoiceRecord => {
            const totalTax = record.igst > 0
                ? record.igst
                : (record.cgst || 0) + (record.sgst || 0); // Ensure calculation even if taxes are 0/null/undefined
            return {
                ...record,
                invoiceNumberNormalized: normalizeInvoiceNumber(record.invoiceNumberRaw),
                dateMonthYear: getCanonicalMonthYear(record.date),
                totalTax: parseFloat(totalTax.toFixed(2)), // Calculate and round total tax
                // Ensure numeric fields are numbers
                taxableAmount: Number(record.taxableAmount || 0),
                igst: Number(record.igst || 0),
                cgst: Number(record.cgst || 0),
                sgst: Number(record.sgst || 0),
                invoiceValue: Number(record.invoiceValue || (Number(record.taxableAmount || 0) + totalTax))
            };
        };

        const localData = localDataInput.map(standardize);
        const portalData = portalDataInput.map(standardize);
        // --- End Temporary Standardization Step ---


        // Initialize results
        const results: ReconciliationResults = {
            summary: {
                totalLocalRecords: localData.length,
                totalPortalRecords: portalData.length,
                perfectlyMatchedCount: 0,
                toleranceMatchedCount: 0,
                missingInPortalCount: 0,
                missingInLocalCount: 0,
                totalSuppliersLocal: 0,
                totalSuppliersPortal: 0,
                reconciliationTimestamp: new Date(),
            },
            details: new Map<string, {
                supplierName?: string;
                matches: ReconciliationMatch[];
                missingInPortal: InternalInvoiceRecord[];
                missingInLocal: InternalInvoiceRecord[];
            }>()
        };

        const matchedLocalRecordIds = new Set<string>();
        const matchedPortalRecordIds = new Set<string>();

        // Group data by Supplier GSTIN
        const localMapBySupplier = this.groupDataBySupplier(localData);
        const portalMapBySupplier = this.groupDataBySupplier(portalData);
        const uniqueSuppliers = new Set([...localMapBySupplier.keys(), ...portalMapBySupplier.keys()]);

        results.summary.totalSuppliersLocal = localMapBySupplier.size;
        results.summary.totalSuppliersPortal = portalMapBySupplier.size;

        this.logger.info(`Processing ${uniqueSuppliers.size} unique suppliers.`);

        // Iterate through each supplier
        for (const supplierGstin of uniqueSuppliers) {
            const supplierLocalInvoices = localMapBySupplier.get(supplierGstin) || [];
            const supplierPortalInvoices = portalMapBySupplier.get(supplierGstin) || [];
            const supplierName = supplierLocalInvoices[0]?.supplierName ?? supplierPortalInvoices[0]?.supplierName;

            // Initialize result entry for this supplier
            results.details.set(supplierGstin, {
                supplierName: supplierName,
                matches: [],
                missingInPortal: [],
                missingInLocal: []
            });
            const supplierResults = results.details.get(supplierGstin)!; // Assert non-null as we just set it

            // Attempt to match local invoices against portal invoices for this supplier
            for (const localInv of supplierLocalInvoices) {
                if (matchedLocalRecordIds.has(localInv.id)) continue; // Skip if already matched

                let foundMatchForLocal = false;
                for (const portalInv of supplierPortalInvoices) {
                    if (matchedPortalRecordIds.has(portalInv.id)) continue; // Skip if already matched

                    // --- Apply Matching Rules ---
                    // Rule B: Same Month/Year
                    if (localInv.dateMonthYear !== portalInv.dateMonthYear) continue;

                    // Rule A: Normalized Invoice Number
                    if (localInv.invoiceNumberNormalized !== portalInv.invoiceNumberNormalized) continue;

                    // Rule C: Amount Tolerances
                    const taxableAmountDiff = Math.abs(localInv.taxableAmount - portalInv.taxableAmount);
                    const taxAmountDiff = Math.abs(localInv.totalTax - portalInv.totalTax);

                    const isTaxableAmountMatch = taxableAmountDiff <= config.reconciliation.toleranceAmount;
                    const isTaxAmountMatch = taxAmountDiff <= config.reconciliation.toleranceTax;

                    if (isTaxableAmountMatch && isTaxAmountMatch) {
                        // --- Match Found ---
                        foundMatchForLocal = true;
                        matchedLocalRecordIds.add(localInv.id);
                        matchedPortalRecordIds.add(portalInv.id);

                        // Determine if perfect or tolerance match
                        const isPerfectTaxable = taxableAmountDiff < FLOAT_EPSILON;
                        const isPerfectTax = taxAmountDiff < FLOAT_EPSILON;
                        // Consider other factors for perfect match if needed (e.g., exact date)
                        const isPerfectMatch = isPerfectTaxable && isPerfectTax;
                        const status = isPerfectMatch ? 'MatchedPerfectly' : 'MatchedWithTolerance';

                        if (status === 'MatchedPerfectly') {
                            results.summary.perfectlyMatchedCount++;
                        } else {
                            results.summary.toleranceMatchedCount++;
                        }

                        const match: ReconciliationMatch = {
                            localRecord: localInv,
                            portalRecord: portalInv,
                            status: status,
                            toleranceDetails: {
                                taxableAmount: !isPerfectTaxable,
                                taxAmount: !isPerfectTax,
                                rawInvoiceNumberDiffers: localInv.invoiceNumberRaw !== portalInv.invoiceNumberRaw,
                                exactDateDiffers: localInv.date.getTime() !== portalInv.date.getTime(),
                            }
                        };
                        supplierResults.matches.push(match);

                        break; // Found match for localInv, move to the next localInv
                    }
                } // End inner portal invoice loop
            } // End outer local invoice loop

            // Identify unmatched records for this supplier
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
        } // End supplier loop

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