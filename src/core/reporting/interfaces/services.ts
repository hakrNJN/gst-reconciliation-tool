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