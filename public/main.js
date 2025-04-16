// public/main.js
document.addEventListener('DOMContentLoaded', () => {
    // --- Form Elements ---
    const form = document.getElementById('reconcileForm');
    const localFileInput = document.getElementById('localFile');
    const portalFileInput = document.getElementById('portalFile');
    const submitButton = document.getElementById('submitButton');
    const submitSpinner = submitButton.querySelector('.spinner-border');
    const toleranceAmountInput = document.getElementById('toleranceAmount');
    const toleranceTaxInput = document.getElementById('toleranceTax');

    // --- Status/Result Elements ---
    const statusArea = document.getElementById('statusArea');
    const resultsSection = document.getElementById('results-section');
    const resultsCategorySelect = document.getElementById('resultsCategorySelect');
    const resultsTableContainer = document.getElementById('resultsTableContainer');
    const resultsTable = document.getElementById('resultsTable');
    const resultsTableHead = document.getElementById('resultsTableHead');
    const resultsTableBody = document.getElementById('resultsTableBody');
    const tableCaption = document.getElementById('tableCaption');
    const noResultsMessage = document.getElementById('noResultsMessage');
    const exportButton = document.getElementById('exportButton');
    const exportSpinner = exportButton.querySelector('.spinner-border');
    const exportStatusArea = document.getElementById('exportStatusArea');

    let currentResultsData = null; // Store full results for reuse

    // --- Helper Functions ---
    function showStatus(message, type = 'info') {
        statusArea.innerHTML = ''; statusArea.className = `alert alert-${type}`;
        statusArea.textContent = message; statusArea.classList.remove('visually-hidden');
    }

    function showExportStatus(message, type = 'info') {
        exportStatusArea.innerHTML = ''; // Clear previous export status
        exportStatusArea.className = `alert alert-${type}`;
        exportStatusArea.textContent = message;
        exportStatusArea.classList.remove('visually-hidden');
    }
    function hideStatus() { statusArea.classList.add('visually-hidden'); }
    function hideExportStatus() { exportStatusArea.classList.add('visually-hidden'); }
    function formatDate(dateString) { // Format date string/object for display
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return dateString; // Return original if invalid
            // Adjust options as needed for locale (e.g., 'en-IN')
            return date.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
        } catch (e) { return dateString; /* Return original on error */ }
    }
    function formatCurrency(number) {
        if (number === null || number === undefined || isNaN(Number(number))) return '';
        // Adjust options as needed for locale (e.g., 'en-IN', style: 'currency', currency: 'INR')
        return Number(number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // --- Reset UI State ---
    function resetResultsUI() {
        resultsSection.classList.add('visually-hidden');
        resultsCategorySelect.value = ""; // Reset dropdown
        resultsTableContainer.classList.add('visually-hidden');
        resultsTableHead.innerHTML = '';
        resultsTableBody.innerHTML = '';
        tableCaption.textContent = '';
        noResultsMessage.style.display = 'none';
        exportButton.style.display = 'none';
        currentResultsData = null;
        hideStatus();
        hideExportStatus();
    }

    // --- Display Table Data ---
    function displayTableData(category) {
        if (!currentResultsData || !currentResultsData.details) {
            console.error("No results data available.");
            return;
        }

        resultsTableHead.innerHTML = ''; // Clear headers
        resultsTableBody.innerHTML = ''; // Clear body
        resultsTableContainer.classList.add('visually-hidden'); // Hide while populating
        noResultsMessage.style.display = 'none';

        let headers = [];
        let dataRows = [];
        const details = currentResultsData.details; // This is an object now { gstin: {...} }

        // --- Collect Data Based on Category ---
        Object.entries(details).forEach(([gstin, supplierData]) => {
            const supplierName = supplierData.supplierName ?? '';
            switch (category) {
                case 'perfect':
                    supplierData.matches
                        ?.filter(m => m.status === 'MatchedPerfectly')
                        .forEach(m => dataRows.push({
                            gstin,
                            supplierName,
                            supfileDate: m.portalRecord.supfileDate,
                            supSource: m.portalRecord.supSource,
                            ...m.localRecord
                        })); // Use local/portal data
                    break;
                case 'tolerance':
                    supplierData.matches
                        ?.filter(m => m.status === 'MatchedWithTolerance')
                        .forEach(m => dataRows.push({
                            gstin, supplierName, ...m, // Spread match to get local/portal records and details
                            taxableDiff: (m.localRecord.taxableAmount - m.portalRecord.taxableAmount),
                            taxDiff: (m.localRecord.totalTax - m.portalRecord.totalTax)
                        }));
                    break;
                case 'mismatch':
                    supplierData.mismatchedAmounts
                        ?.forEach(m => dataRows.push({ gstin, supplierName, ...m }));
                    break;
                case 'potential':
                    supplierData.potentialMatches
                        ?.forEach(m => dataRows.push({ gstin, supplierName, ...m }));
                    break;
                case 'missingPortal':
                    supplierData.missingInPortal
                        ?.forEach(r => dataRows.push({ gstin, supplierName, ...r }));
                    break;
                case 'missingLocal':
                    supplierData.missingInLocal
                        ?.forEach(r => dataRows.push({ gstin, supplierName, ...r }));
                    break;
            }
        });

        // --- Define Headers and Populate Table ---
        if (dataRows.length > 0) {
            const sampleRow = dataRows[0]; // Use first row to determine columns

            // Create header row
            const trHead = document.createElement('tr');
            if (category === 'perfect' || category === 'missingPortal' || category === 'missingLocal') {
                headers = ['Supplier GSTIN', 'Supplier Name', 'Invoice No', 'Date', 'Taxable Amt', 'Total Tax', 'Invoice Value',
                    'Source', 'Filing Date'
                ];
                headers.forEach(h => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; trHead.appendChild(th); });
            } else if (category === 'tolerance' || category === 'mismatch' || category === 'potential') {
                headers = [
                    'Supplier GSTIN', 'Supplier Name',
                    'Local Inv No', 'Local Date', 'Local Taxable', 'Local Tax', 'Local Value',
                    'Portal Inv No', 'Portal Date', 'Portal Taxable', 'Portal Tax', 'Portal Value',
                    'Taxable Diff', 'Tax Diff'
                ];
                // Add Tolerance Notes only for 'tolerance' category
                if (category === 'tolerance') headers.push('Tolerance Notes');
                headers.forEach(h => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; trHead.appendChild(th); });
            }
            resultsTableHead.appendChild(trHead);


            // Create data rows
            dataRows.forEach(rowData => {
                const trBody = document.createElement('tr');
                if (category === 'perfect' || category === 'missingPortal' || category === 'missingLocal') {

                    trBody.innerHTML = `
                        <td>${rowData.gstin ?? ''}</td>
                        <td>${rowData.supplierName ?? ''}</td>
                        <td>${rowData.invoiceNumberRaw ?? ''}</td>
                        <td>${formatDate(rowData.date)}</td>
                        <td>${formatCurrency(rowData.taxableAmount)}</td>
                        <td>${formatCurrency(rowData.totalTax)}</td>
                        <td>${formatCurrency(rowData.invoiceValue)}</td>
                        ${rowData.supSource !== 'undefined' ? `<td>${rowData.supSource}</td>` : ''}
                        ${category === 'perfect' ? `<td>${formatDate(rowData.supfileDate)}</td>` : ''}
                    `;
                } else if (category === 'tolerance' || category === 'mismatch' || category === 'potential') {
                    const local = rowData.localRecord || {}; // Handle potential direct properties in mismatch
                    const portal = rowData.portalRecord || {};
                    const taxableDiff = rowData.taxableAmountDifference ?? rowData.taxableDiff ?? 0; // Use specific diff if available
                    const taxDiff = rowData.totalTaxDifference ?? rowData.taxDiff ?? 0;
                    const toleranceNotes = category === 'tolerance' ? (rowData.toleranceDetails ? Object.entries(rowData.toleranceDetails).filter(([k, v]) => v === true).map(([k]) => k).join('; ') : '') : ''; // Simplified notes

                    trBody.innerHTML = `
                        <td>${rowData.gstin ?? ''}</td>
                        <td>${rowData.supplierName ?? ''}</td>
                        <td>${local.invoiceNumberRaw ?? ''}</td>
                        <td>${formatDate(local.date)}</td>
                        <td>${formatCurrency(local.taxableAmount)}</td>
                        <td>${formatCurrency(local.totalTax)}</td>
                        <td>${formatCurrency(local.invoiceValue)}</td>
                        <td>${portal.invoiceNumberRaw ?? ''}</td>
                        <td>${formatDate(portal.date)}</td>
                        <td>${formatCurrency(portal.taxableAmount)}</td>
                        <td>${formatCurrency(portal.totalTax)}</td>
                        <td>${formatCurrency(portal.invoiceValue)}</td>
                        <td>${formatCurrency(taxableDiff)}</td>
                        <td>${formatCurrency(taxDiff)}</td>
                        ${category === 'tolerance' ? `<td>${toleranceNotes}</td>` : ''}
                    `;
                }
                resultsTableBody.appendChild(trBody);
            });

            resultsTableContainer.classList.remove('visually-hidden');
            tableCaption.textContent = `${resultsCategorySelect.options[resultsCategorySelect.selectedIndex].text} (${dataRows.length} Records)`;

        } else {
            // Show no results message if data for category is empty
            noResultsMessage.textContent = `No records found for category: ${resultsCategorySelect.options[resultsCategorySelect.selectedIndex].text}.`;
            noResultsMessage.style.display = 'block';
            tableCaption.textContent = ''; // Clear caption
        }
    }

    // --- Event Listeners ---

    // Form Submission
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        resetResultsUI(); // Reset UI before starting

        /// --- Updated Validation for files ---
        // Check if at least one file is selected for BOTH inputs
        if (!localFileInput.files || localFileInput.files.length === 0 || !portalFileInput.files || portalFileInput.files.length === 0) {
            showStatus('Please select at least one file for both Local Data and Portal Data.', 'warning');
            return;
        }

        // (Tolerance validation remains the same)
        const toleranceAmount = parseFloat(toleranceAmountInput.value);
        const toleranceTax = parseFloat(toleranceTaxInput.value);
        if (isNaN(toleranceAmount) || isNaN(toleranceTax) || toleranceAmount < 0 || toleranceTax < 0) {
            showStatus('Please enter valid, non-negative tolerance values.', 'warning'); return;
        }


        showStatus('Uploading and processing files...', 'info');
        submitButton.disabled = true;
        submitSpinner.style.display = 'inline-block';

        // Create FormData from the form (includes tolerance, date strategy, scope options)
        const formData = new FormData(form);

        // --- Explicitly handle multiple LOCAL files ---
        formData.delete('localData'); // Clear default single entry if present
        const localFiles = localFileInput.files;
        if (localFiles) { // Should always be true based on validation above
            for (let i = 0; i < localFiles.length; i++) {
                formData.append('localData', localFiles[i], localFiles[i].name); // Use field name 'localData'
            }
        }
        // --- End handling multiple local files ---

        // --- Explicitly handle multiple PORTAL files ---
        formData.delete('portalData'); // Clear default single entry if present
        const portalFiles = portalFileInput.files;
        if (portalFiles) { // Should always be true based on validation above
            for (let i = 0; i < portalFiles.length; i++) {
                formData.append('portalData', portalFiles[i], portalFiles[i].name); // Use field name 'portalData'
            }
        }
        // --- End handling multiple portal files ---


        // Append each selected portal file using the SAME field name
        if (!portalFiles || !localFiles || portalFiles.length === 0 || localFiles.length === 0) {
            // This case should ideally be caught by 'required', but added for robustness
            showStatus('Please select at least one Portal Data file.', 'warning');
            // Reset UI and stop processing
            submitButton.disabled = false;
            submitSpinner.style.display = 'none';
            return;
        }
        // --- End handling multiple portal files ---

        // Other options like tolerance, date strategy, scope are already correctly
        // included by 'new FormData(form)' if they have `name` attributes,
        // const selectedDateStrategy = document.querySelector('input[name="dateMatchStrategy"]:checked');
        // formData.append('dateMatchStrategy', selectedDateStrategy ? selectedDateStrategy.value : 'month');

        // const selectedScopeRadio = document.querySelector('input[name="reconciliationScope"]:checked');
        // const scopeValue = selectedScopeRadio ? selectedScopeRadio.value : 'all'; // Default to 'all'
        // formData.append('reconciliationScope', scopeValue);
        // OR you can append them manually as done before:
        // formData.append('toleranceAmount', toleranceAmountInput.value);
        // formData.append('toleranceTax', toleranceTaxInput.value);
        // const selectedDateStrategy = document.querySelector('input[name="dateMatchStrategy"]:checked');
        // formData.append('dateMatchStrategy', selectedDateStrategy ? selectedDateStrategy.value : 'month');
        try {
            const response = await fetch('/api/reconcile', { method: 'POST', body: formData });

            if (response.ok) {
                const results = await response.json();
                currentResultsData = results; // Store results

                showStatus('Reconciliation successful! Select a category below to view details.', 'success');
                resultsSection.classList.remove('visually-hidden'); // Show results section
                exportButton.style.display = 'inline-block'; // Show export button (always available now)
                // Don't display table immediately, wait for selection
                noResultsMessage.textContent = 'Select a category from the dropdown to view results.';
                noResultsMessage.style.display = 'block';

            } else { /* ... Error handling... */
                let errorMsg = `HTTP Error: ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorMsg = `Error: ${errorData.message || errorMsg}`;
                } catch (e) { }
                showStatus(errorMsg, 'danger');
            }
        } catch (error) { /* ... Network error handling... */
            console.error('Fetch error:', error);
            showStatus(`Network or client-side error: ${error.message}`, 'danger');
            resultsArea.innerHTML = '<p class="text-danger">An error occurred.</p>';
        } finally {
            submitButton.disabled = false;
            submitSpinner.style.display = 'none';
        }
    });

    // Dropdown Change Listener
    resultsCategorySelect.addEventListener('change', (event) => {
        const selectedCategory = event.target.value;
        if (selectedCategory) {
            displayTableData(selectedCategory);
        } else {
            // Optionally clear table if '-- Select Category --' is chosen
            resultsTableContainer.classList.add('visually-hidden');
            resultsTableHead.innerHTML = '';
            resultsTableBody.innerHTML = '';
            tableCaption.textContent = '';
            noResultsMessage.textContent = 'Select a category from the dropdown to view results.';
            noResultsMessage.style.display = 'block';
        }
    });

    // Export Button Click Listener
    exportButton.addEventListener('click', async () => {
        if (!currentResultsData) {
            showExportStatus('No results data available to export.', 'warning');
            return;
        }

        showExportStatus('Generating export...', 'info');
        exportButton.disabled = true;
        exportSpinner.style.display = 'inline-block';

        const selectedScopeRadio = document.querySelector('input[name="reconciliationScope"]:checked');
        const scopeValue = selectedScopeRadio ? selectedScopeRadio.value : 'all';


        try {
            const response = await fetch('/api/reconcile/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scope: scopeValue,
                    results: currentResultsData
                })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;

                const disposition = response.headers.get('content-disposition');
                let filename = 'reconciliation-report.xlsx';

                if (disposition?.includes('filename=')) {
                    const fnMatch = disposition.match(/filename=["']?([^"';\n]+)["']?/i);
                    if (fnMatch?.[1]) {
                        filename = fnMatch[1].trim();
                        // Ensure filename has proper extension
                        if (!filename.toLowerCase().endsWith('.xlsx')) {
                            filename += '.xlsx';
                        }
                    }
                }

                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();

                showExportStatus('Report downloaded successfully.', 'success');
            } else {
                let errorMsg = `Export failed: ${response.status} ${response.statusText}`;

                try {
                    const errData = await response.json();
                    errorMsg = `Error: ${errData.message || errorMsg}`;
                } catch (e) {
                    // JSON parsing failed, using default error message
                }

                showExportStatus(errorMsg, 'danger');
            }
        } catch (error) {
            console.error('Export fetch error:', error);
            showExportStatus(`Network or client-side error during export: ${error.message}`, 'danger');
        } finally {
            exportButton.disabled = false;
            exportSpinner.style.display = 'none';
        }
    });

}); // End DOMContentLoaded