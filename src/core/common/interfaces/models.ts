// src/core/common/interfaces/models.ts

/**
 * Represents a single invoice record after initial parsing and standardization.
 */
export interface InternalInvoiceRecord {
    /** Unique identifier assigned during processing */
    id: string; // Removed readonly
    /** Source of the record ('local' or 'portal') */
    source: 'local' | 'portal'; // Removed readonly (or assign during parsing)
    /** Supplier GST Identification Number */
    supplierGstin: string; // Removed readonly
    /** Supplier Name (optional, might only be in portal data) */
    supplierName?: string; // Removed readonly
    /** Original invoice number string as it appeared in the source */
    invoiceNumberRaw: string; // Removed readonly
    /** Normalized invoice number used for matching */
    invoiceNumberNormalized: string; // Removed readonly (will be set later)
    /** Invoice date */
    date: Date; // Removed readonly
    /** Canonical representation of month and year (e.g., "YYYY-MM") */
    dateMonthYear: string; // Removed readonly (will be set later)
    /** Taxable value (value before tax) */
    taxableAmount: number; // Removed readonly
    /** Integrated Goods and Services Tax amount */
    igst: number; // Removed readonly
    /** Central Goods and Services Tax amount */
    cgst: number; // Removed readonly
    /** State Goods and Services Tax amount */
    sgst: number; // Removed readonly
    /** Total tax amount (IGST or CGST + SGST) */
    totalTax: number; // Removed readonly (will be calculated later)
    /** Total Invoice Value (Taxable Amount + Total Tax) - Calculated or from source */
    invoiceValue: number; // Removed readonly
    /** Line number from the original file (optional, for tracing) */
    originalLineNumber?: number; // Removed readonly
    /** Raw data record from parsing (optional, for debugging) */
    rawData?: any; // Removed readonly
}

/**
 * Represents a successful match between a local and portal invoice.
 */
export interface ReconciliationMatch {
    /** The record from the local purchase data */
    readonly localRecord: Readonly<InternalInvoiceRecord>; // Use Readonly here if desired
    /** The record from the GSTR-2B portal data */
    readonly portalRecord: Readonly<InternalInvoiceRecord>; // Use Readonly here if desired
    /** Status indicating perfect match or match within tolerance */
    readonly status: 'MatchedPerfectly' | 'MatchedWithTolerance';
    /** Details about which fields required tolerance for matching */
    readonly toleranceDetails: {
        readonly taxableAmount: boolean;
        readonly taxAmount: boolean;
        readonly rawInvoiceNumberDiffers: boolean;
        readonly exactDateDiffers: boolean;
    };
}

/**
 * Structure holding the overall results of the reconciliation process.
 */
export interface ReconciliationResults {
    /** Summary statistics of the reconciliation */
    summary: {
        totalLocalRecords: number;
        totalPortalRecords: number;
        perfectlyMatchedCount: number;
        toleranceMatchedCount: number;
        missingInPortalCount: number; // Count of local records not found in portal
        missingInLocalCount: number;  // Count of portal records not found in local
        totalSuppliersLocal: number;
        totalSuppliersPortal: number;
        reconciliationTimestamp: Date;
    };
    /** Detailed results grouped by Supplier GSTIN */
    details: Map<string, { // Key: Supplier GSTIN
        supplierName?: string; // Store name if available
        matches: ReconciliationMatch[];
        missingInPortal: InternalInvoiceRecord[]; // Local records not matched
        missingInLocal: InternalInvoiceRecord[];  // Portal records not matched
    }>;
}