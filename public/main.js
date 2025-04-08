// public/main.js
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('reconcileForm');
    const localFileInput = document.getElementById('localFile');
    const portalFileInput = document.getElementById('portalFile');
    const submitButton = document.getElementById('submitButton');
    const submitSpinner = submitButton.querySelector('.spinner-border');
    const statusArea = document.getElementById('statusArea');
    const resultsArea = document.getElementById('resultsArea');
    const resultsJsonElement = document.getElementById('resultsJson');
    const exportButton = document.getElementById('exportButton');
    const exportSpinner = exportButton.querySelector('.spinner-border');
    const exportStatusArea = document.getElementById('exportStatusArea');

    let currentResultsData = null; // Store results for export

    // Helper function to update status messages
    function showStatus(message, type = 'info') { // type: info, success, danger
        statusArea.innerHTML = ''; // Clear previous status
        exportStatusArea.innerHTML = ''; // Clear export status
        statusArea.className = `alert alert-${type}`; // Apply Bootstrap alert style
        statusArea.textContent = message;
        statusArea.classList.remove('visually-hidden');
    }
     function showExportStatus(message, type = 'info') {
        exportStatusArea.innerHTML = ''; // Clear previous export status
        exportStatusArea.className = `alert alert-${type}`;
        exportStatusArea.textContent = message;
        exportStatusArea.classList.remove('visually-hidden');
    }

    // Handle Form Submission for Reconciliation
    form.addEventListener('submit', async (event) => {
        event.preventDefault(); // Prevent default HTML form submission

        // Basic validation (already handled by 'required', but good practice)
        if (!localFileInput.files.length || !portalFileInput.files.length) {
            showStatus('Please select both files.', 'warning');
            return;
        }

        // Prepare UI for loading state
        showStatus('Uploading and processing files...', 'info');
        submitButton.disabled = true;
        submitSpinner.style.display = 'inline-block';
        resultsArea.innerHTML = '<p class="text-muted">Processing...</p>'; // Clear previous results
        resultsJsonElement.textContent = '';
        exportButton.style.display = 'none'; // Hide export button
        currentResultsData = null; // Clear previous results data

        // Create FormData
        const formData = new FormData(form);

        try {
            // Call the backend API
            const response = await fetch('/api/reconcile', {
                method: 'POST',
                body: formData, // Browser sets Content-Type for FormData automatically
            });

            // Check if the request was successful
            if (response.ok) {
                const results = await response.json();
                currentResultsData = results; // Store for export

                showStatus('Reconciliation successful!', 'success');
                resultsArea.innerHTML = '<pre><code id="resultsJson"></code></pre>'; // Reset structure
                document.getElementById('resultsJson').textContent = JSON.stringify(results, null, 2); // Pretty print JSON
                exportButton.style.display = 'block'; // Show export button

            } else {
                // Handle HTTP errors (like 400, 500)
                let errorMsg = `HTTP Error: ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorMsg = `Error: ${errorData.message || errorMsg}`;
                } catch (e) {
                    // Ignore if error response wasn't JSON
                }
                showStatus(errorMsg, 'danger');
                resultsArea.innerHTML = '<p class="text-danger">Processing failed.</p>';
            }
        } catch (error) {
            // Handle network errors or other fetch issues
            console.error('Fetch error:', error);
            showStatus(`Network or client-side error: ${error.message}`, 'danger');
            resultsArea.innerHTML = '<p class="text-danger">An error occurred.</p>';
        } finally {
            // Reset UI after completion or error
            submitButton.disabled = false;
            submitSpinner.style.display = 'none';
        }
    });

    // Handle Export Button Click
    exportButton.addEventListener('click', async () => {
        if (!currentResultsData) {
            showExportStatus('No results data available to export.', 'warning');
            return;
        }

        showExportStatus('Generating export...', 'info');
        exportButton.disabled = true;
        exportSpinner.style.display = 'inline-block';

        try {
            const response = await fetch('/api/reconcile/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json', // Send results data as JSON
                },
                body: JSON.stringify(currentResultsData),
            });

            if (response.ok) {
                const blob = await response.blob(); // Get the Excel file as a Blob

                // Create a temporary link to trigger download
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;

                // Extract filename from Content-Disposition header if possible, otherwise use default
                const disposition = response.headers.get('content-disposition');
                let filename = 'reconciliation-report.xlsx'; // Default filename
                if (disposition && disposition.includes('filename=')) {
                    const filenameMatch = disposition.match(/filename="?(.+)"?/i);
                    if (filenameMatch && filenameMatch.length === 2) {
                        filename = filenameMatch[1];
                    }
                }
                a.download = filename;

                document.body.appendChild(a);
                a.click(); // Trigger download

                // Clean up
                window.URL.revokeObjectURL(url);
                a.remove();
                showExportStatus('Report downloaded successfully.', 'success');

            } else {
                 let errorMsg = `Export failed: ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorMsg = `Error: ${errorData.message || errorMsg}`;
                } catch (e) { /* Ignore */ }
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
});