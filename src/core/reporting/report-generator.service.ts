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

        try {
            const workbook = new ExcelJS.Workbook();
            this.setWorkbookProperties(workbook, results.summary.reconciliationTimestamp);

            this.createSummarySheet(workbook, results.summary);
            this.createMatchedDetailsSheet(workbook, results.details);
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

    private setWorkbookProperties(workbook: Workbook, timestamp: Date): void {
        workbook.creator = 'GST Reconciliation Tool';
        workbook.lastModifiedBy = 'GST Reconciliation Tool';
        workbook.created = timestamp;
        workbook.modified = new Date();
        workbook.lastPrinted = new Date();
        // Add company info or other properties if needed
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
        this.addSummaryRow(sheet, 'Total Local Records:', summary.totalLocalRecords);
        this.addSummaryRow(sheet, 'Total Portal (GSTR-2B) Records:', summary.totalPortalRecords);
        this.addSummaryRow(sheet, 'Total Unique Suppliers (Local):', summary.totalSuppliersLocal);
        this.addSummaryRow(sheet, 'Total Unique Suppliers (Portal):', summary.totalSuppliersPortal);
        sheet.addRow([]); // Spacer row
        this.addSummaryRow(sheet, 'Perfectly Matched Records:', summary.perfectlyMatchedCount);
        this.addSummaryRow(sheet, 'Matched within Tolerance:', summary.toleranceMatchedCount);
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
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }]; // Freeze header row

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

    private createMissingInPortalSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Missing in Portal (GSTR-2B)');
        const headers = [
            'Supplier GSTIN', 'Supplier Name', 'Local Inv No', 'Local Date',
            'Local Taxable Amt', 'Local Total Tax', 'Local Inv Value'
        ];
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }]; // Freeze header row

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
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }]; // Freeze header row

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

    // --- Helper Methods ---

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
            if (column && column !== undefined) {
                let maxLength = headers[i]?.length ?? 10;
                // Limit scan for performance (e.g., header + first 20 data rows)
                const scanRowCount = 21;
                column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
                    // Only check up to scanRowCount rows
                    if (rowNumber <= scanRowCount) {
                        const columnLength = cell.value ? cell.value.toString().length : 0;
                        if (columnLength > maxLength) {
                            maxLength = columnLength;
                        }
                    }
                });
                // Add padding, ensure minimum width
                column.width = Math.max(12, maxLength + 4);
            } else {
                // Optionally log if a column is unexpectedly undefined
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