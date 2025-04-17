// src/core/common/interfaces/repositories/IReconciledRecordRepository.ts

import { Gstr2bReconciledRecord } from "../../../common/entities"; // Adjust path if needed
import { StorableReconciliationRecord } from "../../../reporting/interfaces/services"; // Or wherever StorableReconciliationRecord is defined

/**
 * Defines the contract for data access operations related to
 * persisted GSTR-2B reconciliation results.
 */
export interface IReconciledRecordRepository {
    /**
     * Saves multiple reconciled records to the persistent storage.
     * Handles both new inserts and potentially updates if records can be identified.
     *
     * @param records An array of StorableReconciliationRecord DTOs to save.
     * @returns A promise that resolves when the operation is complete.
     * @throws {Error} // Or a specific DatabaseError if persistence fails.
     */
    saveMany(records: StorableReconciliationRecord[]): Promise<void>;

    /**
     * Finds a reconciled record by its unique primary key ID.
     * (Example Query Method - Add more as needed)
     *
     * @param id The unique identifier of the record.
     * @returns A promise resolving to the found record or null if not found.
     */
    findById(id: number): Promise<Gstr2bReconciledRecord | null>;

    // Add other necessary query methods here, for example:
    // findByGstinAndInvoice(gstin: string, invoiceNumber: string): Promise<Gstr2bReconciledRecord[]>;
    // findByDateRange(startDate: Date, endDate: Date): Promise<Gstr2bReconciledRecord[]>;
    // findByRemark(remark: ReconciliationRemark | string): Promise<Gstr2bReconciledRecord[]>;
}

// Define a unique symbol or string token for DI registration
export const RECONCILED_RECORD_REPOSITORY_TOKEN = Symbol.for("IReconciledRecordRepository");