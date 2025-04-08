# GST Reconciliation Tool

## Description

This project provides a backend API for reconciling GST data from two sources (e.g., local accounting records and the official GST portal data). It parses input files (Excel/JSON), normalizes relevant fields, performs matching based on defined rules and tolerances, and generates reconciliation reports.

This README focuses on Phase 1: The Backend API.

## Features (Phase 1)

*   Parses GST data from Excel (.xlsx) or JSON files.
*   Normalizes key fields like Invoice Number and Date for accurate matching.
*   Reconciles records based on Supplier GSTIN, Normalized Invoice Number, Date (Month/Year), Taxable Amount (with tolerance), and Total Tax (with tolerance).
*   Categorizes results into:
    *   Perfect Matches
    *   Matches within Tolerance
    *   Missing in Portal Data
    *   Missing in Local Data
*   Provides results as a structured JSON response.
*   Generates a downloadable Excel report summarizing the reconciliation.
*   Basic static HTML/JS frontend for development testing and interaction.

## Architecture Overview (Phase 1)

*   **Backend API:** Built with Node.js, TypeScript, and Express.
*   **Style:** API-first, modular services, dependency injection (using `tsyringe`).
*   **Core Logic:** Encapsulated in framework-agnostic services (`src/core`).
*   **Infrastructure:** Express handles web server duties, routing, middleware (e.g., file uploads with `multer`).
*   **Data Handling:** Primarily in-memory processing per request. No persistent database for reconciliation data in this phase.
*   **Error Handling:** Centralized middleware.
*   **Configuration:** Managed via environment variables (`.env`) using `dotenv`.

## Folder Structure

```
gst-reconciliation-tool/
├── public/                   # Minimal static frontend for Phase 1 testing
│   ├── index.html
│   ├── main.js
│   └── styles.css
├── src/                      # TypeScript source code
│   ├── config/               # App configuration
│   ├── core/                 # Core business logic
│   │   ├── common/           # Shared utilities, interfaces, errors
│   │   ├── parsing/          # File parsing logic
│   │   ├── reconciliation/   # Reconciliation logic & normalization
│   │   └── reporting/        # Report generation logic
│   ├── infrastructure/       # Frameworks, drivers, external integrations
│   │   ├── adapters/         # (Optional) Adapters for external libs
│   │   ├── jobs/             # (Optional) Async job handling
│   │   ├── logger/           # Logging setup (Winston)
│   │   └── webserver/        # Express setup, API routes, controllers, middleware
│   └── main.ts               # Application entry point
├── tests/                    # Automated tests
│   ├── integration/
│   └── unit/
├── .env                      # Local environment variables (GIT IGNORED!)
├── .env.example              # Example environment variables
├── .gitignore
├── package.json
├── tsconfig.json
├── pnpm-lock.yaml
├── Plan.md                   # Detailed planning document
└── README.md                 # This file
```

## Technology Stack

*   **Backend:** Node.js, TypeScript, Express
*   **Dependency Injection:** `tsyringe`
*   **File Parsing:** `xlsx`, `exceljs`
*   **File Uploads:** `multer`
*   **Configuration:** `dotenv`
*   **Date Handling:** `date-fns`
*   **Logging:** `winston`
*   **Utility:** `uuid`
*   **Resilience (Optional):** `cockatiel`, `opossum` (Circuit Breaker/Retry)
*   **Testing:** Jest, ts-jest
*   **Linting/Formatting:** ESLint, Prettier
*   **Package Manager:** pnpm

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd gst-reconciliation-tool
    ```
2.  **Install dependencies:**
    ```bash
    pnpm install
    ```
3.  **Set up environment variables:**
    *   Copy `.env.example` to `.env`.
    *   Fill in the required environment variables in `.env`.

## Running the Application

1.  **Development Mode (with auto-reload):**
    ```bash
    pnpm run dev
    ```
    This uses `ts-node-dev` to run the TypeScript code directly and restart the server on file changes.

2.  **Production Mode:**
    *   First, build the TypeScript code:
        ```bash
        pnpm run build
        ```
    *   Then, run the compiled JavaScript code:
        ```bash
        pnpm start
        ```
    This uses Node.js to run the compiled output from the `dist/` directory, loading environment variables from `.env`.

The application will typically start on `http://localhost:3000` (or the port specified in your `.env`).

