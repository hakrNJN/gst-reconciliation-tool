// src/core/reporting/report-generator.service.ts
import ExcelJS, { Row, Workbook, Worksheet } from 'exceljs'; // Import exceljs
import 'reflect-metadata'; // DI requirement
import { container, inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';

import { LOGGER_TOKEN } from '../../infrastructure/logger';
import { AppError } from '../common/errors'; // If needed for specific reporting errors
import {
    ReconciliationMatch,
    ReconciliationResults
} from '../common/interfaces/models';
import { formatDateToDDMMYYYY } from '../common/utils';
import { IReportGeneratorService, ReportOptions } from './interfaces/services';

// Define standard date and number formats for Excel
const DATE_FORMAT = 'dd-mm-yyyy'; // Common Indian date format
const CURRENCY_FORMAT = '#,##0.00'; // Basic currency format

@singleton()
@injectable()
export class ReportGeneratorService implements IReportGeneratorService {

    constructor(
        @inject(LOGGER_TOKEN) private logger: Logger
    ) {
        this.logger.info('ReportGeneratorService initialized.');
    }

    /**
     * Generates an Excel report from reconciliation results.
     */
    async generateReport(
        results: ReconciliationResults,
        options?: ReportOptions // Options currently not used, but available
    ): Promise<Buffer> {
        this.logger.info('Generating reconciliation Excel report...');
        if (!(results.summary.reconciliationTimestamp instanceof Date)) {
            results.summary.reconciliationTimestamp = new Date(results.summary.reconciliationTimestamp);
        }
        try {
            const workbook = new ExcelJS.Workbook();
            this.setWorkbookProperties(workbook, results.summary.reconciliationTimestamp);
            this.createSummarySheet(workbook, results.summary);
            this.createPerfectlyMatchedSheet(workbook, results.details);
            this.createToleranceMatchedSheet(workbook, results.details);
            this.createMismatchedAmountSheet(workbook, results.details);
            this.createPotentialMatchSheet(workbook, results.details);
            this.createMissingInPortalSheet(workbook, results.details);
            this.createMissingInLocalSheet(workbook, results.details);

            // Write workbook to buffer
            const buffer = await workbook.xlsx.writeBuffer();
            this.logger.info('Excel report generated successfully.');
            return buffer as Buffer; // Cast needed as writeBuffer returns ArrayBuffer | Buffer

        } catch (error: any) {
            this.logger.error('Failed to generate Excel report:', { message: error.message, stack: error.stack });
            throw new AppError('ReportGenerationError', 'Failed to generate Excel report', 500, false); // Non-operational if internal error
        }
    }

    private setWorkbookProperties(workbook: Workbook, timestamp: Date | string): void {
        workbook.creator = 'GST Reconciliation Tool';
        workbook.lastModifiedBy = 'GST Reconciliation Tool';

        // Ensure timestamp is a Date object
        const created = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
        workbook.created = created;
        workbook.modified = new Date();
        workbook.lastPrinted = new Date();
    }

    // --- Sheet Creation Methods ---

    private createSummarySheet(workbook: Workbook, summary: ReconciliationResults['summary']): void {
        const sheet = workbook.addWorksheet('Summary');
        sheet.addRow(['GST Reconciliation Summary']).font = { bold: true, size: 14 };
        sheet.mergeCells('A1:B1'); // Merge for title
        sheet.addRow([]); // Spacer row

        // Add summary data
        this.addSummaryRow(sheet, 'Reconciliation Timestamp:', summary.reconciliationTimestamp, DATE_FORMAT + ' hh:mm:ss');
        sheet.addRow([]); // Spacer row
        this.addSummaryRow(sheet, 'Total Purchase Records:', summary.totalLocalRecords);
        this.addSummaryRow(sheet, 'Total Portal (GSTR-2B) Records:', summary.totalPortalRecords);
        this.addSummaryRow(sheet, 'Total Unique Suppliers (Local):', summary.totalSuppliersLocal);
        this.addSummaryRow(sheet, 'Total Unique Suppliers (Portal):', summary.totalSuppliersPortal);
        sheet.addRow([]); // Spacer row
        this.addSummaryRow(sheet, 'Perfectly Matched Records:', summary.perfectlyMatchedCount);
        this.addSummaryRow(sheet, 'Matched within Tolerance:', summary.toleranceMatchedCount);
        this.addSummaryRow(sheet, 'Mismatch in Portal vs Book:', summary.mismatchedAmountsCount);
        this.addSummaryRow(sheet, 'Potential Matches Found:', summary.potentialMatchCount); // Add new row
        this.addSummaryRow(sheet, 'Missing in Portal (GSTR-2B):', summary.missingInPortalCount);
        this.addSummaryRow(sheet, 'Missing in Local Books:', summary.missingInLocalCount);

        // Style the summary sheet
        sheet.columns.forEach(column => {
            if (column.values && column.values.length > 2) { // Check if column has values besides header/spacer
                column.width = (column.values[2] as string | undefined)?.length ?? 25; // Adjust width based on label length
            }
        });
        sheet.getColumn('B').width = 25; // Ensure value column has enough width
        sheet.getColumn('B').alignment = { horizontal: 'right' };
    }

    private addSummaryRow(sheet: Worksheet, label: string, value: string | number | Date, format?: string): Row {
        const row = sheet.addRow([label, value]);
        row.getCell(1).font = { bold: true };
        if (format) {
            row.getCell(2).numFmt = format;
        } else if (typeof value === 'number') {
            row.getCell(2).numFmt = Number.isInteger(value) ? '0' : CURRENCY_FORMAT; // Basic number format
        }
        return row;
    }

    private createMatchedDetailsSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Matched Details');

        // Define headers (grouped)
        const headers = [
            'Supplier GSTIN', 'Supplier Name', 'Match Status',
            // Local Data
            'Local Inv No', 'Local Date', 'Local Taxable Amt', 'Local Total Tax', 'Local Inv Value',
            // Portal Data
            'Portal Inv No', 'Portal Date', 'Portal Taxable Amt', 'Portal Total Tax', 'Portal Inv Value',
            // Differences / Tolerance
            'Taxable Diff', 'Tax Diff', 'Tolerance Notes'
        ];
        // const headerRow = sheet.addRow(headers);
        // headerRow.font = { bold: true };
        // sheet.views = [{ state: 'frozen', ySplit: 1 }]; // Freeze header row
        this.styleHeaderRow(sheet.addRow(headers),headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        // Add data rows
        details.forEach((supplierData, gstin) => {
            supplierData.matches.forEach(match => {
                const toleranceNotes = this.formatToleranceNotes(match);
                const row = sheet.addRow([
                    gstin,
                    supplierData.supplierName ?? '',
                    match.status,
                    // Local
                    match.localRecord.invoiceNumberRaw,
                    match.localRecord.date,
                    match.localRecord.taxableAmount,
                    match.localRecord.totalTax,
                    match.localRecord.invoiceValue,
                    // Portal
                    match.portalRecord.invoiceNumberRaw,
                    match.portalRecord.date,
                    match.portalRecord.taxableAmount,
                    match.portalRecord.totalTax,
                    match.portalRecord.invoiceValue,
                    // Differences
                    match.localRecord.taxableAmount - match.portalRecord.taxableAmount,
                    match.localRecord.totalTax - match.portalRecord.totalTax,
                    toleranceNotes
                ]);

                // Apply formatting
                this.formatDataRow(row, [5, 10], [6, 7, 8, 11, 12, 13, 14, 15]);
            });
        });

        this.autoFitColumns(sheet, headers);
    }

    private createPerfectlyMatchedSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Perfectly Matched');
        const headers = ['Supplier GSTIN', 'Supplier Name', 'Inv No', 'Date', 'Taxable Amt', 'Total Tax', 'Inv Value', 'Source', 'Filing Date'];
        this.styleHeaderRow(sheet.addRow(headers),headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        details.forEach((supplierData, gstin) => {
            supplierData.matches
                .filter(match => match.status === 'MatchedPerfectly')
                .forEach(match => {
                    // Use local or portal record - should be identical for perfectly matched
                    const record = match.localRecord;
                    const portal = match.portalRecord;
                    //  let supDate = parsePortalDate(portal.supfileDate)?.toLocaleDateString()
                    let parseDate = formatDateToDDMMYYYY(portal.supfileDate)
                    const row = sheet.addRow([
                        gstin, supplierData.supplierName ?? '', record.invoiceNumberRaw, record.date,
                        record.taxableAmount, record.totalTax, record.invoiceValue, portal.supSource, parseDate
                    ]);
                    this.formatDataRow(row, [4], [5, 6, 7]); // Date Col 4, Currency Cols 5,6,7
                });
        });
        this.autoFitColumns(sheet, headers);
    }

    private createToleranceMatchedSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Matched (Tolerance)');
        const headers = [
            'Supplier GSTIN', 'Supplier Name',
            'Local Inv No', 'Local Date', 'Local Taxable', 'Local Tax', 'Local Value',
            'Portal Inv No', 'Portal Date', 'Portal Taxable', 'Portal Tax', 'Portal Value',
            'Taxable Diff', 'Tax Diff', 'Tolerance Notes'
        ];
        this.styleHeaderRow(sheet.addRow(headers),headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];


        details.forEach((supplierData, gstin) => {
            supplierData.matches
                .filter(match => match.status === 'MatchedWithTolerance')
                .forEach(match => {
                    const toleranceNotes = this.formatToleranceNotes(match);
                    const taxableDiff = match.localRecord.taxableAmount - match.portalRecord.taxableAmount;
                    const taxDiff = match.localRecord.totalTax - match.portalRecord.totalTax;

                    const row = sheet.addRow([
                        gstin, supplierData.supplierName ?? '',
                        match.localRecord.invoiceNumberRaw, match.localRecord.date, match.localRecord.taxableAmount, match.localRecord.totalTax, match.localRecord.invoiceValue,
                        match.portalRecord.invoiceNumberRaw, match.portalRecord.date, match.portalRecord.taxableAmount, match.portalRecord.totalTax, match.portalRecord.invoiceValue,
                        taxableDiff, taxDiff, toleranceNotes
                    ]);
                    // Date cols 4, 9. Currency cols 5,6,7, 10,11,12, 13,14
                    this.formatDataRow(row, [4, 9], [5, 6, 7, 10, 11, 12, 13, 14]);
                });
        });
        this.autoFitColumns(sheet, headers);
    }

    private createMismatchedAmountSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Mismatched Amounts');
        const headers = [
            'Supplier GSTIN', 'Supplier Name',
            'Local Inv No', 'Local Date', 'Local Taxable', 'Local Tax', 'Local Value',
            'Portal Inv No', 'Portal Date', 'Portal Taxable', 'Portal Tax', 'Portal Value',
            'Taxable Diff', 'Tax Diff'
        ];
        this.styleHeaderRow(sheet.addRow(headers),headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];


        details.forEach((supplierData, gstin) => {
            supplierData.mismatchedAmounts?.forEach(mismatch => {
                const taxableDiff = mismatch.localRecord.taxableAmount - mismatch.portalRecord.taxableAmount;
                const taxDiff = mismatch.localRecord.totalTax - mismatch.portalRecord.totalTax;
                const row = sheet.addRow([gstin, supplierData.supplierName ?? '',
                    mismatch.localRecord.invoiceNumberRaw, mismatch.localRecord.date, mismatch.localRecord.taxableAmount, mismatch.localRecord.totalTax, mismatch.localRecord.invoiceValue,
                    mismatch.portalRecord.invoiceNumberRaw, mismatch.portalRecord.date, mismatch.portalRecord.taxableAmount, mismatch.portalRecord.totalTax, mismatch.portalRecord.invoiceValue,
                    taxableDiff, taxDiff]);
                this.formatDataRow(row, [4, 9], [5, 6, 7, 10, 11, 12, 13, 14]);
            });
        });;
        this.autoFitColumns(sheet, headers);
    }

    private createMissingInPortalSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Missing in Portal (GSTR-2B)');
        const headers = [
            'Supplier GSTIN', 'Supplier Name', 'Local Inv No', 'Local Date',
            'Local Taxable Amt', 'Local Total Tax', 'Local Inv Value'
        ];
        this.styleHeaderRow(sheet.addRow(headers),headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];


        details.forEach((supplierData, gstin) => {
            supplierData.missingInPortal.forEach(record => {
                const row = sheet.addRow([
                    gstin,
                    supplierData.supplierName ?? record.supplierName ?? '',
                    record.invoiceNumberRaw,
                    record.date,
                    record.taxableAmount,
                    record.totalTax,
                    record.invoiceValue
                ]);
                // Apply formatting
                this.formatDataRow(row, [4], [5, 6, 7]);
            });
        });

        this.autoFitColumns(sheet, headers);
    }

    private createMissingInLocalSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Missing in Local Books');
        const headers = [
            'Supplier GSTIN', 'Supplier Name', 'Portal Inv No', 'Portal Date',
            'Portal Taxable Amt', 'Portal Total Tax', 'Portal Inv Value'
        ];
        this.styleHeaderRow(sheet.addRow(headers),headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];


        details.forEach((supplierData, gstin) => {
            supplierData.missingInLocal.forEach(record => {
                const row = sheet.addRow([
                    gstin,
                    supplierData.supplierName ?? record.supplierName ?? '',
                    record.invoiceNumberRaw,
                    record.date,
                    record.taxableAmount,
                    record.totalTax,
                    record.invoiceValue
                ]);
                // Apply formatting
                this.formatDataRow(row, [4], [5, 6, 7]);
            });
        });

        this.autoFitColumns(sheet, headers);
    }

    // *** ADD NEW SHEET FUNCTION ***
    private createPotentialMatchSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Potential Matches');
        const headers = [
            'Supplier GSTIN', 'Supplier Name',
            'Local Inv No', 'Local Date', 'Local Taxable', 'Local Tax',
            'Portal Inv No', 'Portal Date', 'Portal Taxable', 'Portal Tax',
            'Similarity Method', 'Similarity Score' // Add similarity info
        ];
        this.styleHeaderRow(sheet.addRow(headers),headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        details.forEach((supplierData, gstin) => {
            supplierData.potentialMatches?.forEach(potential => { // Iterate new array
                const row = sheet.addRow([
                    gstin, supplierData.supplierName ?? '',
                    potential.localRecord.invoiceNumberRaw, potential.localRecord.date, potential.localRecord.taxableAmount, potential.localRecord.totalTax,
                    potential.portalRecord.invoiceNumberRaw, potential.portalRecord.date, potential.portalRecord.taxableAmount, potential.portalRecord.totalTax,
                    potential.similarityMethod ?? '', // Show how match was found
                    potential.similarityScore ?? ''  // Show score (e.g., Levenshtein distance)
                ]);
                // Date cols 4, 8. Currency cols 5,6, 9,10. Score col 12 maybe general.
                this.formatDataRow(row, [4, 8], [5, 6, 9, 10]);
                // Format score as number if it's numeric
                if (typeof potential.similarityScore === 'number') { row.getCell(12).numFmt = '0'; }
            });
        });
        this.autoFitColumns(sheet, headers);
    }

    // --- Helper Methods ---
    private styleHeaderRow(row: Row, headers: string[]): void {
        // Style each header cell based on the headers array length
        for (let i = 1; i <= headers.length; i++) {
            const cell = row.getCell(i);
            
            cell.font = { 
                bold: true,
                color: { argb: 'FFFFFFFF' }  // White text (Background 1)
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            
            // Add dark blue fill (Text 2)
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1F4E79' }  // Dark Blue, Text 2 color
            };
            
            // Optional: Add borders for a more defined look
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        }
    }
    // private styleHeaderRow(row: Row): void { // Extracted helper
    //     row.font = {
    //         bold: true,
    //         color: { argb: 'FFFFFFFF' }  // White text (Background 1)
    //     };
    //     row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    //     // Add dark blue fill (Text 2)
    //     row.fill = {
    //         type: 'pattern',
    //         pattern: 'solid',
    //         fgColor: { argb: '1F497D' }  // Dark Blue, Text 2 color
    //     };

    //     // Optional: Add borders for a more defined look
    //     row.border = {
    //         top: { style: 'thin' },
    //         left: { style: 'thin' },
    //         bottom: { style: 'thin' },
    //         right: { style: 'thin' }
    //     };
    // }
    /** Applies standard date and currency formats to cells in a row */
    private formatDataRow(row: Row, dateColIndices: number[], currencyColIndices: number[]): void {
        dateColIndices.forEach(idx => {
            row.getCell(idx).numFmt = DATE_FORMAT;
        });
        currencyColIndices.forEach(idx => {
            row.getCell(idx).numFmt = CURRENCY_FORMAT;
        });
    }

    /** Auto-fits column widths based on header and some sample data */
    private autoFitColumns(sheet: Worksheet, headers: string[]): void {
        sheet.columns.forEach((column, i) => {
            if (column) {
                let maxLength = headers[i]?.length ?? 10;
                const scanRowCount = 21;

                try {
                    // Type guard to ensure column has eachCell method
                    if (typeof column.eachCell === 'function') {
                        column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
                            if (rowNumber <= scanRowCount) {
                                const cellValue = cell.value;
                                let columnLength = 0;

                                // Special handling for date values
                                if (cellValue instanceof Date) {
                                    // Date format strings are typically ~10 chars (DD-MM-YYYY)
                                    columnLength = 10;
                                } else if (cellValue !== null && cellValue !== undefined) {
                                    columnLength = cellValue.toString().length;
                                }

                                if (columnLength > maxLength) {
                                    maxLength = columnLength;
                                }
                            }
                        });

                        // Set column widths based on content type
                        if (headers[i]?.toLowerCase().includes('date')) {
                            // Fixed width for date columns
                            column.width = 12;
                        } else {
                            column.width = Math.max(12, maxLength + 4);
                        }
                    } else {
                        this.logger.warn(`Column at index ${i} doesn't have expected eachCell method`);
                        // Fallback if eachCell is not available
                        if ('width' in column) {
                            column.width = Math.max(12, maxLength + 4);
                        }
                    }
                } catch (cellError) {
                    this.logger.error(`Error processing cells for column index ${i} during autoFit`, cellError);
                    // Fallback width if cell processing fails
                    if ('width' in column) {
                        column.width = Math.max(12, maxLength + 4);
                    }
                }
            } else {
                this.logger.warn(`Column at index ${i} was unexpectedly undefined during autoFit.`);
            }
        });
    }

    /** Formats tolerance details into a readable string */
    private formatToleranceNotes(match: ReconciliationMatch): string {
        const notes: string[] = [];
        if (match.toleranceDetails.taxableAmount) notes.push('Taxable Amt Diff');
        if (match.toleranceDetails.taxAmount) notes.push('Total Tax Diff');
        if (match.toleranceDetails.rawInvoiceNumberDiffers) notes.push('Inv No Differs');
        if (match.toleranceDetails.exactDateDiffers) notes.push('Date Differs');
        return notes.join('; ');
    }


}

// --- DI Registration ---
// Registering the class itself as a singleton.
container.registerSingleton(ReportGeneratorService);
// Optionally, use an interface token if preferred:
// import { REPORT_GENERATOR_SERVICE_TOKEN } from './interfaces/services'; // Define token first
// container.register(REPORT_GENERATOR_SERVICE_TOKEN, { useClass: ReportGeneratorService }, { lifecycle: Lifecycle.Singleton });
