// src/core/common/interfaces/models.ts

/**
 * Represents a single invoice record after initial parsing and standardization.
 */
export interface InternalInvoiceRecord {
    /** Unique identifier assigned during processing */
    id: string; 
    /** Source of the record ('local' or 'portal') */
    source: 'local' | 'portal'; // (or assign during parsing)
    /** Supplier GST Identification Number */
    supplierGstin: string; 
    /** Supplier Name (optional, might only be in portal data) */
    supplierName?: string; 
    /** Original invoice number string as it appeared in the source */
    invoiceNumberRaw: string; 
    /** Normalized invoice number used for matching */
    invoiceNumberNormalized: string; // (will be set later)
    /** Invoice date */
    date: Date | null;
    /** Canonical representation of month and year (e.g., "YYYY-MM") */
    dateMonthYear: string;  //(will be set later)
    dateQuarter: string; // (will be set later)
    /** Taxable value (value before tax) */
    taxableAmount: number; 
    /** Integrated Goods and Services Tax amount */
    igst: number; 
    /** Central Goods and Services Tax amount */
    cgst: number; 
    /** State Goods and Services Tax amount */
    sgst: number; 
    /** Total tax amount (IGST or CGST + SGST) */
    totalTax: number; // (will be calculated later)
    /** Total Invoice Value (Taxable Amount + Total Tax) - Calculated or from source */
    invoiceValue: number; 
    /** Line number from the original file (optional, for tracing) */
    originalLineNumber?: number; 
    /** Raw data record from parsing (optional, for debugging) */
    rawData?: any; 

     // --- Fields primarily from Portal Data (GSTR-2B) ---
    /** Place of Supply (e.g., state code) */
    placeOfSupply?: string;
    /** Is Reverse Charge applicable? ('Y'/'N' from portal -> boolean) */
    reverseCharge?: boolean;
    /** Is ITC Available based on portal data? ('Y'/'N' from portal -> boolean) */
    itcAvailable?: boolean;
    /** Reason code/text if ITC is not available */
    itcReason?: string;
   /** Unified Document Type: 'INV' (Invoice/B2B), 'C' (Credit Note), 'D' (Debit Note) */
    documentType?:'INV' | 'C' | 'D' | string; // To distinguish invoices from notes if parsing both
    financialYear: string; // Financial year (e.g., "2023-24") - calculated from date
    supfileDate?: Date | null; // Date when the file was processed
    supSource?: string; // Source of the record (e.g., "GSTR-2B", "GSTR-1", etc.)
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

/** Represents a pair where Date/Inv# matched but amounts differed beyond tolerance */
export interface ReconciliationMismatch {
    readonly localRecord: Readonly<InternalInvoiceRecord>;
    readonly portalRecord: Readonly<InternalInvoiceRecord>;
    readonly taxableAmountDifference: number;
    readonly totalTaxDifference: number;
}

// --- Add PotentialMatch Interface ---
export interface ReconciliationPotentialMatch {
    readonly localRecord: Readonly<InternalInvoiceRecord>;
    readonly portalRecord: Readonly<InternalInvoiceRecord>;
    readonly similarityMethod?: 'Numeric' | 'Levenshtein' | 'None'; // Indicate how similarity was found
    readonly similarityScore?: number; // e.g., Levenshtein distance
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
        missingInPortalCount: number; 
        missingInLocalCount: number; 
        mismatchedAmountsCount: number; 
        potentialMatchCount: number;
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
        mismatchedAmounts: ReconciliationMismatch[];
        potentialMatches: ReconciliationPotentialMatch[];
    }>;
}