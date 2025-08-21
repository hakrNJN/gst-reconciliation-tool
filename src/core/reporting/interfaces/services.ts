// src/core/reporting/interfaces/services.ts
import { ReconciliationResults } from '../../common/interfaces/models';

/** Potential options for report generation */
export interface ReportOptions {
    format?: 'xlsx'; // Extend if other formats are added later
    includeRawData?: boolean; // Option to include raw data columns
    // Add other potential options
}

/** Defines the contract for the Report Generator Service */
export interface IReportGeneratorService {
    /**
     * Generates a report file (e.g., Excel) from reconciliation results.
     * @param results - The reconciliation results object.
     * @param options - Optional configuration for the report format/content.
     * @returns A promise resolving to a Buffer containing the report file content.
     */
    generateReport(
        results: ReconciliationResults,
        options?: ReportOptions
    ): Promise<Buffer>;
}

export interface StorableReconciliationRecord {
    supplierGstin: string;
    supplierName: string | undefined;
    localInvoiceNumber: string;
    localDate: Date | null;
    localInvoiceValue: number;
    localConum: string | number | undefined; // Company number from local record
    localVno: string | number | undefined;   // Voucher number from local record
    localInvType: string | number | undefined; // Invoice type from local record
    localDocType: string | undefined; // Document type from local record
    portalInvoiceNumber?: string; // Include portal invoice for context
    portalDate?: Date | null;     // Include portal date for context
    remark: 'Matched Perfectly' | 'Matched (Tolerance)' | 'Mismatched Amounts' | 'Manually Matched'; // The status
    reconciliationDate: Date; // The date the reconciliation was performed
    // Add any other fields you absolutely need to store, e.g., unique local record ID if available
    // localRecordId?: string;
}