// src/core/reconciliation/reconciliation.service.ts
import 'reflect-metadata'; // DI requirement
import { container, inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import config from '../../config';
import { LOGGER_TOKEN } from '../../infrastructure/logger';
import { InternalInvoiceRecord, ReconciliationMatch, ReconciliationMismatch, ReconciliationResults } from '../common/interfaces/models';
import { IReconciliationService, ReconciliationOptions } from './interfaces/services';
import { excelSerialDateToJSDate, getCanonicalMonthYear, getFinancialYear, normalizeInvoiceNumber, parseDateString } from './normalization.utils';

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

        // --- Determine effective tolerances and date strategy ---
        const effectiveToleranceAmount = options?.toleranceAmount ?? config.reconciliation.toleranceAmount;
        const effectiveToleranceTax = options?.toleranceTax ?? config.reconciliation.toleranceTax;
        const effectiveDateStrategy = options?.dateMatchStrategy ?? 'month'; // Default to 'month'

        this.logger.info(`Starting reconciliation. Local: ${localDataInput.length}, Portal: ${portalDataInput.length}`);
        this.logger.info(`Using Tolerances: Amount=±${effectiveToleranceAmount}, Tax=±${effectiveToleranceTax}`);
        this.logger.info(`Using Date Match Strategy: ${effectiveDateStrategy}`);


        const standardize = (record: InternalInvoiceRecord): InternalInvoiceRecord => {
            // --- Ensure tax components are numbers BEFORE calculation ---
            const igstNum = Number(record.igst || 0);
            const cgstNum = Number(record.cgst || 0);
            const sgstNum = Number(record.sgst || 0);

            // Calculate totalTax using the numeric values
            const totalTax = igstNum > 0 ? igstNum : (cgstNum + sgstNum);

            // --- Remove or comment out the problematic log if it was just for debugging ---
            // this.logger.info(totalTax) // This should now log a number

            // Ensure taxable amount is a number for calculation/return
            const taxableAmountNum = Number(record.taxableAmount || 0);

            // const parsedDate = record.date instanceof Date ? record.date : new Date(record.date); // Ensure it's a Date object
            // --- Robust Date Parsing ---
            let parsedDate: Date | null = null;
            if (record.date instanceof Date && !isNaN(record.date.getTime())) {
                // 1. If already a valid Date (likely from JSON parser)
                record.date.setUTCHours(12, 0, 0, 0); // Ensure UTC noon
                parsedDate = record.date;
            } else if (typeof record.date === 'number' && record.source === 'local') {
                // 2. If it's a number from local source (Excel serial)
                parsedDate = excelSerialDateToJSDate(record.date);
                if (!parsedDate) {
                    this.logger.warn(`Could not parse Excel date serial number "${record.date}" for record ID ${record.id}.`);
                }
            } else if (typeof record.date === 'string') {
                // 3. If it's a string (e.g., maybe from JSON or poorly parsed Excel), try DD-MM-YYYY
                parsedDate = parseDateString(record.date); // Re-use or refine this helper
                if (!parsedDate) {
                    // Optionally try other formats or ISO string conversion
                    const isoDate = new Date(record.date);
                    if (!isNaN(isoDate.getTime())) {
                        isoDate.setUTCHours(12, 0, 0, 0);
                        parsedDate = isoDate;
                    } else {
                        this.logger.warn(`Could not parse date string "${record.date}" for record ID ${record.id} using known formats.`);
                    }
                }
            }

            // Assign an invalid Date object if parsing failed completely
            if (!(parsedDate instanceof Date) || isNaN(parsedDate.getTime())) {
                this.logger.warn(`Assigning invalid date for record ID ${record.id}. Original value: ${record.date}`);
                parsedDate = new Date('Invalid Date');
            }


            return {
                ...record, // Spread original record first
                invoiceNumberNormalized: normalizeInvoiceNumber(record.invoiceNumberRaw),
                dateMonthYear: getCanonicalMonthYear(record.date),
                financialYear: getFinancialYear(parsedDate), // Calculate FY here too
                date: parsedDate,
                // --- Assign the correctly calculated numeric totalTax, rounded ---
                totalTax: parseFloat(totalTax.toFixed(2)),
                // --- Assign the ensured numeric values back ---
                taxableAmount: taxableAmountNum,
                igst: igstNum,
                cgst: cgstNum,
                sgst: sgstNum,
                // Calculate invoiceValue using ensured numeric values
                invoiceValue: Number(record.invoiceValue || (taxableAmountNum + totalTax))
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
                missingInLocalCount: 0, //added this
                mismatchedAmountsCount: 0,
                totalSuppliersLocal: 0,
                totalSuppliersPortal: 0,
                reconciliationTimestamp: new Date(),
            },
            details: new Map<string, {
                supplierName?: string;
                matches: ReconciliationMatch[];
                missingInPortal: InternalInvoiceRecord[];
                missingInLocal: InternalInvoiceRecord[];
                mismatchedAmounts: ReconciliationMismatch[];
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

        // ---Main Reconciliation Loop,Iterate through each supplier---
        for (const supplierGstin of uniqueSuppliers) {
            const supplierLocalInvoices = localMapBySupplier.get(supplierGstin) || [];
            const supplierPortalInvoices = portalMapBySupplier.get(supplierGstin) || [];
            const supplierName = supplierLocalInvoices[0]?.supplierName ?? supplierPortalInvoices[0]?.supplierName;

            // Initialize result entry for this supplier
            results.details.set(supplierGstin, {
                supplierName: supplierName,
                matches: [],
                missingInPortal: [],
                missingInLocal: [],
                mismatchedAmounts: []
            });
            const supplierResults = results.details.get(supplierGstin)!; // Assert non-null as we just set it

            // Attempt to match local invoices against portal invoices for this supplier
            for (const localInv of supplierLocalInvoices) {
                if (matchedLocalRecordIds.has(localInv.id)) continue; // Skip if already matched
                // this.logger.info(`Processing Local Invoice ${localInv.invoiceNumberNormalized}.`);
                // let foundMatchForLocal = false;
                for (const portalInv of supplierPortalInvoices) {
                    if (matchedPortalRecordIds.has(portalInv.id)) continue; // Skip if already matched
                    // --- Apply Matching Rules ---
                    // Rule B: Same Month/Year
                    let isDateMatch = false;
                    if (effectiveDateStrategy === 'fy') {
                        // Check if financialYear was calculated and matches
                        isDateMatch = !!localInv.financialYear && !!portalInv.financialYear && (localInv.financialYear === portalInv.financialYear);
                    } else { // Default to 'month'
                        isDateMatch = localInv.dateMonthYear === portalInv.dateMonthYear;
                    }
                    if (!isDateMatch) continue;

                    // if (localInv.dateMonthYear !== portalInv.dateMonthYear) continue;

                    // Rule A: Normalized Invoice Number
                    if (localInv.invoiceNumberNormalized !== portalInv.invoiceNumberNormalized) continue;

                    // Rule C: Amount Tolerances
                    const taxableAmountDiff = Math.abs(localInv.taxableAmount - portalInv.taxableAmount);
                    const taxAmountDiff = Math.abs(localInv.totalTax - portalInv.totalTax);

                    const isTaxableAmountMatch = taxableAmountDiff <= effectiveToleranceAmount;
                    const isTaxAmountMatch = taxAmountDiff <= effectiveToleranceTax;

                    if (isTaxableAmountMatch && isTaxAmountMatch) {
                        // --- Match Found ---
                        // foundMatchForLocal = true;
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

                        // Create match object
                        const match: ReconciliationMatch = {
                            localRecord: localInv,
                            portalRecord: portalInv,
                            status: status,
                            toleranceDetails: {
                                taxableAmount: !isPerfectTaxable,
                                taxAmount: !isPerfectTax,
                                rawInvoiceNumberDiffers: localInv.invoiceNumberRaw !== portalInv.invoiceNumberRaw,
                                exactDateDiffers: localInv.date!.getTime() !== portalInv.date!.getTime(),
                            }
                        };
                        supplierResults.matches.push(match);
                    } else {
                        // --- Amounts DO NOT Match within Tolerance (It's a Mismatch) ---
                        matchedLocalRecordIds.add(localInv.id); // Mark both as handled
                        matchedPortalRecordIds.add(portalInv.id);

                        const mismatch: ReconciliationMismatch = {
                            localRecord: localInv,
                            portalRecord: portalInv,
                            taxableAmountDifference: parseFloat(taxableAmountDiff.toFixed(2)),
                            totalTaxDifference: parseFloat(taxAmountDiff.toFixed(2))
                        };
                        supplierResults.mismatchedAmounts.push(mismatch);
                        // Increment a new summary counter if needed (e.g., results.summary.mismatchedCount++)
                        // --- Increment the mismatch counter ---
                        results.summary.mismatchedAmountsCount++;
                        // --------------------------------------
                
                    }
                    break; // Found match for localInv, move to the next localInv
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

// Add financialYear to InternalInvoiceRecord if not done already
// In src/core/common/interfaces/models.ts add:
// financialYear?: string; // e.g., "2024-25" (Calculated)