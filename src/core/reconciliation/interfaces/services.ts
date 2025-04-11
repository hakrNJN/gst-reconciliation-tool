// src/core/reconciliation/interfaces/services.ts
import { InternalInvoiceRecord, ReconciliationResults } from '../../common/interfaces/models';

/** Options for configuring a reconciliation run (if needed later) */
export interface ReconciliationOptions {
    toleranceAmount?: number;
    toleranceTax?: number;
    dateMatchStrategy?: 'month' | 'fy';
    reconciliationScope?: 'all' | 'b2b'|'cdnr'; // Full reconciliation or just a summary
    // Add other potential options here
}

/** Defines the contract for the Reconciliation Service */
export interface IReconciliationService {
    /**
     * Performs reconciliation between local purchase data and portal data.
     * @param localData - Array of standardized local invoice records.
     * @param portalData - Array of standardized portal invoice records.
     * @param options - Optional configuration for this specific run.
     * @returns A promise resolving to the ReconciliationResults.
     */
    reconcile(
        localData: InternalInvoiceRecord[],
        portalData: InternalInvoiceRecord[],
        options?: ReconciliationOptions
    ): Promise<ReconciliationResults>;
}

/** Defines the contract for Normalization Utilities (can be implemented as static class or functions) */
export interface INormalizationUtils {
     normalizeInvoiceNumber(invoice: string): string;
     getCanonicalMonthYear(date: Date): string;
     // Add other normalization functions if needed
}