## API Endpoints (Examples)

*   **`POST /api/reconcile`**:
    *   **Request:** `multipart/form-data` containing two files: `localData` and `portalData`.
    *   **Response (Success):** `200 OK` with JSON body containing `ReconciliationResults`.
    *   **Response (Error):** Appropriate error status code (e.g., 400, 500) with error details.
*   **`GET /api/reconcile/export`**: (Assuming results are stored or passed via query/session - *Note: Plan.md suggests jobId for async, adapt if sync*)
    *   **Request:** May require parameters identifying the reconciliation results to export.
    *   **Response (Success):** `200 OK` with an Excel file stream (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
    *   **Response (Error):** Appropriate error status code.

*(Note: The exact implementation for export might differ based on whether processing is synchronous or asynchronous)*

## Input File Format (Local Purchase Data - Excel)
The tool expects your local accounting/purchase data to be provided in an Excel file (.xlsx format). While the exact column header names can often be configured in the parsing logic (future enhancement or current implementation detail), the tool fundamentally needs columns containing the following information. Using clear and consistent headers is recommended.

# File Requirements:
* **Format:** `.xlsx` (Microsoft Excel Open XML Format)
# Structure:
The first row must contain the column headers.
Each subsequent row must represent a single invoice record.
Ensure there are no merged cells within the data table area.
Remove any extra title rows, summary rows, or empty rows/columns that are not part of the header and data.
Column Details:
The following table describes the essential and recommended columns:

*Column Header (Example)*	*Description*	*Data Type*	*Required?*	*Maps to Internal Field*	*Notes*
`Supplier GSTIN`	The 15-digit Goods and Services Tax Identification Number of the supplier.	Text	Yes	supplierGstin	Crucial for grouping and matching.
`Invoice Number`	The unique identifier for the invoice as issued by the supplier.	Text	Yes	invoiceNumberRaw	Will be normalized for matching (e.g., removing spaces, special chars).
`Invoice Date`	The date the invoice was issued by the supplier.	Date	Yes	date	Use a standard Excel date format (e.g., DD-MM-YYYY, MM/DD/YYYY). Used for Month/Year matching.
`Taxable Amount`	The value of goods/services before any GST is applied.	Number (Decimal)	Yes	taxableAmount	Used for matching with tolerance.
`IGST Amount`	Integrated Goods and Services Tax amount charged on the invoice.	Number (Decimal)	Yes	igst	Enter 0 if not applicable (i.e., for CGST/SGST levies).
`CGST Amount`	Central Goods and Services Tax amount charged on the invoice.	Number (Decimal)	Yes	cgst	Enter 0 if not applicable (i.e., for IGST levy).
`SGST Amount`	State/Union Territory Goods and Services Tax amount charged on the invoice.	Number (Decimal)	Yes	sgst	Enter 0 if not applicable (i.e., for IGST levy). Use for SGST or UTGST.
`Supplier Name`	The legal or trade name of the supplier.	Text	No (Recommended)	supplierName	Useful for reporting and readability.
`Invoice Value`	The total amount of the invoice (Taxable Amount + IGST + CGST + SGST).	Number (Decimal)	No (Recommended)	invoiceValue	Useful for cross-checking, though the tool can calculate it.
`Record ID / Sr No`	A unique identifier or line number from your source accounting system.	Text or Number	No (Recommended)	originalLineNumber	Helps trace records back to your original data.

Note: Ensure data consistency. Dates should be actual date types in Excel, and numeric columns should contain only numbers. Providing clean and correctly formatted data will lead to more accurate reconciliation results.

## Testing

*   **Run all tests:**
    ```bash
    pnpm test
    ```
    *(Note: The current `test` script in `package.json` seems incorrect (`ts-node--watch src/main.ts`). It should likely be `jest` or similar. This needs correction in `package.json`)*

## Phase 2 Plan (Brief)

Phase 2 involves building a dedicated frontend Single Page Application (SPA) using React and TypeScript to consume the Phase 1 API, providing a more polished user experience. The minimal HTML/JS frontend from Phase 1 will be discarded.
